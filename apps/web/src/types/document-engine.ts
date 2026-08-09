/**
 * Document Engine foundation (ADR-0022 Part 6) — architecture only, no PDF
 * generation yet. Every printable document OMS ever produces (Quotation,
 * Sales Order, Tax Invoice, Simplified Invoice, Purchase Order, Purchase
 * Request, Customer/Supplier Statement, Receipt/Payment/Journal Voucher,
 * Inventory Transfer, Delivery Note, Packing List, Picking List) is a
 * `DocumentData` rendered through the Enterprise Print Engine's
 * Invoice/Statement/Receipt/Voucher templates
 * (`components/print/templates/document-print-template.tsx`) — never a
 * bespoke template, and never printed except through that engine's
 * isolated `/print/document` route (TASK-032).
 */

export type DocumentType =
  | "quotation"
  | "sales-order"
  | "tax-invoice"
  | "simplified-invoice"
  | "sales-return"
  | "purchase-order"
  | "purchase-request"
  | "customer-statement"
  | "supplier-statement"
  | "receipt-voucher"
  | "payment-voucher"
  | "journal-voucher"
  | "inventory-transfer"
  | "delivery-note"
  | "packing-list"
  | "picking-list";

export type PaperSize = "a4-portrait" | "a4-landscape";
export type DocumentLanguageMode = "rtl" | "ltr" | "bilingual";

/** Per-company branding — configurable independently of any single document type. */
export interface DocumentBranding {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  headerText?: string;
  footerText?: string;
  paperSize: PaperSize;
  language: DocumentLanguageMode;
}

/**
 * QR codes are configurable per document type (e.g. a future ZATCA
 * Simplified Invoice QR) — the engine only knows "does this type want a QR,
 * and what payload does it encode," never how to render country-specific
 * compliance rules itself. `payloadFields` names which document fields feed
 * the QR so a future compliance profile can be swapped in without touching
 * any template.
 */
export interface QrCodeConfig {
  enabled: boolean;
  payloadFields: string[];
  /** e.g. "zatca-v1" — left open for future country-specific profiles. */
  complianceProfile?: string;
}

/** One row in a document's line-items table. Intentionally generic — not tied to a Product/Order shape yet. */
export interface DocumentLineItem {
  id: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  total: number;
}

export interface DocumentParty {
  name: string;
  taxNumber?: string;
  addressLines: string[];
  phone?: string;
  email?: string;
}

export interface DocumentTotal {
  label: string;
  value: number;
  emphasis?: boolean;
}

export interface DocumentSignature {
  label: string;
  name?: string;
}

/**
 * The shared shape every document type renders — `DocumentLayout` lays these
 * regions out identically every time: Header → Company Info → Document Info
 * → Party Info → Line Items table → Totals → Notes → Signatures → Footer.
 */
export interface DocumentData {
  type: DocumentType;
  documentNumber: string;
  documentDate: string;
  currency: string;
  company: {
    name: string;
    taxNumber?: string;
    addressLines: string[];
    branding: DocumentBranding;
  };
  party: DocumentParty;
  /** Extra document-specific fields shown in the "Document Information" block (e.g. due date, PO reference). */
  meta: { label: string; value: string }[];
  lineItems: DocumentLineItem[];
  totals: DocumentTotal[];
  notes?: string;
  signatures?: DocumentSignature[];
  qrCode?: QrCodeConfig;
}

/** Registry of which document types require a QR code by default — a future compliance module can override this per company. */
export const DOCUMENT_TYPES_WITH_QR: ReadonlySet<DocumentType> = new Set([
  "tax-invoice",
  "simplified-invoice",
]);
