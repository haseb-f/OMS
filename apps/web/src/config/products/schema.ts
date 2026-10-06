import { z } from "zod";
import type { MessageKey } from "@/i18n/translate";
import {
  defaultsForItemType,
  type ItemType,
  type ProductAttributes,
  type SupplyMethod,
} from "./attribute-rules";
import type { ProductRow } from "@/services/products-service";

const optionalText = z.string().optional().or(z.literal(""));

/**
 * The ONE product form (create and edit). Only Name, Category and Unit are
 * required; everything else is optional. The item type is required (the form
 * defaults it) except for a legacy row that has none yet — that case is
 * answered at save time, not by the schema. The deprecated `type` is not part
 * of the form at all: the API derives it from the attributes on every write.
 */
export function createProductSchema(t: (key: MessageKey) => string) {
  const required = { message: t("common.required") };
  return productShape(required);
}

function productShape(required: { message: string }) {
  return z.object({
    name: z.string().trim().min(1, required),
    nameEn: optionalText,
    /** Default to `name` on the server when empty. */
    internalName: optionalText,
    displayName: optionalText,
    barcode: optionalText,
    qrCodeValue: optionalText,
    imageUrl: optionalText,
    description: optionalText,
    shortDescription: optionalText,
    longDescription: optionalText,
    internalNotes: optionalText,
    searchKeywords: optionalText,
    tagsInput: optionalText,

    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]),
    categoryId: z.string().min(1, required),
    brandId: optionalText,
    unitId: z.string().min(1, required),
    taxId: optionalText,
    analyticAccountId: optionalText,

    // The independent attributes (spec §2).
    itemType: z.enum(["PRODUCT", "SERVICE"]).optional().or(z.literal("")),
    supplyMethod: z.enum(["PURCHASED", "ASSEMBLED", "KIT"]),
    isSellable: z.boolean(),
    isPurchasable: z.boolean(),
    isInventoryItem: z.boolean(),
    /** Company | Agent; Agent reveals the owner selector. */
    ownership: z.enum(["COMPANY", "AGENT"]),
    /** "" = company-owned. */
    ownerAgentId: optionalText,
    availableForInvestmentOpportunities: z.boolean(),

    salesPrice: z.number().optional(),
    salesTaxIncluded: z.boolean(),
    salesDescription: optionalText,
    allowDiscount: z.boolean(),

    /** An ESTIMATE of the purchase price — the actual cost is the moving average. */
    purchasePrice: z.number().optional(),
    preferredPartnerId: optionalText,
    purchaseDescription: optionalText,

    reorderLevel: z.number().optional(),
    reorderQuantity: z.number().optional(),
    safetyStock: z.number().optional(),
    minQuantity: z.number().optional(),
    maxQuantity: z.number().optional(),
    storageLocation: optionalText,
    preferredWarehouseId: optionalText,
    /**
     * One select the form works with; the API stores `serialNumberTracking` /
     * `batchTracking` as two booleans, converted at the form's edges
     * (`toProductFormValues` / `toProductPayload`) and never carried twice.
     */
    inventoryTracking: z.enum(["NONE", "BATCH", "SERIAL"]),
    weight: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    length: z.number().optional(),
  });
}

export type ProductFormValues = z.infer<ReturnType<typeof productShape>>;

export const productDefaultValues: ProductFormValues = {
  name: "",
  nameEn: "",
  internalName: "",
  displayName: "",
  barcode: "",
  qrCodeValue: "",
  imageUrl: "",
  description: "",
  shortDescription: "",
  longDescription: "",
  internalNotes: "",
  searchKeywords: "",
  tagsInput: "",
  status: "DRAFT",
  categoryId: "",
  brandId: "",
  unitId: "",
  taxId: "",
  analyticAccountId: "",
  ...defaultsForItemType("PRODUCT"),
  ownership: "COMPANY",
  ownerAgentId: "",
  availableForInvestmentOpportunities: false,
  salesPrice: undefined,
  salesTaxIncluded: false,
  salesDescription: "",
  allowDiscount: true,
  purchasePrice: undefined,
  preferredPartnerId: "",
  purchaseDescription: "",
  reorderLevel: undefined,
  reorderQuantity: undefined,
  safetyStock: undefined,
  minQuantity: undefined,
  maxQuantity: undefined,
  storageLocation: "",
  preferredWarehouseId: "",
  inventoryTracking: "NONE",
  weight: undefined,
  width: undefined,
  height: undefined,
  length: undefined,
};

