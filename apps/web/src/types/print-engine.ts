import type { DocumentData } from "./document-engine";

/**
 * Enterprise Print Engine (TASK-032; Print Design System, specs/print-design-system)
 * — the ONLY way any module in OMS produces printed output. No page ever
 * calls `window.print()` on itself; instead it hands data to
 * `usePrintEngine()`, which opens an isolated `/print/*` route containing a
 * preview of the rendered template and its print action.
 */

export type PrintOrientation = "portrait" | "landscape";
export type PrintPaper = "A4" | "A5";

/**
 * Lightweight company header info for list/report prints. Only `name` is
 * guaranteed — every other field stays undefined until a real Company
 * Profile backend exists (no VAT/CR/address/phone/email/website field
 * exists on `CompanyContext` yet), so the header simply omits whatever
 * isn't there rather than fabricating placeholder business data.
 */
export interface PrintCompanyInfo {
  name: string;
  logoUrl?: string | null;
  vatNumber?: string;
  crNumber?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;
  website?: string;
}

export interface PrintColumn {
  key: string;
  label: string;
  align?: "start" | "center" | "end";
  /** Fixed width (e.g. "22mm"); the remaining width goes to unsized columns. */
  width?: string;
  /** Keep the cell on one line (dates, references). */
  nowrap?: boolean;
}

/** A table cell: plain text, or a main line with a smaller secondary line (SKU, reference). */
export type PrintCell = string | { text: string; sub?: string };

/** Row presentation: report hierarchy, statement opening/closing, totals. */
export type PrintRowKind =
  "section" | "parent" | "detail" | "subtotal" | "grand-total" | "opening" | "closing" | "total";

export interface PrintInfoItem {
  label: string;
  value: string;
  /** Numbers / codes: isolated LTR run. */
  ltr?: boolean;
}

/** Backs GenericListPrintTemplate and ReportPrintTemplate — any table of business rows (a Master Data list, Products, or an accounting report). */
export interface GenericListPrintPayload {
  variant: "list" | "report";
  title: string;
  /** Legacy single-line scope; prefer `meta`. */
  subtitle?: string;
  /** Report scope (period, currency, basis, every active filter) — printed as a strip. */
  meta?: PrintInfoItem[];
  documentNumber?: string;
  /** Defaults to "landscape" — every list/report in the Print Policy is landscape. */
  orientation?: PrintOrientation;
  /** Reading direction of the printed sheet — the UI language's direction at print time. Defaults to the print tab's own document direction. */
  direction?: "rtl" | "ltr";
  company: PrintCompanyInfo;
  printedByName: string | null;
  columns: PrintColumn[];
  rows: Record<string, PrintCell>[];
  /**
   * Financial-report hierarchy, one entry per row (same order as `rows`):
   * `section` bold with a top rule, `parent` medium, `detail` regular,
   * `subtotal` bold + top rule, `grand-total` bold + double top rule. The
   * indent is already carried in the label text.
   */
  rowKinds?: Array<"section" | "parent" | "detail" | "subtotal" | "grand-total">;
  /** Rows the source holds in total, when the printout is capped below it. */
  totalRowCount?: number;
}

export type DocumentPrintVariant = "invoice" | "statement" | "receipt" | "voucher";

/** One line of a journal voucher (account / description / debit / credit). */
export interface PrintLedgerLine {
  /** Pre-resolved "code — name". */
  account: string;
  description?: string;
  debit: number;
  credit: number;
}

/** A journal voucher's own layout — never shimmed onto invoice columns. */
export interface PrintLedger {
  lines: PrintLedgerLine[];
  totalDebit: number;
  totalCredit: number;
  labels: { account: string; description: string; debit: string; credit: string };
}

/**
 * Backs the commercial-document and voucher templates — reuses the
 * `DocumentData` shape (company, party, lines, totals, notes).
 */
export interface DocumentPrintPayload {
  variant: DocumentPrintVariant;
  /** Document type name ("Sales invoice") — the number is printed separately. */
  title: string;
  printedByName: string | null;
  data: DocumentData;
  /**
   * In-app path of the record (e.g. `/sales/invoices/<id>`). When set, the
   * printed document carries a QR code that opens it in OMS.
   */
  recordPath?: string;
  /** Set for journal vouchers — renders the account/description/debit/credit layout. */
  ledger?: PrintLedger;
  /** Legacy per-builder labels; only `notes` / `billTo` are still read when present. */
  labels?: Partial<{
    documentNumber: string;
    documentDate: string;
    billTo: string;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
    notes: string;
  }>;
}

/** One dated movement of an account statement. */
export interface StatementPrintMovement {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Customer / supplier account statement (spec §3). */
export interface StatementPrintPayload {
  variant: "account-statement";
  title: string;
  printedByName: string | null;
  company: PrintCompanyInfo;
  partyRole: "customer" | "supplier";
  party: { name: string; number?: string; lines: string[]; phone?: string; taxNumber?: string };
  /** Display text of the covered period ("All dates" when unbounded). */
  period: string;
  currency: string;
  openingBalance: number;
  movements: StatementPrintMovement[];
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  recordPath?: string;
}

/** What the courier / pickup desk must do about money (spec §4). */
export type SlipCollection =
  | { kind: "collect"; amount: number; orderTotal: number; declaredPaid: number }
  | { kind: "none"; basis: "DECLARED_PAID" | "VERIFIED_PAID" | "COD_SETTLED" }
  | { kind: "hold" };

/** Store-order A5 package slip (spec §4). */
export interface PackageSlipPayload {
  variant: "package-slip";
  printedByName: string | null;
  company: PrintCompanyInfo;
  orderNumber: string;
  externalOrderId?: string;
  orderDate: string;
  method: "SHIPPING" | "PICKUP";
  paymentType: "PREPAID" | "CASH_ON_DELIVERY";
  currency: string;
  customer: { name: string; phone?: string; addressLines: string[] };
  items: { name: string; sku?: string; quantity: number }[];
  collection: SlipCollection;
  /** Only when the carrier already issued one — never invented. */
  carrier?: { name?: string; trackingNumber?: string };
  recordPath: string;
}
