import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

/** R13 assembly orders (api-contract.md §4). Cost figures are `null` for a caller without cost visibility. */
export type AssemblyStatus = "POSTED" | "REVERSED";

export interface AssemblyBlocker {
  code: string;
  message: string;
}

/** `GET /assembly/preview` — what an assembly of `quantity` units needs, and why it cannot happen (blockers). */
export interface AssemblyPreview {
  canAssemble: boolean;
  blockers: AssemblyBlocker[];
  recipe: { id: string; version: number } | null;
  /** False for agent-owned consignment stock (R19 A): quantities only, every cost figure is null. */
  valued: boolean;
  /** Finished units the assembly receives into the warehouse. */
  finishedQuantity: number;
  lines: {
    componentProductId: string;
    name: string;
    /** Whole stock units needed for the requested quantity. */
    quantity: number;
    onHand: number;
    /** Held for other documents (orders) — never consumed by an assembly. */
    reserved: number;
    /** `onHand − reserved`. */
    available: number;
    shortage: number;
    unitCost: string | null;
    value: string | null;
  }[];
  componentCost: string | null;
  directCostEstimate: string | null;
  estimatedUnitCost: string | null;
  maximumQuantity: number;
}

export interface AssemblyOrderLine {
  id: string;
  componentProductId: string;
  componentSku: string;
  componentName: string;
  quantity: number;
  unitCost: string | null;
  value: string | null;
  consumptionMovementId: string | null;
  reversalMovementId: string | null;
}

export interface AssemblyOrder {
  id: string;
  assemblyNumber: string;
  status: AssemblyStatus;
  productId: string;
  product: { id: string; sku: string; name: string };
  warehouseId: string;
  warehouse: { id: string; code: string; name: string };
  recipeId: string;
  recipeVersion: number;
  quantity: number;
  ownerAgentId: string | null;
  /** False for agent-owned consignment stock: no cost figure exists (all null). */
  valued: boolean;
  componentCost: string | null;
  directCost: string | null;
  totalCost: string | null;
  unitCost: string | null;
  lines: AssemblyOrderLine[];
  outputMovementId: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
}

export interface CreateAssemblyInput {
  productId: string;
  warehouseId: string;
  quantity: number;
  /** 2-dp decimal string; only with `inventory.assembly.direct_cost`. */
  directCost?: string;
  notes?: string;
}

export interface AssemblyListParams {
  productId?: string;
  warehouseId?: string;
  status?: AssemblyStatus;
  /** Only the assemblies of this agent's consignment stock (R19 A). */
  agentId?: string;
  /** Inclusive `YYYY-MM-DD` (a plain date covers the whole day). */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AssemblyListResult {
  items: AssemblyOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export const assemblyService = {
  preview: (params: { productId: string; warehouseId: string; quantity: number }) =>
    apiClient.get<AssemblyPreview>(`/assembly/preview${buildQueryString({ ...params })}`),
  /**
   * `idempotencyKey` goes in the `Idempotency-Key` header: a retried / double
   * submitted request with the same key returns the original order (HTTP 200)
   * instead of assembling twice.
   */
  create: (dto: CreateAssemblyInput, idempotencyKey: string) =>
    apiClient.post<AssemblyOrder>("/assembly", dto, { "Idempotency-Key": idempotencyKey }),
  list: (params: AssemblyListParams = {}) =>
    apiClient.get<AssemblyListResult>(`/assembly${buildQueryString({ ...params })}`),
  get: (id: string) => apiClient.get<AssemblyOrder>(`/assembly/${id}`),
  reverse: (id: string, reason: string) =>
    apiClient.post<AssemblyOrder>(`/assembly/${id}/reverse`, { reason }),
};
