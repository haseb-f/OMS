import { ItemType, ProductSupplyMethod, ProductType } from '@prisma/client';
import {
  defaultsForItemType,
  deriveLegacyProductType,
  findProductRuleViolation,
  legacyTypeToAttributes,
  resolveProductAttributes,
  type ProductAttributes,
} from './product-attributes';

const { PRODUCT, SERVICE } = ItemType;
const { PURCHASED, ASSEMBLED, KIT } = ProductSupplyMethod;

const flags = (
  isSellable: boolean,
  isPurchasable: boolean,
  tracked: boolean,
) => ({
  isSellable,
  isPurchasable,
  isInventoryItem: tracked,
});

describe('deriveLegacyProductType', () => {
  it.each([
    // [itemType, sell, buy, tracked, supply, expected]
    [SERVICE, true, false, false, PURCHASED, ProductType.SERVICE],
    [SERVICE, true, true, false, PURCHASED, ProductType.SERVICE],
    [PRODUCT, true, true, true, ASSEMBLED, ProductType.MANUFACTURED],
    [PRODUCT, true, false, false, KIT, ProductType.MANUFACTURED],
    [PRODUCT, true, true, true, PURCHASED, ProductType.PURCHASE_AND_SALE],
    [PRODUCT, true, true, false, PURCHASED, ProductType.PURCHASE_AND_SALE],
    [PRODUCT, true, false, true, PURCHASED, ProductType.SALES_ONLY],
    [PRODUCT, true, false, false, PURCHASED, ProductType.SALES_ONLY],
    [PRODUCT, false, true, true, PURCHASED, ProductType.PURCHASE_ONLY],
    [PRODUCT, false, true, false, PURCHASED, ProductType.EXPENSE_ITEM],
    [PRODUCT, false, false, true, PURCHASED, ProductType.PURCHASE_ONLY],
    [PRODUCT, false, false, false, PURCHASED, ProductType.PURCHASE_ONLY],
  ] as const)(
    '%s sell=%s buy=%s tracked=%s %s -> %s',
    (itemType, sell, buy, tracked, supply, expected) => {
      expect(
        deriveLegacyProductType(itemType, flags(sell, buy, tracked), supply),
      ).toBe(expected);
    },
  );
});

describe('defaultsForItemType', () => {
  it('PRODUCT sells and buys, tracked, purchased', () => {
    expect(defaultsForItemType(PRODUCT)).toEqual({
      itemType: PRODUCT,
      isSellable: true,
      isPurchasable: true,
      isInventoryItem: true,
      supplyMethod: PURCHASED,
    });
  });

  it('SERVICE sells only, untracked, purchased', () => {
    expect(defaultsForItemType(SERVICE)).toEqual({
      itemType: SERVICE,
      isSellable: true,
      isPurchasable: false,
      isInventoryItem: false,
      supplyMethod: PURCHASED,
    });
  });
});

describe('legacyTypeToAttributes', () => {
  it.each([
    [ProductType.PURCHASE_ONLY, PRODUCT, false, true, true, PURCHASED],
    [ProductType.SALES_ONLY, PRODUCT, true, false, true, PURCHASED],
    [ProductType.PURCHASE_AND_SALE, PRODUCT, true, true, true, PURCHASED],
    [ProductType.MANUFACTURED, PRODUCT, true, true, true, ASSEMBLED],
    [ProductType.SERVICE, SERVICE, true, false, false, PURCHASED],
    [ProductType.EXPENSE_ITEM, PRODUCT, false, true, false, PURCHASED],
  ] as const)(
    '%s maps to item type / flags / supply',
    (type, itemType, sell, buy, tracked, supply) => {
      expect(legacyTypeToAttributes(type)).toEqual({
        itemType,
        isSellable: sell,
        isPurchasable: buy,
        isInventoryItem: tracked,
        supplyMethod: supply,
      });
    },
  );

  it('round-trips through deriveLegacyProductType for every legacy value', () => {
    for (const type of Object.values(ProductType)) {
      const a = legacyTypeToAttributes(type);
      expect(deriveLegacyProductType(a.itemType, a, a.supplyMethod)).toBe(type);
    }
  });

  it('never infers a KIT from a legacy value', () => {
    for (const type of Object.values(ProductType)) {
      expect(legacyTypeToAttributes(type).supplyMethod).not.toBe(KIT);
    }
  });
});

