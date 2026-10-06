import { AccountType } from '@prisma/client';
import { ROOT_CODE_BY_ACCOUNT_TYPE } from './code-generation.constants';

/** Maximum adjacency-list depth: system root (1) → group → sub → posting leaf. */
export const MAX_ACCOUNT_LEVEL = 4;

export const ACCOUNT_KIND = {
  POSTING: 'POSTING',
  AGGREGATION: 'AGGREGATION',
} as const;

export type AccountKind = (typeof ACCOUNT_KIND)[keyof typeof ACCOUNT_KIND];

/**
 * R13 B1 — the API / UI vocabulary for the Group / Posting choice. The
 * import file keeps its historical AGGREGATION spelling (= GROUP).
 */
export const CHART_ACCOUNT_KINDS = ['GROUP', 'POSTING'] as const;
export type ChartAccountKind = (typeof CHART_ACCOUNT_KINDS)[number];

/** `allowsPosting` for a requested kind; legacy boolean only when no kind. */
export function resolveAllowsPosting(input: {
  accountKind?: ChartAccountKind;
  allowsPosting?: boolean;
}): boolean | undefined {
  if (input.accountKind) return input.accountKind === 'POSTING';
  return input.allowsPosting;
}

export const ROOT_ACCOUNT_NAMES: Record<AccountType, string> = {
  ASSET: 'الأصول',
  LIABILITY: 'الالتزامات',
  EQUITY: 'حقوق الملكية',
  REVENUE: 'الإيرادات',
  EXPENSE: 'المصروفات',
};

export function isSystemRootCode(
  code: string,
  accountType: AccountType,
): boolean {
  return code === ROOT_CODE_BY_ACCOUNT_TYPE[accountType];
}

export function parseAccountKind(raw: string | undefined): AccountKind | null {
  const value = raw?.trim().toUpperCase();
  if (value === ACCOUNT_KIND.POSTING || value === ACCOUNT_KIND.AGGREGATION) {
    return value;
  }
  return null;
}
