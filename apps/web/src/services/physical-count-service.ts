import { apiClient } from "./api-client";

export type PhysicalCountStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export interface PhysicalCountLineRow {
  id: string;
  productId: string;
  product: { sku: string; name: string; displayName: string };
  systemQuantity: number;
  countedQuantity: number | null;
  movementId: string | null;
  movement?: { id: string; movementNumber: string } | null;
}

export interface PhysicalCountRow {
  id: string;
  countNumber: string;
  warehouseId: string;
  warehouse: { code: string; name: string };
  status: PhysicalCountStatus;
  notes: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalCountListRow extends PhysicalCountRow {
  _count: { lines: number };
}

export interface PhysicalCountDetailRow extends PhysicalCountRow {
  lines: PhysicalCountLineRow[];
}

export interface CreatePhysicalCountInput {
  warehouseId: string;
  productIds?: string[];
  notes?: string;
}

/**
 * Client for Physical Inventory Count (TASK-029) — a counting document with
 * one line per product; confirming generates real PHYSICAL_COUNT movements
 * for every line with a counted/system difference (ADR-0013).
 */
export const physicalCountService = {
  list: () => apiClient.get<PhysicalCountListRow[]>("/physical-counts"),
  get: (id: string) => apiClient.get<PhysicalCountDetailRow>(`/physical-counts/${id}`),
  create: (dto: CreatePhysicalCountInput) =>
    apiClient.post<PhysicalCountDetailRow>("/physical-counts", dto),
  updateLine: (countId: string, lineId: string, countedQuantity: number) =>
    apiClient.patch<PhysicalCountDetailRow>(`/physical-counts/${countId}/lines/${lineId}`, {
      countedQuantity,
    }),
  confirm: (id: string) => apiClient.post<PhysicalCountDetailRow>(`/physical-counts/${id}/confirm`),
  cancel: (id: string) => apiClient.post<PhysicalCountDetailRow>(`/physical-counts/${id}/cancel`),
};
