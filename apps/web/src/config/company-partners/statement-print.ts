import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import type {
  GenericListPrintPayload,
  PrintCell,
  PrintCompanyInfo,
  PrintInfoItem,
} from "@/types/print-engine";
import type {
  PeriodStatement,
  StatementPeriodRow,
  StatementPeriodStatus,
} from "@/services/company-partners-service";

/** One payment of the statement as it prints (staff and portal shapes map onto it). */
export interface StatementPrintPayment {
  date: string;
  /** Payment number (and the payment's own reference). */
  reference: string;
  /** "Bank transfer" / «تحويل بنكي», "Reversed" appended when reversed. */
  description: string;
  amount: number;
}

export interface StatementPrintOptions {
  title: string;
  company: PrintCompanyInfo;
  printedByName: string | null;
  /** Reading direction of the sheet — the UI language's. */
  direction: "rtl" | "ltr";
  /** Scope strip: partner, period, currency, partnership. */
  meta: PrintInfoItem[];
  /** Plain-language notes (the estimate / approved distinction). */
  notes: string[];
  labels: {
    period: string;
    status: string;
    terms: string;
    entitlement: string;
    approvedDue: string;
    paid: string;
    remaining: string;
    periods: string;
    totalApproved: string;
    totalEstimated: string;
    payments: string;
    adjustments: string;
    none: string;
  };
  periodName: (row: StatementPeriodRow) => string;
  statusLabel: (status: StatementPeriodStatus) => string;
  terms: (row: StatementPeriodRow) => string;
}

type Row = Record<string, PrintCell>;
type Kind = NonNullable<GenericListPrintPayload["rowKinds"]>[number];

const COLUMNS = ["period", "status", "terms", "entitlement", "approvedDue", "paid", "remaining"];

const blankRow = (patch: Row): Row => ({
  ...Object.fromEntries(COLUMNS.map((key) => [key, ""])),
  ...patch,
});

/**
 * R15 (spec-w4 §6) — the partner statement on the shared Print Engine: A4
 * portrait (a statement, not a report), the company header with logo, print
 * date and page numbers from the engine, the scope strip, then one table —
 * the closing periods (status, terms, entitlement, approved due, paid,
 * remaining) with the approved total and the provisional total, then the
 * payment history and the adjustment history of the same range. Estimates
 * never print under an approved column: an open / under-review period
 * leaves approved, paid and remaining blank.
 */
export function buildPartnerStatementPrintPayload(
  statement: Pick<PeriodStatement, "periods" | "totals" | "adjustments">,
  payments: StatementPrintPayment[],
  options: StatementPrintOptions,
): GenericListPrintPayload {
  const { labels } = options;
  const money = (value: number | null) => (value === null ? "" : formatMoney(value));
  const rows: Row[] = [];
  const kinds: Kind[] = [];
  const push = (row: Row, kind: Kind) => {
    rows.push(blankRow(row));
    kinds.push(kind);
  };

  push({ period: labels.periods }, "section");
  for (const row of statement.periods) {
    push(
      {
        period: {
          text: options.periodName(row),
          sub: `${formatDate(row.periodFrom)} – ${formatDate(row.periodTo)}`,
        },
        status: options.statusLabel(row.status),
        terms: options.terms(row),
        entitlement: money(row.entitlement),
        approvedDue: money(row.approvedDue),
        paid: money(row.paid),
        remaining: money(row.remaining),
      },
      "detail",
    );
  }
  if (statement.periods.length === 0) push({ period: labels.none }, "detail");
  push(
    {
      period: labels.totalApproved,
      approvedDue: money(statement.totals.approvedDue),
      paid: money(statement.totals.paid),
      remaining: money(statement.totals.remaining),
    },
    "subtotal",
  );
  push(
    { period: labels.totalEstimated, entitlement: money(statement.totals.estimated) },
    "subtotal",
  );

  push({ period: labels.payments }, "section");
  for (const payment of payments) {
    push(
      {
        period: formatDate(payment.date),
        status: payment.description,
        terms: payment.reference,
        paid: money(payment.amount),
      },
      "detail",
    );
  }
  if (payments.length === 0) push({ period: labels.none }, "detail");

  push({ period: labels.adjustments }, "section");
  for (const adjustment of statement.adjustments) {
    push(
      {
        period: formatDate(adjustment.date),
        status: adjustment.reason,
        terms: `${formatDate(adjustment.periodFrom)} – ${formatDate(adjustment.periodTo)}`,
        approvedDue: money(adjustment.amount),
      },
      "detail",
    );
  }
  if (statement.adjustments.length === 0) push({ period: labels.none }, "detail");

  return {
    variant: "report",
    title: options.title,
    orientation: "portrait",
    direction: options.direction,
    company: options.company,
    printedByName: options.printedByName,
    meta: options.meta,
    notes: options.notes,
    columns: [
      { key: "period", label: labels.period, prose: true },
      { key: "status", label: labels.status, prose: true },
      { key: "terms", label: labels.terms, prose: true },
      { key: "entitlement", label: labels.entitlement, align: "end", width: "22mm" },
      { key: "approvedDue", label: labels.approvedDue, align: "end", width: "22mm" },
      { key: "paid", label: labels.paid, align: "end", width: "22mm" },
      { key: "remaining", label: labels.remaining, align: "end", width: "22mm" },
    ],
    rows,
    rowKinds: kinds,
  };
}
