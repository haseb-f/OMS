import type { PhoneNumberService } from '../../common/phone/phone-number.service';
import { extractExistingRecordId, groupRowsByKey } from '../import-value.util';
import { referenceValueKey } from '../list-sheet/list-sheet.normalize';
import type {
  ImportDuplicateGroup,
  ImportRowValidationError,
} from '../import-jobs.service';

export type SyncReviewStatus = 'READY' | 'WARNING' | 'ERROR' | 'DUPLICATE';
export type SyncReviewLifecycle =
  | 'NEW'
  | 'RETRY'
  | 'IMPORTED'
  | 'UNCHANGED_FAILURE'
  | 'ORPHAN_LINK'
  | 'EXTERNAL_DUP'
  | 'PHONE_MATCH'
  | 'DELETED';

export interface SyncReviewIssue {
  field: string | null;
  code: string;
  message: string;
  originalValue?: string | null;
  normalizedValue?: string | null;
}

export interface SyncReviewRow {
  id: string;
  rowNumber: number;
  rowNumbers: number[];
  status: SyncReviewStatus;
  values: Record<string, string>;
  sourceRow: Record<string, string>;
  originalPhone: string | null;
  normalizedPhone: string | null;
  countryName: string | null;
  issues: SyncReviewIssue[];
  existingRecordId: string | null;
  lifecycle?: SyncReviewLifecycle;
  changed?: boolean;
  retryable?: boolean;
}

const PHONE_KEYS = ['customerPhone', 'mobileNumber', 'phone'] as const;

function phoneValue(values: Record<string, string>): string {
  for (const key of PHONE_KEYS) {
    const value = values[key]?.trim();
    if (value) return value;
  }
  return '';
}

function phoneField(values: Record<string, string>): string | null {
  for (const key of PHONE_KEYS) {
    if (values[key]?.trim()) return key;
  }
  return values.customerPhone !== undefined
    ? 'customerPhone'
    : values.mobileNumber !== undefined
      ? 'mobileNumber'
      : values.phone !== undefined
        ? 'phone'
        : null;
}

function isDuplicateMessage(message: string): boolean {
  return /already exists|duplicate /i.test(message);
}

function issueCode(message: string, columnName: string | null): string {
  if (isDuplicateMessage(message)) return 'DUPLICATE';
  if (/غير موجود في (المنتجات|البيانات) الأساسية/.test(message)) {
    return 'MASTER_DATA_NOT_FOUND';
  }
  if (/يوجد أكثر من .+ مطابق/.test(message)) return 'MASTER_DATA_AMBIGUOUS';
  if (/موجودة لكنها غير نشطة/.test(message)) return 'MASTER_DATA_INACTIVE';
  if (/is required/i.test(message)) return 'REQUIRED';
  if (/too short/i.test(message)) return 'PHONE_TOO_SHORT';
  if (/too long/i.test(message)) return 'PHONE_TOO_LONG';
  if (/does not match the selected country/i.test(message))
    return 'PHONE_INVALID_COUNTRY';
  if (/does not look like a phone/i.test(message)) return 'PHONE_NOT_A_NUMBER';
  if (/phone number/i.test(message)) return 'PHONE_INVALID';
  if (columnName) return 'FIELD';
  return 'GENERIC';
}

function isPhoneIssue(issue: SyncReviewIssue): boolean {
  if (issue.code.startsWith('PHONE')) return true;
  if (issue.field && /phone|mobile|جوال/i.test(issue.field)) return true;
  return /phone number|phone is required/i.test(issue.message);
}

