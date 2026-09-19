import type { MessageKey } from "@/i18n/translate";

/**
 * Canonical sourceType → document route map. Journal Entries and source
 * documents both resolve traceability through this table so a new posting
 * provider only needs one entry here.
 */
export interface JournalSourceDefinition {
  sourceType: string;
  href?: (sourceId: string) => string;
  labelKey: MessageKey;
  generated: boolean;
}

export const JOURNAL_SOURCE_DEFINITIONS: Record<string, JournalSourceDefinition> = {
  MANUAL: {
    sourceType: "MANUAL",
    labelKey: "accounting.journalEntries.sourceTypes.MANUAL",
    generated: false,
  },
  SALES_INVOICE: {
    sourceType: "SALES_INVOICE",
    href: (id) => `/sales/invoices/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.SALES_INVOICE",
    generated: true,
  },
  PURCHASE_INVOICE: {
    sourceType: "PURCHASE_INVOICE",
    href: (id) => `/purchasing/purchase-invoices/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.PURCHASE_INVOICE",
    generated: true,
  },
  SALES_RETURN: {
    sourceType: "SALES_RETURN",
    href: (id) => `/sales/returns/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.SALES_RETURN",
    generated: true,
  },
  PURCHASE_RETURN: {
    sourceType: "PURCHASE_RETURN",
    href: (id) => `/purchasing/purchase-returns/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.PURCHASE_RETURN",
    generated: true,
  },
  CUSTOMER_RECEIPT: {
    sourceType: "CUSTOMER_RECEIPT",
    href: (id) => `/sales/payments/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.CUSTOMER_RECEIPT",
    generated: true,
  },
  SUPPLIER_PAYMENT: {
    sourceType: "SUPPLIER_PAYMENT",
    href: (id) => `/purchasing/payments/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.SUPPLIER_PAYMENT",
    generated: true,
  },
  LANDED_COST: {
    sourceType: "LANDED_COST",
    href: (id) => `/purchasing/landed-cost/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.LANDED_COST",
    generated: true,
  },
  EXPENSE_PAYMENT: {
    sourceType: "EXPENSE_PAYMENT",
    labelKey: "accounting.journalEntries.sourceTypes.EXPENSE_PAYMENT",
    generated: true,
  },
  INVENTORY_ADJUSTMENT: {
    sourceType: "INVENTORY_ADJUSTMENT",
    href: () => `/inventory/movements`,
    labelKey: "accounting.journalEntries.sourceTypes.INVENTORY_ADJUSTMENT",
    generated: true,
  },
  SHIPMENT_COST: {
    sourceType: "SHIPMENT_COST",
    href: () => `/shipping`,
    labelKey: "accounting.journalEntries.sourceTypes.SHIPMENT_COST",
    generated: true,
  },
  FULFILLMENT_COST: {
    sourceType: "FULFILLMENT_COST",
    href: (id) => `/store-orders/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.FULFILLMENT_COST",
    generated: true,
  },
  PAYROLL_RUN: {
    sourceType: "PAYROLL_RUN",
    href: (id) => `/hr/payroll/${id}`,
    labelKey: "accounting.journalEntries.sourceTypes.PAYROLL_RUN",
    generated: true,
  },
  PAYROLL_PAYMENT: {
    sourceType: "PAYROLL_PAYMENT",
    href: () => `/hr/payroll`,
    labelKey: "accounting.journalEntries.sourceTypes.PAYROLL_PAYMENT",
    generated: true,
  },
  BANK_TRANSACTION_TRANSFER: {
    sourceType: "BANK_TRANSACTION_TRANSFER",
    href: () => `/finance/bank-transactions`,
    labelKey: "accounting.journalEntries.sourceTypes.BANK_TRANSACTION_TRANSFER",
    generated: true,
  },
  OPENING_BALANCE: {
    sourceType: "OPENING_BALANCE",
    href: () => `/finance/opening-balances`,
    labelKey: "accounting.journalEntries.sourceTypes.OPENING_BALANCE",
    generated: true,
  },
  YEAR_CLOSING: {
    sourceType: "YEAR_CLOSING",
    href: () => `/finance/year-closing`,
    labelKey: "accounting.journalEntries.sourceTypes.YEAR_CLOSING",
    generated: true,
  },
  FIXED_ASSET_CAPITALIZATION: {
    sourceType: "FIXED_ASSET_CAPITALIZATION",
    href: () => `/finance/fixed-assets`,
    labelKey: "accounting.journalEntries.sourceTypes.FIXED_ASSET_CAPITALIZATION",
    generated: true,
  },
  FIXED_ASSET_DEPRECIATION: {
    sourceType: "FIXED_ASSET_DEPRECIATION",
    href: () => `/finance/fixed-assets`,
    labelKey: "accounting.journalEntries.sourceTypes.FIXED_ASSET_DEPRECIATION",
    generated: true,
  },
  FIXED_ASSET_DISPOSAL: {
    sourceType: "FIXED_ASSET_DISPOSAL",
    href: () => `/finance/fixed-assets`,
    labelKey: "accounting.journalEntries.sourceTypes.FIXED_ASSET_DISPOSAL",
    generated: true,
  },
  PREPAID_EXPENSE: {
    sourceType: "PREPAID_EXPENSE",
    href: () => `/finance/prepaid-expenses`,
    labelKey: "accounting.journalEntries.sourceTypes.PREPAID_EXPENSE",
    generated: true,
  },
  PREPAID_RECOGNITION: {
    sourceType: "PREPAID_RECOGNITION",
    href: () => `/finance/prepaid-expenses`,
    labelKey: "accounting.journalEntries.sourceTypes.PREPAID_RECOGNITION",
    generated: true,
  },
  ACCRUED_EXPENSE: {
    sourceType: "ACCRUED_EXPENSE",
    href: () => `/finance/accrued-expenses`,
    labelKey: "accounting.journalEntries.sourceTypes.ACCRUED_EXPENSE",
    generated: true,
  },
  ACCRUED_EXPENSE_SETTLEMENT: {
    sourceType: "ACCRUED_EXPENSE_SETTLEMENT",
    href: () => `/finance/accrued-expenses`,
    labelKey: "accounting.journalEntries.sourceTypes.ACCRUED_EXPENSE_SETTLEMENT",
    generated: true,
  },
  FX_REVALUATION: {
    sourceType: "FX_REVALUATION",
    href: () => `/finance/exchange-rates`,
    labelKey: "accounting.journalEntries.sourceTypes.FX_REVALUATION",
    generated: true,
  },
  CAPITAL_CONTRIBUTION: {
    sourceType: "CAPITAL_CONTRIBUTION",
    href: () => `/investors/list`,
    labelKey: "accounting.journalEntries.sourceTypes.CAPITAL_CONTRIBUTION",
    generated: true,
  },
  INVESTOR_DISTRIBUTION: {
    sourceType: "INVESTOR_DISTRIBUTION",
    href: () => `/investors/list`,
    labelKey: "accounting.journalEntries.sourceTypes.INVESTOR_DISTRIBUTION",
    generated: true,
  },
  INVESTOR_PROFIT_PAYMENT: {
    sourceType: "INVESTOR_PROFIT_PAYMENT",
    href: () => `/investors/list`,
    labelKey: "accounting.journalEntries.sourceTypes.INVESTOR_PROFIT_PAYMENT",
    generated: true,
  },
  CAPITAL_RETURN: {
    sourceType: "CAPITAL_RETURN",
    href: () => `/investors/list`,
    labelKey: "accounting.journalEntries.sourceTypes.CAPITAL_RETURN",
    generated: true,
  },
};

export function isManualJournalSource(sourceType: string | null | undefined): boolean {
  return !sourceType || sourceType === "MANUAL";
}

export function isGeneratedJournalSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false;
  return JOURNAL_SOURCE_DEFINITIONS[sourceType]?.generated ?? sourceType !== "MANUAL";
}

export function journalSourceHref(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): string | null {
  if (!sourceType || !sourceId) return null;
  return JOURNAL_SOURCE_DEFINITIONS[sourceType]?.href?.(sourceId) ?? null;
}

export function journalSourceLabelKey(sourceType: string | null | undefined): MessageKey {
  if (!sourceType) return "accounting.journalEntries.sourceTypes.MANUAL";
  return (
    JOURNAL_SOURCE_DEFINITIONS[sourceType]?.labelKey ??
    "accounting.journalEntries.fields.sourceDocument"
  );
}