const numberOrUndefined = (value: string | null) => (value ? Number(value) : undefined);

/** The form's view of a stored product (also used to prefill a duplicate). */
export function toProductFormValues(source: ProductRow | null): ProductFormValues {
  if (!source) return productDefaultValues;
  return {
    name: source.name,
    nameEn: source.nameEn ?? "",
    internalName: source.internalName,
    displayName: source.displayName,
    barcode: source.barcode ?? "",
    qrCodeValue: source.qrCodeValue ?? "",
    imageUrl: source.imageUrl ?? "",
    description: source.description ?? "",
    shortDescription: source.shortDescription ?? "",
    longDescription: source.longDescription ?? "",
    internalNotes: source.internalNotes ?? "",
    searchKeywords: source.searchKeywords ?? "",
    tagsInput: (source.tags ?? []).join(", "),
    status: source.status,
    categoryId: source.categoryId,
    brandId: source.brandId ?? "",
    unitId: source.unitId,
    taxId: source.taxId ?? "",
    analyticAccountId: source.analyticAccountId ?? "",
    itemType: source.itemType ?? "",
    supplyMethod: source.supplyMethod ?? "PURCHASED",
    isSellable: source.isSellable,
    isPurchasable: source.isPurchasable,
    isInventoryItem: source.isInventoryItem,
    ownership: source.ownerAgentId ? "AGENT" : "COMPANY",
    ownerAgentId: source.ownerAgentId ?? "",
    availableForInvestmentOpportunities: source.availableForInvestmentOpportunities,
    salesPrice: numberOrUndefined(source.salesPrice),
    salesTaxIncluded: source.salesTaxIncluded,
    salesDescription: source.salesDescription ?? "",
    allowDiscount: source.allowDiscount,
    purchasePrice: numberOrUndefined(source.purchasePrice),
    preferredPartnerId: source.preferredPartnerId ?? "",
    purchaseDescription: source.purchaseDescription ?? "",
    reorderLevel: numberOrUndefined(source.reorderLevel),
    reorderQuantity: numberOrUndefined(source.reorderQuantity),
    safetyStock: numberOrUndefined(source.safetyStock),
    minQuantity: numberOrUndefined(source.minQuantity),
    maxQuantity: numberOrUndefined(source.maxQuantity),
    storageLocation: source.storageLocation ?? "",
    preferredWarehouseId: source.preferredWarehouseId ?? "",
    inventoryTracking: source.serialNumberTracking
      ? "SERIAL"
      : source.batchTracking
        ? "BATCH"
        : "NONE",
    weight: numberOrUndefined(source.weight),
    width: numberOrUndefined(source.width),
    height: numberOrUndefined(source.height),
    length: numberOrUndefined(source.length),
  };
}

/** The attribute slice of the form (what `attribute-rules` works on). */
export function attributesOf(
  values: Pick<
    ProductFormValues,
    "itemType" | "isSellable" | "isPurchasable" | "isInventoryItem" | "supplyMethod"
  >,
): ProductAttributes | null {
  if (!values.itemType) return null;
  return {
    itemType: values.itemType as ItemType,
    isSellable: values.isSellable,
    isPurchasable: values.isPurchasable,
    isInventoryItem: values.isInventoryItem,
    supplyMethod: values.supplyMethod as SupplyMethod,
  };
}
