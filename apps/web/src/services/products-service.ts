import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type ProductType =
  | "PURCHASE_ONLY"
  | "SALES_ONLY"
  | "PURCHASE_AND_SALE"
  | "MANUFACTURED"
  | "SERVICE"
  | "EXPENSE_ITEM";
export type ProductStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
/** R13 — the independent attributes (see `config/products/attribute-rules.ts`). */
export type ProductItemType = "PRODUCT" | "SERVICE";
export type ProductSupplyMethod = "PURCHASED" | "ASSEMBLED" | "KIT";

export interface ProductRow {
  id: string;
  name: string;
  nameEn: string | null;
  internalName: string;
  displayName: string;
  sku: string;
  barcode: string | null;
  qrCodeValue: string | null;
  searchKeywords: string | null;
  internalNotes: string | null;
  tags: string[];
  categoryId: string;
  category?: { id: string; name: string };
  brandId: string | null;
  brand?: { id: string; name: string } | null;
  unitId: string;
  unit?: { id: string; name: string };
  taxId: string | null;
  tax?: { id: string; name: string; rate: string } | null;
  analyticAccountId: string | null;
  analyticAccount?: { id: string; name: string } | null;
  preferredPartnerId: string | null;
  preferredSupplier?: { id: string; name: string } | null;
  description: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  type: ProductType;
  status: ProductStatus;
  imageUrl: string | null;
  isPurchasable: boolean;
  isSellable: boolean;
  isInventoryItem: boolean;
  /** Investor Engine Milestone 4, Part B — opt-in gate for the Investment Opportunity Product picker. */
  availableForInvestmentOpportunities: boolean;
  /** Agents milestone (spec §4) — owner agent of the goods; null = company-owned. */
  ownerAgentId?: string | null;
  /** commission-policy.md A2 — explicit commercial type; null = not classified yet (legacy rows only). */
  itemType?: ProductItemType | null;
  /** R13 — how the item is supplied; a Kit owns no stock, an Assembled item is built from its recipe. */
  supplyMethod: ProductSupplyMethod;
  ownerAgent?: { id: string; agentNumber?: string; name: string } | null;
  salesPrice: string | null;
  salesTaxIncluded: boolean;
  salesDescription: string | null;
  allowDiscount: boolean;
  purchasePrice: string | null;
  purchaseDescription: string | null;
  reorderLevel: string | null;
  reorderQuantity: string | null;
  safetyStock: string | null;
  minQuantity: string | null;
  maxQuantity: string | null;
  storageLocation: string | null;
  preferredWarehouseId: string | null;
  preferredWarehouse?: { id: string; code: string; name: string } | null;
  costingMethod: "AVERAGE" | "FIFO" | "STANDARD" | null;
  currentCost: string | null;
  lastCostUpdate: string | null;
  serialNumberTracking: boolean;
  batchTracking: boolean;
  weight: string | null;
  width: string | null;
  height: string | null;
  length: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface ProductVariantRow {
  id: string;
  productId: string;
  sku: string;
  attributes: { color?: string; size?: string; weight?: string };
  priceAdjustment: string | null;
  active: boolean;
  createdAt: string;
}

export interface ProductAttachmentRow {
  id: string;
  productId: string;
  uploadedById: string;
  fileUrl: string;
  fileName: string | null;
  description: string | null;
  createdAt: string;
}

/** `GET /products/similar-names` — a non-blocking duplicate-name hint (api-contract.md §1). */
export interface SimilarProductName {
  id: string;
  sku: string;
  name: string;
  displayName: string;
  categoryName: string;
  status: ProductStatus;
  match: "EXACT" | "CONTAINS" | "SIMILAR";
}

export type EffectiveSource = "PRODUCT" | "CATEGORY";
export interface EffectiveAccount {
  id: string;
  code: string;
  name: string;
  source: "CATEGORY" | "SETTINGS";
}
export type EffectiveAccountKind = "inventory" | "cogs" | "revenue" | "purchase";

/**
 * `GET /products/:id/effective-defaults` — read-only inheritance. `accounts`
 * and `commission` are omitted by the server when the caller may not see them.
 */
export interface ProductEffectiveDefaults {
  unit: { id: string; name: string; source: EffectiveSource };
  tax: { id: string; name: string; source: EffectiveSource } | null;
  accounts?: Record<EffectiveAccountKind, EffectiveAccount | null>;
  commission?: {
    itemType: ProductItemType | null;
    rate: number | string | null;
    source: "ITEM_OVERRIDE" | "AGREEMENT" | null;
  } | null;
}

export type InvestmentBlockedReasonCode = "AGENT_OWNED" | "SERVICE" | "NOT_SELLABLE" | "NOT_ACTIVE";

export interface ProductInvestmentOpportunity {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  status: string;
  fundedUnits: number;
  fundedUnitCost: string;
}

/** `GET /products/:id/investment-links` — `opportunities` is null without `investment-opportunities.view`. */
export interface ProductInvestmentLinks {
  eligible: boolean;
  blockedReason: InvestmentBlockedReasonCode | null;
  opportunities: ProductInvestmentOpportunity[] | null;
}

export type RecipeStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface RecipeLineRow {
  id: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  /** Decimal string — recipe quantities may be fractional (converted to whole stock units at use). */
  quantity: string;
  unitId: string;
  unitName: string;
  sortOrder: number;
}

export interface RecipeRow {
  id: string;
  version: number;
  status: RecipeStatus;
  effectiveFrom: string | null;
  /** Batch output: >= 1 for an Assembled item, exactly 1 for a Kit. */
  outputQuantity: number | string;
  /** Estimate only (Assembled) — never an actual cost. */
  directCostEstimate: string | null;
  notes: string | null;
  lines: RecipeLineRow[];
}

export interface RecipeLineInput {
  componentProductId: string;
  quantity: number | string;
  unitId: string;
}

export interface RecipeInput {
  outputQuantity?: number;
  directCostEstimate?: number | null;
  notes?: string;
  lines: RecipeLineInput[];
}

export interface CreateRecipeInput extends RecipeInput {
  /** Copies the lines of an existing version into the new DRAFT. */
  copyFromRecipeId?: string;
}

/** `GET /products/:id/recipe-cost-estimate` — costs are omitted without the cost-visibility right. */
export interface RecipeCostEstimate {
  recipeId: string;
  version: number;
  isEstimate: true;
  lines: {
    componentProductId: string;
    name: string;
    quantityStock: number | string;
    unitCost?: string | null;
    value?: string | null;
  }[];
  componentsEstimate?: string | null;
  directCostEstimate?: string | null;
  totalEstimate?: string | null;
  perUnitEstimate?: string | null;
}

/** `GET /products/:id/kit-availability`. */
export interface KitAvailability {
  productId: string;
  available: number;
  limiting: { productId: string; name: string; available: number; perKit: number } | null;
  components: { productId: string; name: string; perKit: number; available: number }[];
}

export interface ProductListParams {
  ids?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  includeArchived?: boolean;
  categoryId?: string;
  brandId?: string;
  taxId?: string;
  status?: ProductStatus | ProductStatus[];
  type?: ProductType | ProductType[];
  /** `UNSET` lists legacy rows still to be classified. */
  itemType?: ProductItemType | "UNSET";
  /** R13 — Purchased / Assembled / Kit (list and catalog). */
  supplyMethod?: ProductSupplyMethod;
  isInventoryItem?: boolean;
  isSellable?: boolean;
  isPurchasable?: boolean;
  investmentEligible?: boolean;
  /** Agents milestone — products owned by this agent (requires `agents.view`). */
  agentId?: string;
  /** Management list: company-owned only, or any agent-owned. */
  ownership?: "COMPANY" | "AGENT";
}

export interface ProductActivityEntry {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  createdBy: string | null;
}

interface ProductListResult {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const productsService = {
  list: (params: ProductListParams = {}) =>
    apiClient.get<ProductListResult>(
      `/products${buildQueryString(params as unknown as Record<string, unknown>)}`,
    ),
  /**
   * ACTIVE-only sellable/purchasable catalog for a picker (Lead conversion,
   * Store/Purchase Order create, Inventory movements) — readable by anyone
   * who holds an order- or movement-creation permission, not just
   * `products.view`. Never use for the Product management list/table.
   */
  catalog: (params: ProductListParams = {}) =>
    apiClient.get<ProductListResult>(
      `/products/catalog${buildQueryString(params as unknown as Record<string, unknown>)}`,
    ),
  get: (id: string) => apiClient.get<ProductRow>(`/products/${id}`),
  create: (dto: Record<string, unknown>) => apiClient.post<ProductRow>("/products", dto),
  update: (id: string, dto: Record<string, unknown>) =>
    apiClient.patch<ProductRow>(`/products/${id}`, dto),
  /** Product Creation Wizard — the "تفعيل المنتج" action. Validates only Name/Category/Unit server-side. */
  activate: (id: string) => apiClient.post<ProductRow>(`/products/${id}/activate`),
  archive: (id: string) => apiClient.post<ProductRow>(`/products/${id}/archive`),
  restore: (id: string) => apiClient.post<ProductRow>(`/products/${id}/restore`),
  activity: (id: string) => apiClient.get<ProductActivityEntry[]>(`/products/${id}/activities`),

