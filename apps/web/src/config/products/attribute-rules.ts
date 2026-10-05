/**
 * R13 product attributes — the ONE client-side copy of the rules between the
 * independent product attributes (spec §2). It mirrors the API's
 * `apps/api/src/products/product-attributes.ts` so the form can default,
 * force and explain a choice BEFORE the server is asked; the server stays the
 * authority and re-validates every write (422 `PRODUCT_*`). Pure — no I/O, no
 * React — so the rules are unit-tested (`attribute-rules.spec.ts`).
 */

export type ItemType = "PRODUCT" | "SERVICE";
export type SupplyMethod = "PURCHASED" | "ASSEMBLED" | "KIT";

export const ITEM_TYPES: readonly ItemType[] = ["PRODUCT", "SERVICE"];
export const SUPPLY_METHODS: readonly SupplyMethod[] = ["PURCHASED", "ASSEMBLED", "KIT"];

export interface ProductAttributes {
  itemType: ItemType;
  isSellable: boolean;
  isPurchasable: boolean;
  isInventoryItem: boolean;
  supplyMethod: SupplyMethod;
}

/** itemType defaults: a PRODUCT sells + buys and is tracked; a SERVICE sells only and is never tracked. */
export function defaultsForItemType(itemType: ItemType): ProductAttributes {
  return itemType === "SERVICE"
    ? {
        itemType,
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: false,
        supplyMethod: "PURCHASED",
      }
    : {
        itemType,
        isSellable: true,
        isPurchasable: true,
        isInventoryItem: true,
        supplyMethod: "PURCHASED",
      };
}

/** Why a control is forced (shown as the one-line reason next to it). */
export type StockTrackingReason = "KIT" | "ASSEMBLED";

export interface StockTrackingState {
  /** Hidden entirely (a service has no stock). */
  visible: boolean;
  /** The value the switch must show. */
  value: boolean;
  /** Forced by another attribute — the switch is disabled. */
  locked: boolean;
  reason: StockTrackingReason | null;
}

/**
 * Track stock: only for a PRODUCT; forced OFF for a Kit (it owns no balance —
 * its components are the stocked items); forced ON for an Assembled item.
 */
export function stockTrackingState(
  attributes: Pick<ProductAttributes, "itemType" | "isInventoryItem" | "supplyMethod">,
): StockTrackingState {
  if (attributes.itemType === "SERVICE") {
    return { visible: false, value: false, locked: true, reason: null };
  }
  if (attributes.supplyMethod === "KIT") {
    return { visible: true, value: false, locked: true, reason: "KIT" };
  }
  if (attributes.supplyMethod === "ASSEMBLED") {
    return { visible: true, value: true, locked: true, reason: "ASSEMBLED" };
  }
  return { visible: true, value: attributes.isInventoryItem, locked: false, reason: null };
}

/** Supply method (Purchased / Assembled / Kit) applies to a PRODUCT only. */
export function supplyMethodVisible(itemType: ItemType): boolean {
  return itemType === "PRODUCT";
}

/** A recipe exists only for an Assembled item or a Kit. */
export function usesRecipe(attributes: Pick<ProductAttributes, "itemType" | "supplyMethod">) {
  return attributes.itemType === "PRODUCT" && attributes.supplyMethod !== "PURCHASED";
}

/**
 * Brings an attribute set to a legal combination (the server's hard rules):
 * SERVICE ⇒ untracked + PURCHASED; KIT ⇒ untracked; ASSEMBLED ⇒ tracked.
 */
export function settleAttributes(attributes: ProductAttributes): ProductAttributes {
  if (attributes.itemType === "SERVICE") {
    return { ...attributes, isInventoryItem: false, supplyMethod: "PURCHASED" };
  }
  if (attributes.supplyMethod === "KIT") return { ...attributes, isInventoryItem: false };
  if (attributes.supplyMethod === "ASSEMBLED") return { ...attributes, isInventoryItem: true };
  return attributes;
}

