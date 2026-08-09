import { apiClient } from "./api-client";

export interface OpeningBalanceInput {
  productId: string;
  warehouseId: string;
  quantity: number;
  notes?: string;
  unitCost?: number;
}

export interface AdjustmentInput {
  productId: string;
  warehouseId: string;
  /** Signed delta — positive receives stock in, negative issues it out. */
  quantity: number;
  /** Required (TASK-029) — the structured "why" behind every adjustment. */
  reason: string;
  notes?: string;
}

export interface TransferLineInput {
  productId: string;
  quantity: number;
}

export interface TransferInput {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  lines: TransferLineInput[];
  notes?: string;
}

export interface InventoryMovementRow {
  id: string;
  movementNumber: string;
  type: string;
  warehouseId: string;
  warehouse?: { code: string; name: string };
  productId: string;
  product?: {
    sku: string;
    name: string;
    displayName: string;
    analyticAccount?: { name: string } | null;
  };
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost: number | null;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByUser?: { fullName: string } | null;
}

export interface StockCard {
  productId: string;
  sku: string;
  productName: string;
  onHand: number;
  reserved: number;
  available: number;
  averageCost: number | null;
  lastCost: number | null;
  stockValue: number | null;
  lastMovement: { id: string; movementNumber: string; type: string; createdAt: string } | null;
}

export interface WarehouseBalanceRow {
  productId: string;
  product: { sku: string; name: string; displayName: string } | null;
  warehouseId: string;
  warehouse: { code: string; name: string } | null;
  onHand: number;
}

export type InventoryValuationMethod = "AVERAGE_COST" | "FIFO";

export interface InventorySettings {
  id: number;
  valuationMethod: InventoryValuationMethod;
  updatedAt: string;
}

/**
 * Client for the Inventory module's business operations — Opening Balance
 * (TASK-028) plus the Inventory Foundation's read surfaces (TASK-030): the
 * append-only movement ledger, the per-product Stock EnterpriseCard, and the
 * system-wide valuation method setting. Still no generic CRUD here —
 * InventoryMovement is never created/edited through a form, only through
 * these named business operations.
 */
export const inventoryService = {
  openingBalance: (dto: OpeningBalanceInput) =>
    apiClient.post<{ id: string }>("/inventory/opening-balance", dto),
  adjustment: (dto: AdjustmentInput) =>
    apiClient.post<{ id: string }>("/inventory/adjustment", dto),
  transfer: (dto: TransferInput) =>
    apiClient.post<{
      transferNumber: string;
      lines: { out: { id: string }; in: { id: string } }[];
    }>("/inventory/transfer", dto),
  getMovements: (params: { productId?: string; warehouseId?: string; type?: string } = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    const qs = search.toString();
    return apiClient.get<InventoryMovementRow[]>(`/inventory/movements${qs ? `?${qs}` : ""}`);
  },
  getStockCards: () => apiClient.get<StockCard[]>("/inventory/stock-cards"),
  getWarehouseBalances: () => apiClient.get<WarehouseBalanceRow[]>("/inventory/warehouse-balances"),
  getStockCard: (productId: string) =>
    apiClient.get<StockCard>(`/inventory/stock-card/${productId}`),
  getValuationSettings: () => apiClient.get<InventorySettings>("/inventory/valuation-method"),
  updateValuationSettings: (valuationMethod: InventoryValuationMethod) =>
    apiClient.patch<InventorySettings>("/inventory/valuation-method", { valuationMethod }),
};
