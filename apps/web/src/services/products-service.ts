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
  preferredSupplierId: string | null;
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

export interface ProductComponentRow {
  id: string;
  kitProductId: string;
  componentProductId: string;
  componentProduct?: { id: string; name: string; displayName: string; sku: string };
  quantity: string;
  createdAt: string;
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

export interface ProductListParams {
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
  isInventoryItem?: boolean;
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
  get: (id: string) => apiClient.get<ProductRow>(`/products/${id}`),
  create: (dto: Record<string, unknown>) => apiClient.post<ProductRow>("/products", dto),
  update: (id: string, dto: Record<string, unknown>) =>
    apiClient.patch<ProductRow>(`/products/${id}`, dto),
  /** Product Creation Wizard — the "تفعيل المنتج" action. Validates only Name/Category/Unit server-side. */
  activate: (id: string) => apiClient.post<ProductRow>(`/products/${id}/activate`),
  archive: (id: string) => apiClient.post<ProductRow>(`/products/${id}/archive`),
  restore: (id: string) => apiClient.post<ProductRow>(`/products/${id}/restore`),
  activity: (id: string) => apiClient.get<ProductActivityEntry[]>(`/products/${id}/activities`),

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

  components: {
    list: (kitProductId: string) =>
      apiClient.get<ProductComponentRow[]>(`/products/${kitProductId}/components`),
    create: (kitProductId: string, dto: { componentProductId: string; quantity: number }) =>
      apiClient.post<ProductComponentRow>(`/products/${kitProductId}/components`, dto),
    update: (kitProductId: string, id: string, dto: { quantity: number }) =>
      apiClient.patch<ProductComponentRow>(`/products/${kitProductId}/components/${id}`, dto),
    remove: (kitProductId: string, id: string) =>
      apiClient.delete<void>(`/products/${kitProductId}/components/${id}`),
  },
};