/** Picking an item type applies that type's defaults (explicit later choices still win). */
export function changeItemType(current: ProductAttributes, itemType: ItemType): ProductAttributes {
  return itemType === current.itemType ? current : defaultsForItemType(itemType);
}

/**
 * Picking a supply method coerces tracking to what the method requires; going
 * back to Purchased from a Kit restores the product default (tracked).
 */
export function changeSupplyMethod(
  current: ProductAttributes,
  supplyMethod: SupplyMethod,
): ProductAttributes {
  if (supplyMethod === current.supplyMethod) return current;
  const next = { ...current, supplyMethod };
  if (supplyMethod === "PURCHASED" && current.supplyMethod === "KIT") {
    return { ...next, isInventoryItem: true };
  }
  return settleAttributes(next);
}

/** The attribute keys the form owns; used to send only what changed on an edit. */
export const ATTRIBUTE_KEYS = [
  "itemType",
  "isSellable",
  "isPurchasable",
  "isInventoryItem",
  "supplyMethod",
] as const satisfies readonly (keyof ProductAttributes)[];

/**
 * On an edit the server re-validates ALL attributes as soon as any one is sent
 * (and re-derives the legacy `type`), so an unrelated edit of an older product
 * must not send them. Returns the attributes that differ from the loaded
 * product — or ALL of them when any differs (a changed item type / supply
 * method must be validated together with the flags it implies).
 */
export function attributePatch(
  initial: ProductAttributes | null,
  current: ProductAttributes,
): Partial<ProductAttributes> {
  if (!initial) return { ...current };
  const changed = ATTRIBUTE_KEYS.some((key) => initial[key] !== current[key]);
  return changed ? { ...current } : {};
}

export type InvestmentBlockedReason = "AGENT_OWNED" | "SERVICE" | "NOT_SELLABLE" | "NOT_ACTIVE";

export interface InvestmentRuleInput {
  isAgentOwned: boolean;
  itemType: ItemType | null;
  isSellable: boolean;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  archived?: boolean;
}

/** Mirrors `investmentBlockedReason` (API): the first structural reason, in a fixed order. */
export function investmentBlockedReason(
  input: InvestmentRuleInput,
): InvestmentBlockedReason | null {
  if (input.isAgentOwned) return "AGENT_OWNED";
  if (input.itemType === "SERVICE") return "SERVICE";
  if (!input.isSellable) return "NOT_SELLABLE";
  if (input.archived || input.status !== "ACTIVE") return "NOT_ACTIVE";
  return null;
}

export interface InvestmentSwitchState {
  blockedReason: InvestmentBlockedReason | null;
  /** Cannot be toggled: blocked, and not an existing flag the user may still turn OFF. */
  disabled: boolean;
  /** The value shown and sent: a blocked flag is never newly ON (the server grandfathers only an existing one). */
  value: boolean;
}

/**
 * `requested` is the switch value, `initiallyOn` the stored flag of the loaded
 * product (false on create). Turning an existing flag OFF is always allowed;
 * turning it ON while a structural reason blocks it never is.
 */
export function investmentSwitchState(
  input: InvestmentRuleInput,
  requested: boolean,
  initiallyOn: boolean,
): InvestmentSwitchState {
  const blockedReason = investmentBlockedReason(input);
  if (!blockedReason) return { blockedReason, disabled: false, value: requested };
  const value = initiallyOn && requested;
  return { blockedReason, disabled: !value, value };
}

/** Server error codes that name a rule the form already mirrors. */
export const PRODUCT_RULE_CODES = [
  "PRODUCT_SERVICE_RULE",
  "PRODUCT_KIT_NOT_STOCKED",
  "PRODUCT_ASSEMBLED_NOT_STOCKED",
  "PRODUCT_SUPPLY_METHOD_LOCKED",
  "PRODUCT_INVESTMENT_NOT_ALLOWED",
  "PRODUCT_BARCODE_DUPLICATE",
  "PRODUCT_OWNER_LOCKED",
] as const;
