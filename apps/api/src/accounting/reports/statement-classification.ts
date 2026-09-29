import {
  STANDARD_CHART_OF_ACCOUNTS,
  type PostingRole,
} from '../foundation/standard-chart-of-accounts';
import type { CoaNode } from './financial-report-tree';

/**
 * Report-layer classification of Chart of Accounts rows into financial
 * statement lines (accounting review, specs/usability-financial-reports/
 * accounting-review.md). Nothing here is stored or posted: a line is
 * resolved from what the ledger already says about an account —
 *
 *   1. the account's own configured posting role (Posting Settings /
 *      agent / category / payment-method / receiving-account mappings);
 *   2. otherwise the nearest ancestor with a role, or the nearest ancestor
 *      that is one of the standard OMS COA headers (41, 42, 52, 53 …) with
 *      the same account type as the standard definition;
 *   3. otherwise UNCLASSIFIED — surfaced explicitly, never dropped.
 *
 * Every account resolves to exactly one line, so the statements partition
 * the ledger (asserted by the specs).
 */

export type ReportRole =
  | PostingRole
  | 'AGENT_COMMISSION_REVENUE'
  | 'AGENT_SERVICE_REVENUE'
  | 'AGENT_FUNDS_PAYABLE'
  | 'PAYMENT_CLEARING'
  | 'CASH_ACCOUNT'
  | 'PARTNER_RECEIVABLE'
  | 'PARTNER_PAYABLE';

export interface RoleAssignment {
  accountId: string;
  role: ReportRole;
}

export type ClassificationBasis =
  'ROLE' | 'INHERITED_ROLE' | 'STANDARD_HEADER' | 'UNMAPPED';

export interface AccountClassification<L extends string> {
  line: L;
  basis: ClassificationBasis;
  /** The account whose role/header decided the line (self or an ancestor). */
  viaAccountId: string | null;
  /** Set when one account carries roles that point at different lines. */
  conflict: { roles: ReportRole[]; lines: L[] } | null;
}

interface ClassificationRule<L extends string> {
  /** Ordered: when an account has several roles the first listed wins. */
  roleLines: ReadonlyArray<readonly [ReportRole, L]>;
  headerLines: Readonly<Record<string, L>>;
  unmapped: L;
}

// --- Income Statement (IAS 1.99/103 function-of-expense analysis) ---------

export type PnlLine =
  | 'REVENUE'
  | 'REVENUE_DEDUCTIONS'
  | 'COST_OF_SALES'
  | 'SELLING_DISTRIBUTION'
  | 'ADMINISTRATIVE'
  | 'OTHER_INCOME'
  | 'OTHER_EXPENSES'
  | 'FINANCE_COSTS'
  | 'FX_DIFFERENCES'
  | 'UNCLASSIFIED';

/** Income lines are shown credit − debit; expense lines debit − credit. */
export const PNL_LINE_NATURE: Record<
  Exclude<PnlLine, 'UNCLASSIFIED'>,
  'income' | 'expense'
> = {
  REVENUE: 'income',
  REVENUE_DEDUCTIONS: 'income',
  COST_OF_SALES: 'expense',
  SELLING_DISTRIBUTION: 'expense',
  ADMINISTRATIVE: 'expense',
  OTHER_INCOME: 'income',
  OTHER_EXPENSES: 'expense',
  FINANCE_COSTS: 'expense',
  FX_DIFFERENCES: 'expense',
};

export const PNL_ROLE_LINES: ReadonlyArray<readonly [ReportRole, PnlLine]> = [
  ['SALES_REVENUE', 'REVENUE'],
  ['SERVICE_REVENUE', 'REVENUE'],
  ['AGENT_COMMISSION_REVENUE', 'REVENUE'],
  ['AGENT_SERVICE_REVENUE', 'REVENUE'],
  ['SALES_RETURNS', 'REVENUE_DEDUCTIONS'],
  ['SALES_DISCOUNTS', 'REVENUE_DEDUCTIONS'],
  ['COGS', 'COST_OF_SALES'],
  ['INVENTORY_ADJUSTMENT', 'COST_OF_SALES'],
  ['LANDED_COST_CLEARING', 'COST_OF_SALES'],
  ['SHIPPING_EXPENSE', 'SELLING_DISTRIBUTION'],
  ['GATEWAY_FEES', 'SELLING_DISTRIBUTION'],
  ['FULFILLMENT_EXPENSE', 'SELLING_DISTRIBUTION'],
  ['COMMISSION_EXPENSE', 'SELLING_DISTRIBUTION'],
  ['OPERATING_EXPENSE', 'ADMINISTRATIVE'],
  ['SALARY_EXPENSE', 'ADMINISTRATIVE'],
  ['KPI_EXPENSE', 'ADMINISTRATIVE'],
  ['ALLOWANCE_EXPENSE', 'ADMINISTRATIVE'],
  ['DEDUCTION', 'ADMINISTRATIVE'],
  ['DEPRECIATION_EXPENSE', 'ADMINISTRATIVE'],
  ['PURCHASE', 'ADMINISTRATIVE'],
  ['PURCHASE_RETURN', 'ADMINISTRATIVE'],
  ['PURCHASE_DISCOUNT', 'ADMINISTRATIVE'],
  ['OTHER_INCOME', 'OTHER_INCOME'],
  ['OTHER_EXPENSE', 'OTHER_EXPENSES'],
  ['ROUND_DIFF', 'OTHER_EXPENSES'],
  ['SUSPENSE', 'OTHER_EXPENSES'],
  ['INVESTOR_DIST', 'FINANCE_COSTS'],
  ['CAPITAL_RETURN', 'FINANCE_COSTS'],
  ['EXCHANGE_DIFF', 'FX_DIFFERENCES'],
  ['UNREALIZED_FX', 'FX_DIFFERENCES'],
];

