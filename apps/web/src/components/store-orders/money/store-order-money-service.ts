import { apiClient } from "@/services/api-client";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";

/**
 * R15 W5b — a store order's money after the sale (D15-9 … D15-12). Every
 * figure is computed by the API from posted documents (the same position the
 * refund caps enforce); the client only displays it.
 */
export type CodTracking = "TRACKED" | "NOT_TRACKED" | "NOT_APPLICABLE";
export type ReverseBlock = "MATCHED" | "SETTLED" | "AGENT_RECEIVED" | null;

export interface StoreOrderMoneyFigures {
  payable: number;
  declared: number;
  expectedFromCarrier: number;
  collected: number;
  withCarrier: number;
  awaitingSettlement: number;
  inBank: number;
  invoiced: number;
  credited: number;
  refunded: number;
  balanceDue: number;
  refundDue: number;
  refundable: number;
  customerCreditBalance: number;
}

export interface StoreOrderMoneyPayment {
  id: string;
  paymentNumber: string;
  origin: string;
  status: string;
  amount: number;
  paymentDate: string;
  verifiedAt: string | null;
  settlementStatus: string;
  settledAmount: number;
  method: { id: string; name: string } | null;
  reversedAt: string | null;
  reversalReason: string | null;
  receipt: { id: string; transactionNumber: string; status: string } | null;
  /** Null for a VERIFIED payment that can be reversed (always null when not VERIFIED). */
  reverseBlock: ReverseBlock;
}

export interface StoreOrderMoneyInvoice {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  shipmentId: string | null;
  createdAt: string;
  shipment: { id: string; attemptNumber: number; trackingNumber: string | null } | null;
}

export interface StoreOrderReturnCredit {
  salesReturnId: string;
  returnNumber: string;
  createdAt: string;
  grandTotal: number;
  refunded: number;
  unrefunded: number;
}

export interface StoreOrderMoneyRefund {
  id: string;
  transactionNumber: string;
  transactionDate: string;
  referenceNumber: string | null;
  amount: number;
  againstReturns: number;
}

export interface StoreOrderMoney {
  storeOrderId: string;
  internalOrderId: string;
  partnerId: string;
  currency: { id: string; code: string };
  paymentType: "PREPAID" | "CASH_ON_DELIVERY";
  isAgentOrder: boolean;
  cancelled: boolean;
  figures: StoreOrderMoneyFigures;
  codCollection: { tracking: CodTracking; carrierName: string | null; methodName: string | null };
  payments: StoreOrderMoneyPayment[];
  invoices: StoreOrderMoneyInvoice[];
  returnCredits: StoreOrderReturnCredit[];
  refunds: StoreOrderMoneyRefund[];
}

export interface ReturnableLine {
  salesInvoiceItemId: string;
  productId: string;
  sku: string;
  name: string;
  invoicedQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
  lineTotal: string;
}

export type ReturnItemCondition = "SALEABLE" | "DAMAGED";

export interface StoreOrderReturnItem {
  id: string;
  productId: string;
  quantity: number;
  condition: ReturnItemCondition;
  lineTotal: string;
  salesInvoiceItemId: string | null;
  product: { sku: string; name: string };
  warehouse: { id: string; code: string; name: string; role: string };
}

export interface StoreOrderReturn {
  id: string;
  returnNumber: string;
  status: string;
  reason: string | null;
  grandTotal: string;
  salesInvoiceId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  /** True until the goods are received and inspected (no stock, no posting yet). */
  requested: boolean;
  items: StoreOrderReturnItem[];
}

export interface StoreOrderReturnsOverview {
  storeOrderId: string;
  isAgentOrder: boolean;
  recognitionStatus: string;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    shipmentId: string | null;
    lines: ReturnableLine[];
  }>;
  returns: StoreOrderReturn[];
}

/** What "Record refund" accepts on one order now (all in the order currency). */
export interface StoreOrderRefundable {
  storeOrderId: string;
  internalOrderId: string;
  partnerId: string;
  currencyId: string;
  active: boolean;
  collected: number;
  invoiced: number;
  credited: number;
  refunded: number;
  expected: number;
  balanceDue: number;
  refundDue: number;
  advanceRefundable: number;
  returnCredits: StoreOrderReturnCredit[];
  customerCreditBalance: number;
  refundable: number;
}

export interface RecordOrderRefundPayload {
  amount: number;
  receivingAccountId: string;
  paymentSourceId?: string;
  transactionDate?: string;
  referenceNumber?: string;
  notes?: string;
  idempotencyKey: string;
}

export const storeOrderMoneyService = {
  get: (storeOrderId: string) =>
    apiClient.get<StoreOrderMoney>(`/store-orders/${storeOrderId}/money`),
  returns: (storeOrderId: string) =>
    apiClient.get<StoreOrderReturnsOverview>(`/store-orders/${storeOrderId}/returns`),
  requestReturn: (
    storeOrderId: string,
    payload: {
      reason: string;
      lines: { salesInvoiceItemId: string; quantity: number }[];
      idempotencyKey: string;
    },
  ) =>
    apiClient.post<{ replayed: boolean; returns: StoreOrderReturn[] }>(
      `/store-orders/${storeOrderId}/returns`,
      payload,
    ),
  receiveReturn: (
    storeOrderId: string,
    salesReturnId: string,
    lines: { salesReturnItemId: string; condition: ReturnItemCondition; warehouseId?: string }[],
  ) =>
    apiClient.post<StoreOrderReturn>(
      `/store-orders/${storeOrderId}/returns/${salesReturnId}/receive`,
      { lines },
    ),
  refundable: (storeOrderId: string) =>
    apiClient.get<StoreOrderRefundable>(
      `/financial-transactions/refunds/store-orders/${storeOrderId}`,
    ),
  recordRefund: (storeOrderId: string, payload: RecordOrderRefundPayload) =>
    apiClient.post<FinancialTransactionRow>(
      `/financial-transactions/refunds/store-orders/${storeOrderId}`,
      payload,
    ),
  reversePayment: (paymentId: string, reason: string) =>
    apiClient.post<{ id: string; paymentNumber: string; status: string }>(
      `/payments/${paymentId}/reverse`,
      { reason },
    ),
};