  /** Debounced while typing a name — advisory only, a match never blocks saving. */
  similarNames: (params: { name: string; excludeId?: string; categoryId?: string }) =>
    apiClient.get<{ items: SimilarProductName[] }>(
      `/products/similar-names${buildQueryString(params as unknown as Record<string, unknown>)}`,
    ),
  effectiveDefaults: (id: string) =>
    apiClient.get<ProductEffectiveDefaults>(`/products/${id}/effective-defaults`),
  investmentLinks: (id: string) =>
    apiClient.get<ProductInvestmentLinks>(`/products/${id}/investment-links`),
  recipeCostEstimate: (id: string) =>
    apiClient.get<RecipeCostEstimate>(`/products/${id}/recipe-cost-estimate`),
  kitAvailability: (id: string, warehouseId?: string) =>
    apiClient.get<KitAvailability>(
      `/products/${id}/kit-availability${buildQueryString({ warehouseId })}`,
    ),

  /** R13 versioned recipes (assembly BOM / kit composition) — api-contract.md §2. */
  recipes: {
    list: (productId: string) => apiClient.get<RecipeRow[]>(`/products/${productId}/recipes`),
    create: (productId: string, dto: CreateRecipeInput) =>
      apiClient.post<RecipeRow>(`/products/${productId}/recipes`, dto),
    /** DRAFT only; `lines` replaces all. */
    update: (recipeId: string, dto: RecipeInput) =>
      apiClient.patch<RecipeRow>(`/recipes/${recipeId}`, dto),
    /** DRAFT only. */
    remove: (recipeId: string) => apiClient.delete<void>(`/recipes/${recipeId}`),
    activate: (recipeId: string) => apiClient.post<RecipeRow>(`/recipes/${recipeId}/activate`),
    retire: (recipeId: string) => apiClient.post<RecipeRow>(`/recipes/${recipeId}/retire`),
  },

  variants: {
    list: (productId: string) =>
      apiClient.get<ProductVariantRow[]>(`/products/${productId}/variants`),
    create: (productId: string, dto: Record<string, unknown>) =>
      apiClient.post<ProductVariantRow>(`/products/${productId}/variants`, dto),
    update: (productId: string, id: string, dto: Record<string, unknown>) =>
      apiClient.patch<ProductVariantRow>(`/products/${productId}/variants/${id}`, dto),
    remove: (productId: string, id: string) =>
      apiClient.delete<void>(`/products/${productId}/variants/${id}`),
  },

  attachments: {
    list: (productId: string) =>
      apiClient.get<ProductAttachmentRow[]>(`/products/${productId}/attachments`),
    create: (productId: string, dto: Record<string, unknown>) =>
      apiClient.post<ProductAttachmentRow>(`/products/${productId}/attachments`, dto),
  },
};