describe('resolveProductAttributes — create', () => {
  it('defaults to a PRODUCT when nothing is given', () => {
    expect(resolveProductAttributes({})).toEqual(defaultsForItemType(PRODUCT));
  });

  it('applies the SERVICE defaults for itemType SERVICE', () => {
    expect(resolveProductAttributes({ itemType: SERVICE })).toEqual(
      defaultsForItemType(SERVICE),
    );
  });

  it('explicit values always win over the item type defaults', () => {
    expect(
      resolveProductAttributes({
        itemType: PRODUCT,
        isSellable: false,
        isInventoryItem: false,
      }),
    ).toEqual({
      itemType: PRODUCT,
      isSellable: false,
      isPurchasable: true,
      isInventoryItem: false,
      supplyMethod: PURCHASED,
    });
  });

  it('maps a lone legacy type through the hint', () => {
    expect(
      resolveProductAttributes({ type: ProductType.PURCHASE_ONLY }),
    ).toEqual(legacyTypeToAttributes(ProductType.PURCHASE_ONLY));
  });

  it('ignores the legacy type when an item type is given', () => {
    expect(
      resolveProductAttributes({
        itemType: PRODUCT,
        type: ProductType.SERVICE,
      }),
    ).toEqual(defaultsForItemType(PRODUCT));
  });

  it('explicit flags override a legacy type hint', () => {
    expect(
      resolveProductAttributes({
        type: ProductType.SALES_ONLY,
        isPurchasable: true,
      }),
    ).toMatchObject({ isSellable: true, isPurchasable: true });
  });

  it('a KIT supply method without an explicit stock flag turns tracking off', () => {
    expect(resolveProductAttributes({ supplyMethod: KIT })).toMatchObject({
      supplyMethod: KIT,
      isInventoryItem: false,
    });
  });

  it('an ASSEMBLED supply method without an explicit stock flag turns tracking on', () => {
    expect(
      resolveProductAttributes({
        supplyMethod: ASSEMBLED,
        isInventoryItem: undefined,
      }),
    ).toMatchObject({ supplyMethod: ASSEMBLED, isInventoryItem: true });
  });

  it('an explicit stock flag is kept even when it contradicts the supply method (the rules reject it)', () => {
    const attributes = resolveProductAttributes({
      supplyMethod: KIT,
      isInventoryItem: true,
    });
    expect(attributes.isInventoryItem).toBe(true);
    expect(findProductRuleViolation(attributes)?.code).toBe(
      'PRODUCT_KIT_NOT_STOCKED',
    );
  });
});

describe('resolveProductAttributes — update', () => {
  const stocked: ProductAttributes = defaultsForItemType(PRODUCT);

  it('keeps stored values for everything not stated', () => {
    expect(resolveProductAttributes({ isSellable: false }, stocked)).toEqual({
      ...stocked,
      isSellable: false,
    });
  });

  it('changing the item type to SERVICE applies the SERVICE defaults to unstated fields', () => {
    expect(resolveProductAttributes({ itemType: SERVICE }, stocked)).toEqual(
      defaultsForItemType(SERVICE),
    );
  });

  it('a restated, unchanged item type keeps the stored flags', () => {
    const custom: ProductAttributes = { ...stocked, isPurchasable: false };
    expect(resolveProductAttributes({ itemType: PRODUCT }, custom)).toEqual(
      custom,
    );
  });

  it('a legacy type hint on an existing product re-maps all attributes', () => {
    expect(
      resolveProductAttributes({ type: ProductType.SERVICE }, stocked),
    ).toEqual(defaultsForItemType(SERVICE));
  });

  it('switching to KIT on a stocked product turns tracking off unless stated', () => {
    expect(resolveProductAttributes({ supplyMethod: KIT }, stocked)).toEqual({
      ...stocked,
      supplyMethod: KIT,
      isInventoryItem: false,
    });
  });
});

describe('findProductRuleViolation', () => {
  const base = defaultsForItemType(PRODUCT);

  it('accepts every default combination', () => {
    expect(findProductRuleViolation(defaultsForItemType(PRODUCT))).toBeNull();
    expect(findProductRuleViolation(defaultsForItemType(SERVICE))).toBeNull();
  });

  it('accepts a stocked ASSEMBLED product and an unstocked KIT', () => {
    expect(
      findProductRuleViolation({ ...base, supplyMethod: ASSEMBLED }),
    ).toBeNull();
    expect(
      findProductRuleViolation({
        ...base,
        supplyMethod: KIT,
        isInventoryItem: false,
      }),
    ).toBeNull();
  });

  it('PRODUCT_SERVICE_RULE: a service is never tracked, assembled or a kit', () => {
    const service = defaultsForItemType(SERVICE);
    expect(
      findProductRuleViolation({ ...service, isInventoryItem: true })?.code,
    ).toBe('PRODUCT_SERVICE_RULE');
    expect(
      findProductRuleViolation({ ...service, supplyMethod: KIT })?.code,
    ).toBe('PRODUCT_SERVICE_RULE');
    expect(
      findProductRuleViolation({ ...service, supplyMethod: ASSEMBLED })?.code,
    ).toBe('PRODUCT_SERVICE_RULE');
  });

  it('PRODUCT_KIT_NOT_STOCKED: a kit owns no stock', () => {
    expect(findProductRuleViolation({ ...base, supplyMethod: KIT })?.code).toBe(
      'PRODUCT_KIT_NOT_STOCKED',
    );
  });

  it('PRODUCT_ASSEMBLED_NOT_STOCKED: an assembled product must be tracked', () => {
    expect(
      findProductRuleViolation({
        ...base,
        supplyMethod: ASSEMBLED,
        isInventoryItem: false,
      })?.code,
    ).toBe('PRODUCT_ASSEMBLED_NOT_STOCKED');
  });
});