export function buildSyncReviewRows(args: {
  jobId: string;
  groupKey: string | null | undefined;
  mappedRows: Array<{
    rowNumber: number;
    mappedRow: Record<string, string>;
    sourceRow?: Record<string, string>;
  }>;
  errors: ImportRowValidationError[];
  needsReview: Array<{ rowNumber: number; reason: string }>;
  duplicateGroups: ImportDuplicateGroup[];
  countryCodeByName: Map<string, string>;
  phone: PhoneNumberService;
}): SyncReviewRow[] {
  const errorsByRow = new Map<number, ImportRowValidationError[]>();
  for (const error of args.errors) {
    const list = errorsByRow.get(error.rowNumber) ?? [];
    list.push(error);
    errorsByRow.set(error.rowNumber, list);
  }
  const reviewByRow = new Map(
    args.needsReview.map((row) => [row.rowNumber, row.reason]),
  );

  const groups = args.groupKey
    ? groupRowsByKey(args.mappedRows, args.groupKey)
    : new Map(args.mappedRows.map((row) => [`${row.rowNumber}`, [row]]));

  const rows: SyncReviewRow[] = [];
  for (const groupRows of groups.values()) {
    const primary = groupRows[0];
    const rowNumbers = groupRows.map((row) => row.rowNumber);
    const values = { ...primary.mappedRow };
    const issues: SyncReviewIssue[] = [];
    let existingRecordId: string | null = null;

    for (const { rowNumber } of groupRows) {
      for (const error of errorsByRow.get(rowNumber) ?? []) {
        const existing = extractExistingRecordId(error.message);
        if (existing) existingRecordId = existing;
        if (
          issues.some(
            (issue) =>
              issue.message === error.message &&
              issue.field === error.columnName,
          )
        ) {
          continue;
        }
        issues.push({
          field: error.columnName,
          code: issueCode(error.message, error.columnName),
          message: error.message,
        });
      }
      const reviewReason = reviewByRow.get(rowNumber);
      if (
        reviewReason &&
        !issues.some((issue) => issue.message === reviewReason)
      ) {
        issues.push({
          field: null,
          code: 'NEEDS_REVIEW',
          message: reviewReason,
        });
      }
    }

    const rawPhone = phoneValue(values);
    const countryName = values.countryName?.trim() || null;
    const region = countryName
      ? args.countryCodeByName.get(referenceValueKey(countryName))
      : undefined;
    const parsed = rawPhone ? args.phone.parse(rawPhone, region) : null;
    const originalPhone = rawPhone || null;
    const normalizedPhone = parsed?.isValid ? (parsed.e164 ?? null) : null;

    for (const issue of issues) {
      if (!isPhoneIssue(issue)) continue;
      issue.field = issue.field ?? phoneField(values);
      issue.originalValue = originalPhone;
      issue.normalizedValue = normalizedPhone;
    }

    const fileDuplicate = groupRows.some((row) =>
      args.duplicateGroups.some((group) =>
        group.rowNumbers.includes(row.rowNumber),
      ),
    );
    if (fileDuplicate && !issues.some((issue) => issue.code === 'DUPLICATE')) {
      const group = args.duplicateGroups.find((item) =>
        groupRows.some((row) => item.rowNumbers.includes(row.rowNumber)),
      );
      issues.push({
        field: group?.field ?? null,
        code: 'DUPLICATE',
        message: group
          ? `Duplicate ${group.field} "${group.value}"`
          : 'Duplicate row in the source file.',
      });
    }

    const hasDuplicate = issues.some((issue) => issue.code === 'DUPLICATE');
    const hasNeedsReview = issues.some(
      (issue) => issue.code === 'NEEDS_REVIEW',
    );
    const hasError = issues.some(
      (issue) => issue.code !== 'DUPLICATE' && issue.code !== 'NEEDS_REVIEW',
    );

    let status: SyncReviewStatus = 'READY';
    if (hasError) status = 'ERROR';
    else if (hasDuplicate) status = 'DUPLICATE';
    else if (hasNeedsReview) status = 'WARNING';

    rows.push({
      id: `${args.jobId}:${rowNumbers.join('-')}`,
      rowNumber: primary.rowNumber,
      rowNumbers,
      status,
      values,
      sourceRow: primary.sourceRow ?? {},
      originalPhone,
      normalizedPhone,
      countryName,
      issues,
      existingRecordId,
    });
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  return rows;
}
