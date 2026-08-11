import { AccountType } from '@prisma/client';

/**
 * The single digit every root (no-parent) account of a given classification
 * gets, matching the standard 1=Assets/2=Liabilities/3=Equity/4=Revenue/
 * 5=Expense numbering convention — never invented per-account, never
 * client-supplied for a normal create.
 */
export const ROOT_CODE_BY_ACCOUNT_TYPE: Record<AccountType, string> = {
  ASSET: '1',
  LIABILITY: '2',
  EQUITY: '3',
  REVENUE: '4',
  EXPENSE: '5',
};

/**
 * Digit-width for an auto-generated child account code's own suffix segment,
 * by the *parent's* hierarchy level — reproduces the standard shallow
 * classification levels using a single digit (1 -> 11 -> 111) and widens to
 * 2 digits once you reach the transactional/leaf level (111 -> 11101,
 * 11102, ...), matching the numbering convention illustrated in the CoA
 * spec. A function, not a flat constant, so a future company-numbering-
 * scheme setting can override the rule without touching the generation
 * logic itself.
 */
export function suffixDigitWidthForParentLevel(parentLevel: number): number {
  return parentLevel <= 2 ? 1 : 2;
}
