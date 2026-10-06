import { describe, expect, it } from "vitest";
import type { ProductRow } from "@/services/products-service";
import { productDefaultValues, toProductFormValues, type ProductFormValues } from "./schema";
import { toProductPayload, type ProductPayloadContext } from "./product-payload";

const base: ProductFormValues = {
  ...productDefaultValues,
  name: "  قلم  ",
  categoryId: "cat-1",
  unitId: "unit-1",
};

const createContext: ProductPayloadContext = {
  initial: null,
  canSetOwnerAgent: false,
  investmentFlag: false,
};

/** The fields of a stored product the payload logic reads; the rest is irrelevant here. */
function stored(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "p-1",
    name: "قلم",
    nameEn: null,
    internalName: "قلم",
    displayName: "قلم",
    sku: "PRD-000001",
    barcode: null,
    qrCodeValue: null,
    searchKeywords: null,
    internalNotes: null,
    tags: [],
    categoryId: "cat-1",
    brandId: null,
    unitId: "unit-1",
    taxId: null,
    analyticAccountId: null,
    preferredPartnerId: null,
    description: null,
    shortDescription: null,
    longDescription: null,
    type: "PURCHASE_AND_SALE",
    status: "ACTIVE",
    imageUrl: null,
    isPurchasable: true,
    isSellable: true,
    isInventoryItem: true,
    availableForInvestmentOpportunities: false,
    ownerAgentId: null,
    itemType: "PRODUCT",
    supplyMethod: "PURCHASED",
    salesPrice: null,
    salesTaxIncluded: false,
    salesDescription: null,
    allowDiscount: true,
    purchasePrice: null,
    purchaseDescription: null,
    reorderLevel: null,
    reorderQuantity: null,
    safetyStock: null,
    minQuantity: null,
    maxQuantity: null,
    storageLocation: null,
    preferredWarehouseId: null,
    costingMethod: null,
    currentCost: null,
    lastCostUpdate: null,
    serialNumberTracking: false,
    batchTracking: false,
    weight: null,
    width: null,
    height: null,
    length: null,
    createdAt: "",
    updatedAt: "",
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("toProductPayload — create", () => {
  it("sends the attributes, defaults the internal / display name to the Arabic name and never sends `type`", () => {
    const payload = toProductPayload(base, createContext);
    expect(payload).toMatchObject({
      name: "قلم",
      internalName: "قلم",
      displayName: "قلم",
      itemType: "PRODUCT",
      supplyMethod: "PURCHASED",
      isSellable: true,
      isPurchasable: true,
      isInventoryItem: true,
      categoryId: "cat-1",
      unitId: "unit-1",
    });
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("sku");
  });

  it("omits empty optional references but sends an explicit null tax, so the category default is not re-applied", () => {
    const payload = toProductPayload(base, createContext);
    expect(payload.brandId).toBeUndefined();
    expect(payload.taxId).toBeNull();
    expect(payload.barcode).toBeUndefined();
  });

  it("parses comma-separated tags and converts the tracking select to the two API booleans", () => {
    const payload = toProductPayload(
      { ...base, tagsInput: " a, b ,, c ", inventoryTracking: "SERIAL" },
      createContext,
    );
    expect(payload.tags).toEqual(["a", "b", "c"]);
    expect(payload.serialNumberTracking).toBe(true);
    expect(payload.batchTracking).toBe(false);
  });

  it("sends the owner only for staff who may choose one, and only when Agent is selected", () => {
    const agent = { ...base, ownership: "AGENT" as const, ownerAgentId: "agent-1" };
    expect(toProductPayload(agent, createContext)).not.toHaveProperty("ownerAgentId");
    expect(
      toProductPayload(
        { ...agent, ownership: "COMPANY" },
        { ...createContext, canSetOwnerAgent: true },
      ),
    ).not.toHaveProperty("ownerAgentId");
    expect(toProductPayload(agent, { ...createContext, canSetOwnerAgent: true })).toMatchObject({
      ownerAgentId: "agent-1",
    });
  });

  it("a service payload carries the service attributes the form settled", () => {
    const payload = toProductPayload(
      {
        ...base,
        itemType: "SERVICE",
        isSellable: true,
        isPurchasable: false,
        isInventoryItem: false,
        supplyMethod: "PURCHASED",
      },
      createContext,
    );
    expect(payload).toMatchObject({
      itemType: "SERVICE",
      isInventoryItem: false,
      isPurchasable: false,
    });
  });
});

describe("toProductPayload — edit", () => {
  const initial = stored();
  const context: ProductPayloadContext = { ...createContext, initial };
  const unchanged = toProductFormValues(initial);

  it("does not send the attributes when none changed (an old product's edit never re-validates them)", () => {
    const payload = toProductPayload({ ...unchanged, name: "قلم جاف" }, context);
    for (const key of [
      "itemType",
      "isSellable",
      "isPurchasable",
      "isInventoryItem",
      "supplyMethod",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(payload.name).toBe("قلم جاف");
  });

  it("sends the whole attribute set once one changed", () => {
    const payload = toProductPayload({ ...unchanged, isPurchasable: false }, context);
    expect(payload).toMatchObject({
      itemType: "PRODUCT",
      isSellable: true,
      isPurchasable: false,
      isInventoryItem: true,
      supplyMethod: "PURCHASED",
    });
  });

  it("sends an explicit null for a cleared reference or number, so it can actually be cleared", () => {
    const withValues = stored({ brandId: "b-1", salesPrice: "12.50" });
    const payload = toProductPayload(
      { ...toProductFormValues(withValues), brandId: "", salesPrice: undefined },
      { ...context, initial: withValues },
    );
    expect(payload.brandId).toBeNull();
    expect(payload.salesPrice).toBeNull();
  });

  it("sends the investor flag only when it changed, and the owner only when it changed", () => {
    const same = toProductPayload(unchanged, { ...context, canSetOwnerAgent: true });
    expect(same).not.toHaveProperty("availableForInvestmentOpportunities");
    expect(same).not.toHaveProperty("ownerAgentId");

    const changed = toProductPayload(
      { ...unchanged, ownership: "AGENT", ownerAgentId: "agent-1" },
      { ...context, canSetOwnerAgent: true, investmentFlag: true },
    );
    expect(changed).toMatchObject({
      availableForInvestmentOpportunities: true,
      ownerAgentId: "agent-1",
    });
  });

  it("moving a product back to the company sends ownerAgentId null", () => {
    const owned = stored({ ownerAgentId: "agent-1" });
    const payload = toProductPayload(
      { ...toProductFormValues(owned), ownership: "COMPANY", ownerAgentId: "" },
      { ...context, initial: owned, canSetOwnerAgent: true },
    );
    expect(payload.ownerAgentId).toBeNull();
  });
});
