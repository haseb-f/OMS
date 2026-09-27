import { createHash } from 'crypto';
import { normalizeArabicSearch } from '../common/text/arabic-search';

/**
 * Provider statement rows (payment-declaration-reconciliation §4) — the pure,
 * framework-free half of the statement pipeline: column mapping, row
 * validation/normalization, the content hash and the dedupe decision. File
 * imports, Google Sheets syncs and manual entry all run every row through
 * these same functions, so the three channels can never disagree on what a
 * "duplicate" or a "changed row" is.
 */

export const STATEMENT_FIELDS = [
  'providerReference',
  'customerName',
  'customerPhone',
  'amount',
  'currency',
  'transactionDate',
  'providerStatus',
  'orderReference',
  'fee',
  'net',
] as const;

export type StatementField = (typeof STATEMENT_FIELDS)[number];

/** Field → source column header. */
export type StatementColumnMapping = Partial<Record<StatementField, string>>;

export type StatementDateFormat = 'DMY' | 'MDY' | 'YMD';

export interface StatementMappingConfig {
  columns: StatementColumnMapping;
  /** Used when the file has no currency column (or the cell is blank). */
  defaultCurrencyCode?: string | null;
  /** ISO2 region hint for phone numbers written without a country code. */
  phoneRegion?: string | null;
  /** How to read an ambiguous `01/02/2026` date. ISO dates are always unambiguous. */
  dateFormat?: StatementDateFormat | null;
}

/** Header synonyms (en/ar, lower-cased, normalized) used to pre-fill the mapping step. */
const FIELD_SYNONYMS: Record<StatementField, string[]> = {
  providerReference: [
    'provider reference',
    'reference',
    'ref',
    'transaction id',
    'transaction reference',
    'txn id',
    'payment id',
    'رقم العمليه',
    'المرجع',
    'رقم المرجع',
    'رقم المعامله',
  ],
  customerName: [
    'customer name',
    'customer',
    'name',
    'payer',
    'payer name',
    'اسم العميل',
    'العميل',
    'الاسم',
  ],
  customerPhone: [
    'customer phone',
    'phone',
    'mobile',
    'phone number',
    'رقم الجوال',
    'الجوال',
    'الهاتف',
    'رقم الهاتف',
  ],
  amount: ['amount', 'gross', 'gross amount', 'total', 'المبلغ', 'الاجمالي'],
  currency: ['currency', 'ccy', 'العمله'],
  transactionDate: [
    'transaction date',
    'date',
    'payment date',
    'created at',
    'التاريخ',
    'تاريخ العمليه',
  ],
  providerStatus: ['status', 'provider status', 'state', 'الحاله'],
  orderReference: [
    'order reference',
    'order id',
    'order number',
    'order',
    'merchant reference',
    'رقم الطلب',
    'الطلب',
  ],
  fee: ['fee', 'fees', 'commission', 'العموله', 'الرسوم'],
  net: ['net', 'net amount', 'settlement amount', 'الصافي', 'صافي المبلغ'],
};

export const REQUIRED_STATEMENT_FIELDS: StatementField[] = [
  'amount',
  'transactionDate',
];

/** Provider statuses that prove the money moved / that it did not. Anything else is UNKNOWN (suggestible, flagged). */
export const SUCCESS_PROVIDER_STATUSES = [
  'PAID',
  'SUCCESS',
  'SUCCEEDED',
  'SUCCESSFUL',
  'CAPTURED',
  'COMPLETED',
  'COMPLETE',
  'SETTLED',
  'APPROVED',
  'AUTHORISED',
  'AUTHORIZED',
  'مدفوع',
  'ناجح',
  'ناجحه',
  'مكتمل',
  'مكتمله',
];
export const FAILED_PROVIDER_STATUSES = [
  'FAILED',
  'FAILURE',
  'DECLINED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
  'CANCELED',
  'VOIDED',
  'VOID',
  'REVERSED',
  'CHARGEBACK',
  'EXPIRED',
  'REJECTED',
  'فشل',
  'فاشل',
  'مرفوض',
  'مسترد',
  'ملغي',
  'ملغى',
];