/** Standard OMS COA header codes (standard-chart-of-accounts.ts). */
export const PNL_HEADER_LINES: Readonly<Record<string, PnlLine>> = {
  '41': 'REVENUE',
  '42': 'REVENUE_DEDUCTIONS',
  '43': 'OTHER_INCOME',
  '51': 'COST_OF_SALES',
  '52': 'SELLING_DISTRIBUTION',
  '53': 'ADMINISTRATIVE',
  '54': 'OTHER_EXPENSES',
};

const PNL_RULE: ClassificationRule<PnlLine> = {
  roleLines: PNL_ROLE_LINES,
  headerLines: PNL_HEADER_LINES,
  unmapped: 'UNCLASSIFIED',
};

// --- Statement of Financial Position (IAS 1.60-76) ------------------------

export type BsGroup = 'CURRENT' | 'NON_CURRENT' | 'UNCLASSIFIED';

export const BS_ROLE_GROUPS: ReadonlyArray<readonly [ReportRole, BsGroup]> = [
  ['FIXED_ASSETS', 'NON_CURRENT'],
  ['ACCUM_DEPRECIATION', 'NON_CURRENT'],
  ['INVESTOR_FUNDING', 'NON_CURRENT'],
  ['CASH_ACCOUNT', 'CURRENT'],
  ['CASH', 'CURRENT'],
  ['BANK', 'CURRENT'],
  ['PAYMENT_CLEARING', 'CURRENT'],
  ['AR', 'CURRENT'],
  ['PARTNER_RECEIVABLE', 'CURRENT'],
  ['INVENTORY', 'CURRENT'],
  ['PREPAYMENTS', 'CURRENT'],
  ['VAT_INPUT', 'CURRENT'],
  ['AP', 'CURRENT'],
  ['PARTNER_PAYABLE', 'CURRENT'],
  ['VAT_OUTPUT', 'CURRENT'],
  ['ACCRUED_SHIPPING', 'CURRENT'],
  ['ACCRUED_FULFILLMENT', 'CURRENT'],
  ['ACCRUED_EXPENSES', 'CURRENT'],
  ['PAYROLL_PAYABLE', 'CURRENT'],
  ['INVESTOR_PAYABLE', 'CURRENT'],
  ['AGENT_FUNDS_PAYABLE', 'CURRENT'],
];

export const BS_HEADER_GROUPS: Readonly<Record<string, BsGroup>> = {
  '11': 'CURRENT',
  '12': 'CURRENT',
  '13': 'CURRENT',
  '14': 'CURRENT',
  '15': 'NON_CURRENT',
  '16': 'CURRENT',
  '21': 'CURRENT',
  '22': 'CURRENT',
  '23': 'CURRENT',
};

const BS_RULE: ClassificationRule<BsGroup> = {
  roleLines: BS_ROLE_GROUPS,
  headerLines: BS_HEADER_GROUPS,
  unmapped: 'UNCLASSIFIED',
};

// --- Resolution -----------------------------------------------------------

const STANDARD_HEADER_TYPES = new Map(
  STANDARD_CHART_OF_ACCOUNTS.filter((def) => !def.allowsPosting).map((def) => [
    def.code,
    def.accountType as string,
  ]),
);

export interface ClassificationContext {
  byId: Map<string, CoaNode>;
  rolesByAccount: Map<string, ReportRole[]>;
}

export function buildClassificationContext(
  accounts: CoaNode[],
  roles: RoleAssignment[],
): ClassificationContext {
  const rolesByAccount = new Map<string, ReportRole[]>();
  for (const { accountId, role } of roles) {
    const list = rolesByAccount.get(accountId) ?? [];
    if (!list.includes(role)) list.push(role);
    rolesByAccount.set(accountId, list);
  }
  return {
    byId: new Map(accounts.map((account) => [account.id, account])),
    rolesByAccount,
  };
}

function lineForRoles<L extends string>(
  roles: ReportRole[],
  rule: ClassificationRule<L>,
): { line: L; conflict: AccountClassification<L>['conflict'] } | null {
  const hits = rule.roleLines.filter(([role]) => roles.includes(role));
  if (hits.length === 0) return null;
  const lines = [...new Set(hits.map(([, line]) => line))];
  return {
    line: hits[0][1],
    conflict:
      lines.length > 1 ? { roles: hits.map(([role]) => role), lines } : null,
  };
}

