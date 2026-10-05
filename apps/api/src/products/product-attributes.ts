import { ItemType, ProductSupplyMethod, ProductType } from '@prisma/client';

/**
 * R13 — Product attributes are independent (spec §2): item type, stock
 * tracking, commercial availability (sell / buy) and supply method. This file
 * is the ONE place that defaults them, validates the hard rules between them
 * and derives the deprecated `Product.type` column from them. No I/O.
 */
export interface ProductFlags {
  isSellable: boolean;
  isPurchasable: boolean;
  isInventoryItem: boolean;
}

export interface ProductAttributes extends ProductFlags {
  itemType: ItemType;
  supplyMethod: ProductSupplyMethod;
}

/** What a caller may send — everything optional, explicit values always win. */
export type ProductAttributeInput = Partial<ProductAttributes> & {
  /** Deprecated legacy hint — used only when no itemType is given. */
  type?: ProductType;
};

export interface ProductRuleViolation {
  code:
    | 'PRODUCT_SERVICE_RULE'
    | 'PRODUCT_KIT_NOT_STOCKED'
    | 'PRODUCT_ASSEMBLED_NOT_STOCKED';
  message: string;
}

/** itemType-driven defaults: PRODUCT sells + buys, tracked; SERVICE sells only, never tracked. */
export function defaultsForItemType(itemType: ItemType): ProductAttributes {
  return itemType === ItemType.SERVICE
    ? {
        itemType,
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: false,
        supplyMethod: ProductSupplyMethod.PURCHASED,
      }
    : {
        itemType,
        isSellable: true,
        isPurchasable: true,
        isInventoryItem: true,
        supplyMethod: ProductSupplyMethod.PURCHASED,
      };
}

/**
 * The deprecated `type` as an INPUT hint: old callers / import files that send
 * only `type` keep working, mapped onto the independent attributes. MANUFACTURED
 * maps to ASSEMBLED (the migration backfill does the same); a KIT is never
 * inferred from a legacy value.
 */
export function legacyTypeToAttributes(type: ProductType): ProductAttributes {
  switch (type) {
    case ProductType.PURCHASE_ONLY:
      return {
        itemType: ItemType.PRODUCT,
        isSellable: false,
        isPurchasable: true,
        isInventoryItem: true,
        supplyMethod: ProductSupplyMethod.PURCHASED,
      };
    case ProductType.SALES_ONLY:
      return {
        itemType: ItemType.PRODUCT,
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: true,
        supplyMethod: ProductSupplyMethod.PURCHASED,
      };
    case ProductType.MANUFACTURED:
      return {
        ...defaultsForItemType(ItemType.PRODUCT),
        supplyMethod: ProductSupplyMethod.ASSEMBLED,
      };
    case ProductType.SERVICE:
      return defaultsForItemType(ItemType.SERVICE);
    case ProductType.EXPENSE_ITEM:
      return {
        itemType: ItemType.PRODUCT,
        isSellable: false,
        isPurchasable: true,
        isInventoryItem: false,
        supplyMethod: ProductSupplyMethod.PURCHASED,
      };
    case ProductType.PURCHASE_AND_SALE:
    default:
      return defaultsForItemType(ItemType.PRODUCT);
  }
}

/**
 * The stored legacy `type`, derived on EVERY write — never user input.
 * Kept only so the legacy readers (list filter, import, older tests) work
 * until the column is removed in a later release.
 */
export function deriveLegacyProductType(
  itemType: ItemType,
  flags: ProductFlags,
  supplyMethod: ProductSupplyMethod,
): ProductType {
  if (itemType === ItemType.SERVICE) return ProductType.SERVICE;
  if (
    supplyMethod === ProductSupplyMethod.ASSEMBLED ||
    supplyMethod === ProductSupplyMethod.KIT
  ) {
    return ProductType.MANUFACTURED;
  }
  if (flags.isSellable && flags.isPurchasable) {
    return ProductType.PURCHASE_AND_SALE;
  }
  if (flags.isSellable) return ProductType.SALES_ONLY;
  if (flags.isPurchasable) {
    return flags.isInventoryItem
      ? ProductType.PURCHASE_ONLY
      : ProductType.EXPENSE_ITEM;
  }
  return ProductType.PURCHASE_ONLY;
}

