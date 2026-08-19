import { FinancialTransactionType } from '@prisma/client';

/**
 * Canonical Financial Transaction Type vocabulary for OMS.
 *
 * `FinancialTransaction.type` remains a closed Prisma enum (receipt vs
 * payment vs expense payment). This catalog is the ONE place Arabic List
 * Sheet values, direction (قبض / صرف), import resolution, and OMS
 * dropdowns read from. Do not add a second hardcoded list or a CRUD table.
 *
 * Payment Method / Payment Source / Payment Terms are different concepts
 * and must not be merged into this catalog.
 */
export const FINANCIAL_TRANSACTION_TYPE_CATALOG = [
  {
    code: 'CUSTOMER_RECEIPT',
    label: 'تحصيل من عميل',
    direction: 'IN',
    isSystem: true,
  },
  {
    code: 'SUPPLIER_PAYMENT',
    label: 'سداد مورد',
    direction: 'OUT',
    isSystem: true,
  },
  {
    code: 'EXPENSE_PAYMENT',
    label: 'مصروف تشغيلي',
    direction: 'OUT',
    isSystem: true,
  },
] as const;

export type FinancialTransactionTypeCode =
  (typeof FINANCIAL_TRANSACTION_TYPE_CATALOG)[number]['code'];

export type FinancialTransactionDirection =
  (typeof FINANCIAL_TRANSACTION_TYPE_CATALOG)[number]['direction'];

export const FINANCIAL_TRANSACTION_TYPE_SHEET_LABELS: Record<string, string> =
  Object.fromEntries(
    FINANCIAL_TRANSACTION_TYPE_CATALOG.map((type) => [type.code, type.label]),
  );

export function typesForDirection(direction: FinancialTransactionDirection) {
  return FINANCIAL_TRANSACTION_TYPE_CATALOG.filter(
    (type) => type.direction === direction,
  );
}

/**
 * Accepts an enum code (`CUSTOMER_RECEIPT`) or the canonical Arabic label
 * (`تحصيل من عميل`). Returns the enum value, or null when unknown.
 */
export function resolveFinancialTransactionType(
  raw: string | undefined,
): FinancialTransactionType | null {
  const value = raw?.trim();
  if (!value) return null;
  const upper = value.toUpperCase();
  for (const type of FINANCIAL_TRANSACTION_TYPE_CATALOG) {
    if (type.code === upper || type.label === value) {
      return type.code;
    }
  }
  return null;
}