export type ProviderStatusClass = 'SUCCESS' | 'FAILED' | 'UNKNOWN';

function statusToken(value: string): string {
  return normalizeArabicSearch(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

const SUCCESS_TOKENS = new Set(SUCCESS_PROVIDER_STATUSES.map(statusToken));
const FAILED_TOKENS = new Set(FAILED_PROVIDER_STATUSES.map(statusToken));

export function classifyProviderStatus(
  status: string | null | undefined,
): ProviderStatusClass {
  if (!status?.trim()) return 'UNKNOWN';
  const token = statusToken(status);
  if (FAILED_TOKENS.has(token)) return 'FAILED';
  if (SUCCESS_TOKENS.has(token)) return 'SUCCESS';
  return 'UNKNOWN';
}

function headerToken(value: string): string {
  return normalizeArabicSearch(value)
    .replace(/[_\-.:#/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort pre-fill for the mapping step — every guess stays editable by the user. */
export function suggestStatementMapping(
  headers: string[],
): StatementColumnMapping {
  const mapping: StatementColumnMapping = {};
  const used = new Set<string>();
  for (const field of STATEMENT_FIELDS) {
    const synonyms = FIELD_SYNONYMS[field].map(headerToken);
    const hit = headers.find(
      (header) => !used.has(header) && synonyms.includes(headerToken(header)),
    );
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

/** Mapping-level errors (before any row is read). Empty array ⇒ valid. */
export function validateStatementMapping(
  config: StatementMappingConfig,
  headers: string[],
): string[] {
  const errors: string[] = [];
  const columns = config.columns ?? {};
  for (const field of REQUIRED_STATEMENT_FIELDS) {
    if (!columns[field]) {
      errors.push(`Map a column to "${field}" — it is required.`);
    }
  }
  if (!columns.currency && !config.defaultCurrencyCode?.trim()) {
    errors.push(
      'Map a "currency" column or choose a default currency for the statement.',
    );
  }
  const headerSet = new Set(headers);
  for (const field of STATEMENT_FIELDS) {
    const header = columns[field];
    if (header && !headerSet.has(header)) {
      errors.push(
        `Column "${header}" (mapped to "${field}") is not in the source header row.`,
      );
    }
  }
  const mappedHeaders = Object.values(columns).filter(Boolean);
  const duplicates = mappedHeaders.filter(
    (header, index) => mappedHeaders.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    errors.push(`Column "${duplicates[0]}" is mapped to more than one field.`);
  }
  return errors;
}

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (char) => {
    const arabic = ARABIC_INDIC_DIGITS.indexOf(char);
    return String(arabic >= 0 ? arabic : PERSIAN_DIGITS.indexOf(char));
  });
}

/** "1,250.50 SAR" / "١٬٢٥٠٫٥٠" / "(12.00)" → number; null when blank or not numeric. */
export function parseStatementAmount(raw: string | null | undefined): {
  value: number | null;
  invalid: boolean;
} {
  const text = westernDigits((raw ?? '').trim())
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.');
  if (!text) return { value: null, invalid: false };
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const numeric = text.replace(/[^\d.]/g, '');
  if (!numeric || !/^\d*\.?\d+$/.test(numeric)) {
    return { value: null, invalid: true };
  }
  const value = Number(numeric) * (negative ? -1 : 1);
  return Number.isFinite(value)
    ? { value: Math.round(value * 100) / 100, invalid: false }
    : { value: null, invalid: true };
}

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Accepts ISO (`2026-09-20`, with or without time), `20/09/2026`-style dates per `format`, and Excel serial day numbers. Returns `YYYY-MM-DD`. */
export function parseStatementDate(
  raw: string | null | undefined,
  format: StatementDateFormat = 'DMY',
): string | null {
  const text = westernDigits((raw ?? '').trim());
  if (!text) return null;

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += 2000;
    if (format === 'MDY') return isoDate(year, a, b);
    return isoDate(year, b, a);
  }

  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel serial day (1900 date system; 25569 = 1970-01-01).
    const serial = Math.floor(Number(text));
    if (serial > 20000 && serial < 80000) {
      return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
    }
  }
  return null;
}

export interface NormalizedStatementRow {
  providerReference: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderReference: string | null;
  amount: number;
  currencyCode: string;
  /** `YYYY-MM-DD`. */
  transactionDate: string;
  providerStatus: string | null;
  feeAmount: number | null;
  netAmount: number | null;
}

export type StatementRowResult =
  { ok: true; row: NormalizedStatementRow } | { ok: false; errors: string[] };

function cell(
  raw: Record<string, string>,
  columns: StatementColumnMapping,
  field: StatementField,
): string | null {
  const header = columns[field];
  if (!header) return null;
  const value = raw[header];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.replace(/\s+/g, ' ') : null;
}

/**
 * Row validation (spec §4): amount > 0, currency exists, date parses,
 * fee ≤ amount, and net = amount − fee when both are present (else derived).
 * `knownCurrencyCodes` is the active currency catalog (upper-cased codes).
 */
export function normalizeStatementRow(
  raw: Record<string, string>,
  config: StatementMappingConfig,
  knownCurrencyCodes: ReadonlySet<string>,
): StatementRowResult {
  const columns = config.columns ?? {};
  const errors: string[] = [];

  const amountCell = cell(raw, columns, 'amount');
  const amount = parseStatementAmount(amountCell);
  if (amount.value === null) {
    errors.push(
      amount.invalid
        ? `Amount "${amountCell}" is not a number.`
        : 'Amount is required.',
    );
  } else if (amount.value <= 0) {
    errors.push(`Amount must be greater than zero (got ${amount.value}).`);
  }

  const currencyCode = (
    cell(raw, columns, 'currency') ??
    config.defaultCurrencyCode ??
    ''
  )
    .trim()
    .toUpperCase();
  if (!currencyCode) {
    errors.push('Currency is required.');
  } else if (!knownCurrencyCodes.has(currencyCode)) {
    errors.push(`Currency "${currencyCode}" is not defined in Currencies.`);
  }

  const dateCell = cell(raw, columns, 'transactionDate');
  const transactionDate = parseStatementDate(
    dateCell,
    config.dateFormat ?? 'DMY',
  );
  if (!dateCell) errors.push('Transaction date is required.');
  else if (!transactionDate) {
    errors.push(`Transaction date "${dateCell}" could not be read.`);
  }

  const feeCell = cell(raw, columns, 'fee');
  const netCell = cell(raw, columns, 'net');
  const fee = parseStatementAmount(feeCell);
  const net = parseStatementAmount(netCell);
  if (fee.invalid) errors.push(`Fee "${feeCell}" is not a number.`);
  if (net.invalid) errors.push(`Net "${netCell}" is not a number.`);

  let feeAmount = fee.value === null ? null : Math.abs(fee.value);
  let netAmount = net.value;
  if (amount.value !== null && amount.value > 0) {
    if (feeAmount !== null && feeAmount > amount.value) {
      errors.push(
        `Fee ${feeAmount} is larger than the amount ${amount.value}.`,
      );
    }
    if (feeAmount !== null && netAmount !== null) {
      const expected = Math.round((amount.value - feeAmount) * 100) / 100;
      if (Math.abs(expected - netAmount) > 0.005) {
        errors.push(
          `Net ${netAmount} does not equal amount ${amount.value} − fee ${feeAmount} (${expected}).`,
        );
      }
    } else if (feeAmount !== null) {
      netAmount = Math.round((amount.value - feeAmount) * 100) / 100;
    } else if (netAmount !== null) {
      const derivedFee = Math.round((amount.value - netAmount) * 100) / 100;
      if (derivedFee < 0) {
        errors.push(
          `Net ${netAmount} is larger than the amount ${amount.value}.`,
        );
      } else {
        feeAmount = derivedFee;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    row: {
      providerReference: cell(raw, columns, 'providerReference'),
      customerName: cell(raw, columns, 'customerName'),
      customerPhone: cell(raw, columns, 'customerPhone'),
      orderReference: cell(raw, columns, 'orderReference'),
      amount: amount.value as number,
      currencyCode,
      transactionDate: transactionDate as string,
      providerStatus: cell(raw, columns, 'providerStatus'),
      feeAmount,
      netAmount,
    },
  };
}

/** Content hash over the NORMALIZED values — whitespace/format noise in the source never reads as a change. */
export function statementRowHash(row: NormalizedStatementRow): string {
  const canonical = [
    row.providerReference ?? '',
    row.customerName ? normalizeArabicSearch(row.customerName) : '',
    row.customerPhone
      ? westernDigits(row.customerPhone).replace(/\D/g, '')
      : '',
    row.orderReference ?? '',
    row.amount.toFixed(2),
    row.currencyCode,
    row.transactionDate,
    row.providerStatus ? statusToken(row.providerStatus) : '',
    row.feeAmount === null ? '' : row.feeAmount.toFixed(2),
    row.netAmount === null ? '' : row.netAmount.toFixed(2),
  ].join('\u001f');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Dedupe identity, unique per payment method: the provider reference when present, else the content hash. */
export function statementDedupeKey(
  row: NormalizedStatementRow,
  rowHash: string,
): string {
  const reference = row.providerReference?.trim();
  return reference ? `ref:${reference}` : `hash:${rowHash}`;
}

export const EXCEPTION_REASON = {
  CHANGED_AFTER_MATCH: 'Source row changed after match',
  DELETED_AT_SOURCE: 'Deleted at source',
} as const;

export type StatementUpsertDecision =
  | 'CREATE'
  | 'DUPLICATE'
  | 'UPDATE'
  | 'REAPPEARED'
  | 'EXCEPTION_CHANGED_AFTER_MATCH';

export interface ExistingStatementLineState {
  status: 'UNMATCHED' | 'MATCHED' | 'EXCEPTION' | 'IGNORED';
  rowHash: string | null;
  matchedAmount: number;
  exceptionReason: string | null;
}

/**
 * The dedupe rule (spec §4 "never silently alter matched or posted records"):
 * - no line with this key ⇒ CREATE;
 * - identical content ⇒ DUPLICATE (counted, no change) — unless the line had
 *   been flagged "deleted at source" and was never matched, which re-opens it;
 * - changed content with no allocation yet ⇒ UPDATE (old values kept in the
 *   import summary);
 * - changed content on a line with ANY allocation ⇒ the line is left
 *   untouched and flagged EXCEPTION "Source row changed after match".
 */
export function decideStatementUpsert(
  existing: ExistingStatementLineState | null,
  incomingHash: string,
): StatementUpsertDecision {
  if (!existing) return 'CREATE';
  const deletedFlag =
    existing.status === 'EXCEPTION' &&
    existing.exceptionReason?.startsWith(EXCEPTION_REASON.DELETED_AT_SOURCE);
  if (existing.rowHash === incomingHash) {
    return deletedFlag && existing.matchedAmount === 0
      ? 'REAPPEARED'
      : 'DUPLICATE';
  }
  if (existing.matchedAmount > 0 || existing.status === 'MATCHED') {
    return 'EXCEPTION_CHANGED_AFTER_MATCH';
  }
  return 'UPDATE';
}

/** Line status implied by its allocations (used on re-open and after a match or a reversal). */
export function statusFromAllocation(
  amount: number,
  matchedAmount: number,
): 'UNMATCHED' | 'MATCHED' {
  return matchedAmount > 0 && Math.abs(amount - matchedAmount) < 0.005
    ? 'MATCHED'
    : 'UNMATCHED';
}
