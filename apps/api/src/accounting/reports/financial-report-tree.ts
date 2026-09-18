/**
 * Canonical hierarchical financial-report tree. Built from Chart of Accounts
 * parent/child relations — never invented in the UI. Used by Trial Balance,
 * Balance Sheet, Income Statement, and Cash Flow.
 */

export type ReportLineKind =
  | 'section'
  | 'group'
  | 'posting'
  | 'subtotal'
  | 'section_total'
  | 'opening'
  | 'closing'
  | 'grand_total'
  | 'result'
  | 'spacer';

export interface HierarchicalReportLine {
  id: string;
  parentId: string | null;
  kind: ReportLineKind;
  level: number;
  code?: string;
  label: string;
  labelEn?: string | null;
  accountId?: string;
  accountType?: string;
  allowsPosting?: boolean;
  expandable: boolean;
  values: Record<string, number>;
  children: HierarchicalReportLine[];
}

export interface CoaNode {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  accountType: string;
  parentAccountId: string | null;
  level: number;
  allowsPosting: boolean;
}

export type AccountAmounts = Record<string, Record<string, number>>;

export function roundReportMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumValueMaps(
  keys: string[],
  ...maps: Array<Record<string, number> | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = roundReportMoney(
      maps.reduce((sum, map) => sum + (map?.[key] ?? 0), 0),
    );
  }
  return out;
}

function isZero(values: Record<string, number>): boolean {
  return Object.values(values).every((value) => Math.abs(value) < 0.005);
}

export function rollUpCoaAmounts(
  accounts: CoaNode[],
  leafAmounts: AccountAmounts,
  valueKeys: string[],
): AccountAmounts {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const rolled: AccountAmounts = {};
  const addTo = (accountId: string, delta: Record<string, number>) => {
    rolled[accountId] = sumValueMaps(valueKeys, rolled[accountId], delta);
  };

  for (const [accountId, amounts] of Object.entries(leafAmounts)) {
    let current: string | null = accountId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      addTo(current, amounts);
      current = byId.get(current)?.parentAccountId ?? null;
    }
  }
  return rolled;
}

