import type { DocumentData } from "./document-engine";

/**
 * Enterprise Print Engine (TASK-032) — the ONLY way any module in OMS
 * produces printed output. No page ever calls `window.print()` on itself;
 * instead it hands data to `usePrintEngine()`, which opens an isolated
 * `/print/*` route containing nothing but the rendered template. That
 * route is the only place `window.print()` is ever called.
 */

export type PrintOrientation = "portrait" | "landscape";

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
}

/** Backs GenericListPrintTemplate and ReportPrintTemplate — any table of business rows (a Master Data list, Products, or an accounting report). */
export interface GenericListPrintPayload {
  variant: "list" | "report";
  title: string;
  subtitle?: string;
  documentNumber?: string;
  /** Defaults to "landscape" — every list/report in the Print Policy is landscape. */
  orientation?: PrintOrientation;
  company: PrintCompanyInfo;
  printedByName: string | null;
  columns: PrintColumn[];
  rows: Record<string, string>[];
}

export type DocumentPrintVariant = "invoice" | "statement" | "receipt" | "voucher";

/** Backs Invoice/Statement/Receipt/Voucher print templates — reuses the existing `DocumentData` shape (already carries its own company/branding/paper-size), so no second company-info shape is invented for this family. */
export interface DocumentPrintPayload {
  variant: DocumentPrintVariant;
  title: string;
  printedByName: string | null;
  data: DocumentData;
  labels: {
    documentNumber: string;
    documentDate: string;
    billTo: string;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
    notes: string;
  };
}