/**
 * Resolves the full attribute set from a partial input.
 *
 * Base = the itemType's defaults, else the legacy `type` hint, else PRODUCT.
 * Explicit values win. A supply method given without an explicit stock flag
 * coerces tracking to what the method requires (KIT: never stocked,
 * ASSEMBLED: stocked) so the user is not forced to tick a box the rules
 * already decide; an explicit contradicting value is rejected by
 * `findProductRuleViolation`.
 *
 * `current` (an existing product on update): unspecified fields keep their
 * stored value — unless the item type itself changes, in which case the new
 * type's defaults apply to every unspecified field (PRODUCT → SERVICE drops
 * tracking and buying without the caller re-stating them).
 */
export function resolveProductAttributes(
  input: ProductAttributeInput,
  current?: ProductAttributes,
): ProductAttributes {
  const itemTypeChanged =
    input.itemType !== undefined &&
    (current === undefined || input.itemType !== current.itemType);

  let base: ProductAttributes;
  if (input.itemType !== undefined) {
    base =
      current && !itemTypeChanged
        ? current
        : defaultsForItemType(input.itemType);
  } else if (current) {
    base = input.type ? legacyTypeToAttributes(input.type) : current;
  } else {
    base = input.type
      ? legacyTypeToAttributes(input.type)
      : defaultsForItemType(ItemType.PRODUCT);
  }

  const supplyMethod = input.supplyMethod ?? base.supplyMethod;
  let isInventoryItem = input.isInventoryItem ?? base.isInventoryItem;
  if (input.isInventoryItem === undefined && input.supplyMethod !== undefined) {
    if (supplyMethod === ProductSupplyMethod.KIT) isInventoryItem = false;
    else if (supplyMethod === ProductSupplyMethod.ASSEMBLED) {
      isInventoryItem = true;
    }
  }

  return {
    itemType: input.itemType ?? base.itemType,
    isSellable: input.isSellable ?? base.isSellable,
    isPurchasable: input.isPurchasable ?? base.isPurchasable,
    isInventoryItem,
    supplyMethod,
  };
}

/** The hard rules between attributes (spec §2) — null when the combination is legal. */
export function findProductRuleViolation(
  attributes: ProductAttributes,
): ProductRuleViolation | null {
  if (
    attributes.itemType === ItemType.SERVICE &&
    (attributes.isInventoryItem ||
      attributes.supplyMethod !== ProductSupplyMethod.PURCHASED)
  ) {
    return {
      code: 'PRODUCT_SERVICE_RULE',
      message:
        'الخدمة لا تُتتبَّع في المخزون ولا تُجمَّع ولا تُركَّب — A service is never stock-tracked, assembled or a kit.',
    };
  }
  if (
    attributes.supplyMethod === ProductSupplyMethod.KIT &&
    attributes.isInventoryItem
  ) {
    return {
      code: 'PRODUCT_KIT_NOT_STOCKED',
      message:
        'المنتج المركّب (Kit) لا يملك رصيد مخزون — مكوّناته هي المخزّنة — A kit owns no stock balance; its components are the stocked items.',
    };
  }
  if (
    attributes.supplyMethod === ProductSupplyMethod.ASSEMBLED &&
    !attributes.isInventoryItem
  ) {
    return {
      code: 'PRODUCT_ASSEMBLED_NOT_STOCKED',
      message:
        'المنتج المجمَّع يجب أن يكون متتبَّعًا في المخزون — An assembled product must be stock-tracked.',
    };
  }
  return null;
}