function childrenOf(
  accounts: CoaNode[],
  parentId: string | null,
  accountType?: string,
): CoaNode[] {
  return accounts
    .filter((account) => {
      if (account.parentAccountId !== parentId) return false;
      if (accountType && account.accountType !== accountType) return false;
      return true;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildAccountLine(
  account: CoaNode,
  accounts: CoaNode[],
  rolled: AccountAmounts,
  valueKeys: string[],
  hideZero: boolean,
  parentLineId: string | null,
): HierarchicalReportLine | null {
  const childAccounts = childrenOf(accounts, account.id);
  const childLines = childAccounts
    .map((child) =>
      buildAccountLine(
        child,
        accounts,
        rolled,
        valueKeys,
        hideZero,
        account.id,
      ),
    )
    .filter((line): line is HierarchicalReportLine => line !== null);
  const values = sumValueMaps(valueKeys, rolled[account.id]);
  if (hideZero && isZero(values) && childLines.length === 0) return null;

  const kind: ReportLineKind = account.allowsPosting ? 'posting' : 'group';
  return {
    id: account.id,
    parentId: parentLineId,
    kind,
    level: Math.max(account.level, 1),
    code: account.code,
    label: account.name,
    labelEn: account.nameEn,
    accountId: account.id,
    accountType: account.accountType,
    allowsPosting: account.allowsPosting,
    expandable: childLines.length > 0,
    values,
    children: childLines,
  };
}

export function buildAccountForest(
  accounts: CoaNode[],
  leafAmounts: AccountAmounts,
  valueKeys: string[],
  options?: {
    hideZero?: boolean;
    accountType?: string;
    parentId?: string | null;
  },
): HierarchicalReportLine[] {
  const hideZero = options?.hideZero ?? true;
  const rolled = rollUpCoaAmounts(accounts, leafAmounts, valueKeys);
  const roots = childrenOf(
    accounts.filter((account) =>
      options?.accountType ? account.accountType === options.accountType : true,
    ),
    options?.parentId ?? null,
    options?.accountType,
  );
  // Accounts whose parent is of a different type (or missing) still need a
  // root slot so posting activity is never dropped.
  const knownIds = new Set(accounts.map((account) => account.id));
  const typed = options?.accountType
    ? accounts.filter((account) => account.accountType === options.accountType)
    : accounts;
  const orphanRoots = typed.filter((account) => {
    if (roots.some((root) => root.id === account.id)) return false;
    const parent = account.parentAccountId
      ? accounts.find((candidate) => candidate.id === account.parentAccountId)
      : null;
    if (!account.parentAccountId) return true;
    if (!parent || !knownIds.has(parent.id)) return true;
    if (options?.accountType && parent.accountType !== options.accountType) {
      return true;
    }
    return false;
  });
  const uniqueRoots = [...roots];
  for (const orphan of orphanRoots) {
    if (!uniqueRoots.some((root) => root.id === orphan.id))
      uniqueRoots.push(orphan);
  }
  uniqueRoots.sort((a, b) => a.code.localeCompare(b.code));

  return uniqueRoots
    .map((account) =>
      buildAccountLine(account, accounts, rolled, valueKeys, hideZero, null),
    )
    .filter((line): line is HierarchicalReportLine => line !== null);
}

export function wrapSection(input: {
  id: string;
  label: string;
  labelEn?: string;
  children: HierarchicalReportLine[];
  valueKeys: string[];
  totalLabel: string;
  totalLabelEn?: string;
  resultKind?: ReportLineKind;
}): HierarchicalReportLine {
  const values = sumValueMaps(
    input.valueKeys,
    ...input.children.map((child) => child.values),
  );
  const total: HierarchicalReportLine = {
    id: `${input.id}:total`,
    parentId: input.id,
    kind: input.resultKind ?? 'section_total',
    level: 1,
    label: input.totalLabel,
    labelEn: input.totalLabelEn ?? null,
    expandable: false,
    values,
    children: [],
  };
  const sectionChildren = [...input.children, total];
  return {
    id: input.id,
    parentId: null,
    kind: 'section',
    level: 0,
    label: input.label,
    labelEn: input.labelEn ?? null,
    expandable: input.children.length > 0,
    values,
    children: sectionChildren,
  };
}

export function leafLine(input: {
  id: string;
  kind: ReportLineKind;
  label: string;
  labelEn?: string;
  values: Record<string, number>;
  level?: number;
  code?: string;
}): HierarchicalReportLine {
  return {
    id: input.id,
    parentId: null,
    kind: input.kind,
    level: input.level ?? 0,
    code: input.code,
    label: input.label,
    labelEn: input.labelEn ?? null,
    expandable: false,
    values: input.values,
    children: [],
  };
}

export function flattenReportLines(
  lines: HierarchicalReportLine[],
  expandedIds?: Set<string>,
): HierarchicalReportLine[] {
  const out: HierarchicalReportLine[] = [];
  const walk = (nodes: HierarchicalReportLine[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length === 0) continue;
      const expanded = !expandedIds || expandedIds.has(node.id);
      if (expanded) walk(node.children);
    }
  };
  walk(lines);
  return out;
}

export type CashFlowSection = 'OPERATING' | 'INVESTING' | 'FINANCING' | 'OTHER';

const INVESTING_SOURCE_TYPES = new Set([
  'FIXED_ASSET_CAPITALIZATION',
  'FIXED_ASSET_DEPRECIATION',
  'FIXED_ASSET_DISPOSAL',
  'PREPAID_EXPENSE',
]);

const FINANCING_SOURCE_TYPES = new Set([
  'CAPITAL_CONTRIBUTION',
  'INVESTOR_DISTRIBUTION',
  'INVESTOR_PROFIT_PAYMENT',
  'CAPITAL_RETURN',
]);

export function classifyCashFlowSource(
  sourceType: string | null | undefined,
): CashFlowSection {
  const key = sourceType ?? 'OTHER';
  if (INVESTING_SOURCE_TYPES.has(key)) return 'INVESTING';
  if (FINANCING_SOURCE_TYPES.has(key)) return 'FINANCING';
  if (key === 'OTHER') return 'OTHER';
  return 'OPERATING';
}

export function splitSignedBalance(amount: number): {
  debit: number;
  credit: number;
} {
  const rounded = roundReportMoney(amount);
  if (rounded >= 0) return { debit: rounded, credit: 0 };
  return { debit: 0, credit: roundReportMoney(-rounded) };
}
