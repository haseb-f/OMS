import type { ProductRow } from "@/services/products-service";
import { attributePatch, type ProductAttributes } from "./attribute-rules";
import { attributesOf, toProductFormValues, type ProductFormValues } from "./schema";

export interface ProductPayloadContext {
  /** The product being edited; null on create / duplicate. */
  initial: ProductRow | null;
  /** Only staff who may see agents choose an owner; others never send the field. */
  canSetOwnerAgent: boolean;
  /** The investor flag after the attribute rules (a blocked flag is never newly ON). */
  investmentFlag: boolean;
}

const text = (value: string | undefined) => value?.trim() || undefined;

/**
 * Turns the form into the create / update body. Pure and unit-tested:
 * - the deprecated `type` is never sent (the API derives it);
 * - on an EDIT the five attributes are sent only when one of them changed (the
 *   server re-validates all of them once any is present), and nullable
 *   references / numbers are sent as `null` when cleared so they can be cleared;
 * - internal / display names default to the Arabic name.
 */
export function toProductPayload(
  values: ProductFormValues,
  context: ProductPayloadContext,
): Record<string, unknown> {
  const { initial } = context;
  const editing = !!initial;
  const name = values.name.trim();
  const tags = values.tagsInput
    ? values.tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const initialAttributes = initial ? attributesOf(toProductFormValues(initial)) : null;
  const current = attributesOf(values) as ProductAttributes;
  // A cleared reference / number: omitted on create, an explicit null on edit.
  const clearable = <T>(value: T | "" | undefined): T | null | undefined => {
    if (value === "" || value === undefined) return editing ? null : undefined;
    return value;
  };

  const payload: Record<string, unknown> = {
    name,
    nameEn: values.nameEn?.trim() || (editing ? null : undefined),
    internalName: text(values.internalName) ?? name,
    displayName: text(values.displayName) ?? name,
    barcode: values.barcode?.trim() || (editing ? null : undefined),
    qrCodeValue: text(values.qrCodeValue),
    imageUrl: text(values.imageUrl),
    description: values.description || undefined,
    shortDescription: values.shortDescription || undefined,
    longDescription: values.longDescription || undefined,
    internalNotes: values.internalNotes || undefined,
    searchKeywords: values.searchKeywords?.trim() || undefined,
    tags,
    status: values.status,
    categoryId: values.categoryId,
    unitId: values.unitId,
    brandId: clearable(values.brandId),
    // An explicit null is "no tax"; an omitted value would inherit the category default again.
    taxId: values.taxId || null,
    analyticAccountId: clearable(values.analyticAccountId),
    preferredPartnerId: clearable(values.preferredPartnerId),
    preferredWarehouseId: clearable(values.preferredWarehouseId),
    ...attributePatch(initialAttributes, current),
    salesPrice: clearable(values.salesPrice),
    salesTaxIncluded: values.salesTaxIncluded,
    salesDescription: values.salesDescription || undefined,
    allowDiscount: values.allowDiscount,
    purchasePrice: clearable(values.purchasePrice),
    purchaseDescription: values.purchaseDescription || undefined,
    reorderLevel: clearable(values.reorderLevel),
    reorderQuantity: clearable(values.reorderQuantity),
    safetyStock: clearable(values.safetyStock),
    minQuantity: clearable(values.minQuantity),
    maxQuantity: clearable(values.maxQuantity),
    storageLocation: values.storageLocation || undefined,
    weight: clearable(values.weight),
    width: clearable(values.width),
    height: clearable(values.height),
    length: clearable(values.length),
    // The form's single select converts back to the two API booleans.
    serialNumberTracking: values.inventoryTracking === "SERIAL",
    batchTracking: values.inventoryTracking === "BATCH",
  };

  if (!editing || context.investmentFlag !== initial.availableForInvestmentOpportunities) {
    payload.availableForInvestmentOpportunities = context.investmentFlag;
  }

  if (context.canSetOwnerAgent) {
    const ownerAgentId = values.ownership === "AGENT" ? values.ownerAgentId || null : null;
    if (!editing ? ownerAgentId : ownerAgentId !== (initial.ownerAgentId ?? null)) {
      payload.ownerAgentId = ownerAgentId;
    }
  }

  return payload;
}
