import { AccountType } from '@prisma/client';
import { ROOT_CODE_BY_ACCOUNT_TYPE } from './code-generation.constants';

/** Maximum adjacency-list depth: system root (1) → group → sub → posting leaf. */
export const MAX_ACCOUNT_LEVEL = 4;

export const ACCOUNT_KIND = {
  POSTING: 'POSTING',
  AGGREGATION: 'AGGREGATION',
} as const;

export type AccountKind = (typeof ACCOUNT_KIND)[keyof typeof ACCOUNT_KIND];

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
