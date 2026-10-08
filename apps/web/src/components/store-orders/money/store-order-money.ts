import type { MessageKey } from "@/i18n/translate";
import type {
  ReturnItemCondition,
  StoreOrderMoney,
  StoreOrderMoneyFigures,
  StoreOrderReturnsOverview,
} from "./store-order-money-service";

/**
 * Pure presentation rules of the order "Collection" panel (R15 W5b). The
 * figures themselves are computed by the API — these only decide what is
 * shown, never recompute money.
 */

export interface FigureRow {
  key: keyof StoreOrderMoneyFigures;
  labelKey: MessageKey;
  /** Emphasised (a balance the user acts on). */
  strong?: boolean;
}

const OWED: FigureRow[] = [
  { key: "payable", labelKey: "storeOrderMoney.panel.figures.payable" },
  { key: "invoiced", labelKey: "storeOrderMoney.panel.figures.invoiced" },
  { key: "credited", labelKey: "storeOrderMoney.panel.figures.credited" },
  { key: "balanceDue", labelKey: "storeOrderMoney.panel.figures.balanceDue", strong: true },
];

const RECEIVED: FigureRow[] = [
  { key: "declared", labelKey: "storeOrderMoney.panel.figures.declared" },
  { key: "expectedFromCarrier", labelKey: "storeOrderMoney.panel.figures.expectedFromCarrier" },
  { key: "collected", labelKey: "storeOrderMoney.panel.figures.collected" },
  { key: "withCarrier", labelKey: "storeOrderMoney.panel.figures.withCarrier" },
  { key: "awaitingSettlement", labelKey: "storeOrderMoney.panel.figures.awaitingSettlement" },
  { key: "inBank", labelKey: "storeOrderMoney.panel.figures.inBank" },
  { key: "refunded", labelKey: "storeOrderMoney.panel.figures.refunded" },
  { key: "refundDue", labelKey: "storeOrderMoney.panel.figures.refundDue", strong: true },
];

/** Shown even at zero: the anchors of each group. */
const ALWAYS: (keyof StoreOrderMoneyFigures)[] = ["payable", "balanceDue", "collected"];

/** The two figure groups, hiding stages that hold nothing on this order (progressive disclosure). */
export function figureGroups(figures: StoreOrderMoneyFigures): {
  owed: FigureRow[];
  received: FigureRow[];
} {
  const visible = (row: FigureRow) =>
    ALWAYS.includes(row.key) || Math.abs(figures[row.key]) > 0.005;
  return { owed: OWED.filter(visible), received: RECEIVED.filter(visible) };
}

export type MoneyNotice = "REFUND_PENDING" | "COD_NOT_TRACKED" | "COD_TRACKED" | "CANCELLED";

/** Standing notices of the panel, most actionable first. */
export function moneyNotices(money: StoreOrderMoney): MoneyNotice[] {
  const notices: MoneyNotice[] = [];
  if (money.figures.refundDue > 0.005) notices.push("REFUND_PENDING");
  if (money.codCollection.tracking === "NOT_TRACKED") notices.push("COD_NOT_TRACKED");
  if (money.codCollection.tracking === "TRACKED") notices.push("COD_TRACKED");
  if (money.cancelled) notices.push("CANCELLED");
  return notices;
}

/** "Record refund" is offered only when the API says something can be refunded now. */
export function canRecordRefund(money: StoreOrderMoney): boolean {
  return !money.isAgentOrder && money.figures.refundable > 0.005;
}

/** "Return" needs delivered (invoiced) quantity not returned yet; agent goods never come back this way. */
export function hasReturnableLines(overview: StoreOrderReturnsOverview): boolean {
  return (
    !overview.isAgentOrder &&
    overview.invoices.some((invoice) => invoice.lines.some((line) => line.returnableQuantity > 0))
  );
}

export type ReturnQuantityError = "invalid" | "tooMany";

/**
 * The request lines from the typed quantities (keyed by invoice line):
 * whole positive numbers up to what is still returnable on that line.
 */
export function buildReturnRequestLines(
  overview: StoreOrderReturnsOverview,
  quantities: Record<string, string>,
): {
  lines: { salesInvoiceItemId: string; quantity: number }[];
  errors: Record<string, ReturnQuantityError>;
} {
  const lines: { salesInvoiceItemId: string; quantity: number }[] = [];
  const errors: Record<string, ReturnQuantityError> = {};
  for (const invoice of overview.invoices) {
    for (const line of invoice.lines) {
      const raw = quantities[line.salesInvoiceItemId]?.trim();
      if (!raw) continue;
      const quantity = Number(raw);
      if (!Number.isInteger(quantity) || quantity < 0) {
        errors[line.salesInvoiceItemId] = "invalid";
        continue;
      }
      if (quantity > line.returnableQuantity) {
        errors[line.salesInvoiceItemId] = "tooMany";
        continue;
      }
      if (quantity > 0) lines.push({ salesInvoiceItemId: line.salesInvoiceItemId, quantity });
    }
  }
  return { lines, errors };
}

/** The receive payload: every line's inspected condition; a warehouse only when the user overrode the default. */
export function buildInspectionLines(
  items: { id: string }[],
  conditions: Record<string, ReturnItemCondition>,
  warehouses: Record<string, string | undefined>,
): { salesReturnItemId: string; condition: ReturnItemCondition; warehouseId?: string }[] {
  return items.map((item) => ({
    salesReturnItemId: item.id,
    condition: conditions[item.id] ?? "SALEABLE",
    ...(warehouses[item.id] ? { warehouseId: warehouses[item.id] } : {}),
  }));
}