function classifyWith<L extends string>(
  account: CoaNode,
  ctx: ClassificationContext,
  rule: ClassificationRule<L>,
): AccountClassification<L> {
  let current: CoaNode | undefined = account;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const byRole = lineForRoles(ctx.rolesByAccount.get(current.id) ?? [], rule);
    if (byRole) {
      return {
        line: byRole.line,
        basis: current.id === account.id ? 'ROLE' : 'INHERITED_ROLE',
        viaAccountId: current.id,
        conflict: byRole.conflict,
      };
    }
    const header = rule.headerLines[current.code];
    if (
      header &&
      STANDARD_HEADER_TYPES.get(current.code) === current.accountType
    ) {
      return {
        line: header,
        basis: 'STANDARD_HEADER',
        viaAccountId: current.id,
        conflict: null,
      };
    }
    current = current.parentAccountId
      ? ctx.byId.get(current.parentAccountId)
      : undefined;
  }
  return {
    line: rule.unmapped,
    basis: 'UNMAPPED',
    viaAccountId: null,
    conflict: null,
  };
}

/** Income Statement line of a REVENUE / EXPENSE account. */
export function classifyPnlAccount(
  account: CoaNode,
  ctx: ClassificationContext,
): AccountClassification<PnlLine> {
  return classifyWith(account, ctx, PNL_RULE);
}

/** Current / non-current group of an ASSET / LIABILITY account. */
export function classifyBsAccount(
  account: CoaNode,
  ctx: ClassificationContext,
): AccountClassification<BsGroup> {
  return classifyWith(account, ctx, BS_RULE);
}

// --- Cash flow (IAS 7.6, 7.9, 7.10-17, 7.28) ------------------------------

export type CashFlowActivity =
  'CASH' | 'OPERATING' | 'INVESTING' | 'FINANCING' | 'FX';

/**
 * Standard headers whose every descendant is a financing liability (IAS 7.17
 * — borrowings / funding): 24 "Investor Liabilities" (investor funding and
 * profit payable, including custom investor loans added under it).
 */
export const CF_FINANCING_HEADERS: ReadonlySet<string> = new Set(['24']);

function underStandardHeader(
  account: CoaNode,
  ctx: ClassificationContext,
  codes: ReadonlySet<string>,
): boolean {
  let current: CoaNode | undefined = account;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (
      codes.has(current.code) &&
      STANDARD_HEADER_TYPES.get(current.code) === current.accountType
    )
      return true;
    current = current.parentAccountId
      ? ctx.byId.get(current.parentAccountId)
      : undefined;
  }
  return false;
}

/**
 * Activity of a counterpart account in an entry that moves cash: the cash
 * set itself (movements between cash items, IAS 7.9), FX-difference
 * accounts, investing (non-current assets), financing (equity, investor
 * funding / profit payable / distribution / capital return, anything under
 * header 24, non-current liabilities), everything else operating. A
 * counterpart the statements cannot classify falls to operating and is
 * reported by {@link isCashFlowCounterpartUnclassified} as a warning.
 */
export function classifyCashFlowAccount(
  account: CoaNode,
  ctx: ClassificationContext,
  cashAccountIds: ReadonlySet<string>,
): CashFlowActivity {
  if (cashAccountIds.has(account.id)) return 'CASH';
  if (account.accountType === 'EQUITY') return 'FINANCING';
  if (account.accountType === 'REVENUE' || account.accountType === 'EXPENSE') {
    const { line } = classifyPnlAccount(account, ctx);
    if (line === 'FX_DIFFERENCES') return 'FX';
    if (line === 'FINANCE_COSTS') return 'FINANCING';
    return 'OPERATING';
  }
  const roles = ctx.rolesByAccount.get(account.id) ?? [];
  if (roles.includes('INVESTOR_PAYABLE') || roles.includes('INVESTOR_FUNDING'))
    return 'FINANCING';
  if (
    account.accountType === 'LIABILITY' &&
    underStandardHeader(account, ctx, CF_FINANCING_HEADERS)
  )
    return 'FINANCING';
  const { line } = classifyBsAccount(account, ctx);
  if (line === 'NON_CURRENT') {
    return account.accountType === 'ASSET' ? 'INVESTING' : 'FINANCING';
  }
  return 'OPERATING';
}

/**
 * True when a cash counterpart has no statement classification (an
 * unmapped balance-sheet or P&L account) — its cash is shown as operating,
 * so the Cash Flow warns instead of hiding it (e.g. a custom short-term
 * loan account outside header 24 would otherwise read as operating).
 */
export function isCashFlowCounterpartUnclassified(
  account: CoaNode,
  ctx: ClassificationContext,
): boolean {
  if (account.accountType === 'EQUITY') return false;
  if (account.accountType === 'REVENUE' || account.accountType === 'EXPENSE')
    return classifyPnlAccount(account, ctx).line === 'UNCLASSIFIED';
  if (
    account.accountType === 'LIABILITY' &&
    underStandardHeader(account, ctx, CF_FINANCING_HEADERS)
  )
    return false;
  return classifyBsAccount(account, ctx).line === 'UNCLASSIFIED';
}
