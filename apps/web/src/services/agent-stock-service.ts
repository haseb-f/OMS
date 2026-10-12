import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type { Paged } from "./agents-service";

/**
 * R18 B — agent-owned consignment stock: custody receipts (opening stock and
 * later receipts, quantities only — never a cost) and the agent's stock
 * movement history. The portal reads its own history through
 * `agentPortalService.stockMovements`.
 */
export type AgentStockReceiptKind = "OPENING" | "RECEIPT";

export interface AgentStockReceiptLine {
  id: string;
  productId: string;
  quantity: number;
  movementId: string;
  product: { sku: string; name: string; nameEn: string | null; displayName: string | null };
  movement: { movementNumber: string; type: string };
}

export interface AgentStockReceipt {
  id: string;
  receiptNumber: string;
  agentId: string;
  warehouseId: string;
  kind: AgentStockReceiptKind;
  /** YYYY-MM-DD business day. */
  receiptDate: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  totalQuantity: number;
  agent: { id: string; agentNumber: string; name: string };
  warehouse: { id: string; code: string; name: string };
  createdByUser: { fullName: string } | null;
  lines: AgentStockReceiptLine[];
  replayed?: boolean;
}

export interface AgentStockReceiptInput {
  agentId: string;
  warehouseId: string;
  kind: AgentStockReceiptKind;
  receiptDate?: string;
  reference?: string;
  notes?: string;
  idempotencyKey: string;
  lines: { productId: string; quantity: number }[];
}

export type AgentStockEvent =
  | "OPENING"
  | "RECEIPT"
  | "RESERVED"
  | "RELEASED"
  | "DISPATCHED"
  | "BACK_FROM_TRANSIT"
  | "DELIVERED"
  | "RETURNED"
  | "ADJUSTED"
  | "WRITTEN_OFF"
  | "TRANSFERRED";

export type AgentStockDocument =
  | { kind: "AGENT_STOCK_RECEIPT"; id: string; number: string }
  | { kind: "STORE_ORDER"; id: string; number: string }
  | { kind: "AGENT_RETURN"; id: string; number: string; storeOrderId: string };

export interface AgentStockMovement {
  id: string;
  movementNumber: string;
  type: string;
  event: AgentStockEvent;
  quantity: number;
  createdAt: string;
  product: {
    id: string;
    sku: string;
    name: string;
    nameEn: string | null;
    displayName: string | null;
  };
  warehouse: { id: string; code: string; name: string; role: string };
  document: AgentStockDocument | null;
}

const RECEIPTS = "/agent-stock-receipts";

export const agentStockService = {
  receipts: (
    params: {
      agentId?: string;
      receiptId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => apiClient.get<Paged<AgentStockReceipt>>(`${RECEIPTS}${buildQueryString(params)}`),
  createReceipt: (dto: AgentStockReceiptInput) => apiClient.post<AgentStockReceipt>(RECEIPTS, dto),
  movements: (
    agentId: string,
    params: { productId?: string; page?: number; pageSize?: number } = {},
  ) =>
    apiClient.get<Paged<AgentStockMovement>>(
      `/agents/${agentId}/stock-movements${buildQueryString(params)}`,
    ),
};
