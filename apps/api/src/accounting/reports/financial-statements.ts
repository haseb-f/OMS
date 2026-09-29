import {
  buildAccountForest,
  leafLine,
  keepLineHeaders,
  roundReportMoney,
  wrapSection,
  type AccountAmounts,
  type CoaNode,
  type HierarchicalReportLine,
} from './financial-report-tree';
import {
  classifyBsAccount,
  classifyCashFlowAccount,
  classifySellingSubLine,
  isCashFlowCounterpartUnclassified,
  classifyPnlAccount,
  PNL_LINE_NATURE,
  SELLING_SUB_LINE_ORDER,
  type BsGroup,
  type ClassificationContext,
  type PnlLine,
  type ReportRole,
  type SellingSubLine,
} from './statement-classification';

/**
 * Pure statement builders (no database): the Income Statement, Statement of
 * Financial Position and direct-method Cash Flow are assembled here from
 * per-account debit/credit sums, so the partition and reconciliation rules
 * are unit-tested with known numbers. The service only loads the sums.
 */

export type DebitCredit = { debit: number; credit: number };
export type AccountSums = Map<string, DebitCredit>;

export interface ReportWarning {
  code:
    | 'UNCLASSIFIED_ACCOUNTS'
    | 'ROLE_CONFLICT'
    | 'CAPITAL_RETURN_IN_PROFIT_OR_LOSS'
    | 'DRAFTS_INCLUDED'
    | 'CARRY_FORWARD_OPENING_ENTRY'
    | 'UNBALANCED_ENTRIES';
  accounts?: Array<{
    accountId: string;
    code: string;
    name: string;
    amount: number;
    roles?: ReportRole[];
  }>;
  entries?: Array<{ id: string; entryNumber: string; difference: number }>;
  /**
   * CAPITAL_RETURN_IN_PROFIT_OR_LOSS: where the affected legacy postings are
   * listed and corrected (capital-returns corrections, stream Y).
   */
  correctionsEndpoint?: string;
}

/** Lists legacy capital returns posted to P&L (e.g. 551) and corrects them. */
export const CAPITAL_RETURN_CORRECTIONS_ENDPOINT =
  '/capital-returns/corrections/affected';

const VALUE_KEYS = ['balance'];
const OPENING_BALANCE_SOURCE = 'OPENING_BALANCE';

const money = (value: number) => roundReportMoney(value);
const isNonZero = (value: number) => Math.abs(value) >= 0.005;

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return money(items.reduce((sum, item) => sum + pick(item), 0));
}

function accountRow(account: CoaNode, amount: number) {
  return {
    accountId: account.id,
    code: account.code,
    name: account.name,
    amount: money(amount),
  };
}

/** A sub-group (e.g. "Current assets") with its own total row, one level deep. */
function wrapGroup(input: {
  id: string;
  label: string;
  children: HierarchicalReportLine[];
  totalLabel: string;
}): HierarchicalReportLine {
  const section = wrapSection({
    id: input.id,
    label: input.label,
    labelEn: input.label,
    children: input.children,
    valueKeys: VALUE_KEYS,
    totalLabel: input.totalLabel,
    totalLabelEn: input.totalLabel,
    resultKind: 'subtotal',
  });
  return {
    ...section,
    kind: 'group',
    level: 1,
    children: section.children.map((child) =>
      child.id === `${input.id}:total` ? { ...child, level: 1 } : child,
    ),
  };
}

function statementForest(
  accounts: CoaNode[],
  amounts: AccountAmounts,
  idPrefix: string,
  keepHeader: (accountId: string) => boolean,
  topLevel = 1,
): HierarchicalReportLine[] {
  return keepLineHeaders(
    buildAccountForest(accounts, amounts, VALUE_KEYS, { idPrefix }),
    keepHeader,
    topLevel,
  );
}

// ==========================================================================
// Income Statement
// ==========================================================================

const PNL_SECTIONS: Array<{
  line: Exclude<PnlLine, 'UNCLASSIFIED'>;
  id: string;
  label: string;
  totalLabel: string;
}> = [
  {
    line: 'REVENUE',
    id: 'is-revenue',
    label: 'Revenue',
    totalLabel: 'Total revenue',
  },
  {
    line: 'REVENUE_DEDUCTIONS',
    id: 'is-revenue-deductions',
    label: 'Less: sales returns and discounts',
    totalLabel: 'Total returns and discounts',
  },
  {
    line: 'COST_OF_SALES',
    id: 'is-cost-of-sales',
    label: 'Cost of sales',
    totalLabel: 'Total cost of sales',
  },
  {
    line: 'SELLING_DISTRIBUTION',
    id: 'is-selling',
    label: 'Selling and distribution expenses',
    totalLabel: 'Total selling and distribution expenses',
  },
  {
    line: 'ADMINISTRATIVE',
    id: 'is-admin',
    label: 'General and administrative expenses',
    totalLabel: 'Total general and administrative expenses',
  },
  {
    line: 'OTHER_INCOME',
    id: 'is-other-income',
    label: 'Other income',
    totalLabel: 'Total other income',
  },
  {
    line: 'OTHER_EXPENSES',
    id: 'is-other-expenses',
    label: 'Other expenses',
    totalLabel: 'Total other expenses',
  },
  {
    line: 'FINANCE_COSTS',
    id: 'is-finance-costs',
    label: 'Finance costs',
    totalLabel: 'Total finance costs',
  },
  {
    line: 'FX_DIFFERENCES',
    id: 'is-fx',
    label: 'Foreign exchange differences (gain) / loss',
    totalLabel: 'Net foreign exchange differences',
  },
];

/** Visible lines inside "Selling and distribution expenses" (owner decision P2). */
const SELLING_SUB_SECTIONS: Record<
  SellingSubLine,
  { id: string; label: string; totalLabel: string }
> = {
  SHIPPING_DELIVERY: {
    id: 'is-selling-shipping',
    label: 'Shipping and delivery',
    totalLabel: 'Net shipping and delivery',
  },
  PAYMENT_GATEWAY_FEES: {
    id: 'is-selling-gateway',
    label: 'Payment gateway commissions',
    totalLabel: 'Net payment gateway commissions',
  },
  FULFILLMENT: {
    id: 'is-selling-fulfillment',
    label: 'Fulfillment',
    totalLabel: 'Net fulfillment',
  },
  OTHER_SELLING: {
    id: 'is-selling-other',
    label: 'Other selling and distribution expenses',
    totalLabel: 'Total other selling and distribution expenses',
  },
};

/** Per selling line: gross company-incurred cost, amount recovered from agents, net. */
export interface SellingLineTotals {
  gross: number;
  /** Recovered from agents (positive) — shown as a contra row, never expense. */
  recoveredFromAgents: number;
  net: number;
}

export interface IncomeStatementTotals {
  /** Legacy (by account type) — Year Closing and period-profit read these. */
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  grossRevenue: number;
  /** Credit − debit of the contra-revenue lines (normally negative). */
  revenueDeductions: number;
  netRevenue: number;
  costOfSales: number;
  grossProfit: number;
  sellingDistribution: number;
  /** Net of each visible selling line; the four add up to `sellingDistribution`. */
  shippingDelivery: number;
  paymentGatewayFees: number;
  fulfillment: number;
  otherSelling: number;
  /** Selling expense recovered from agents (positive), all selling lines. */
  recoveredFromAgents: number;
  sellingBreakdown: Record<SellingSubLine, SellingLineTotals>;
  administrative: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpenses: number;
  financeCosts: number;
  /** Debit − credit: positive = net FX loss. */
  fxDifferences: number;
  /** Effect on profit (credit − debit) of accounts with no statement line. */
  unclassified: number;
}

export function buildIncomeStatement(input: {
  accounts: CoaNode[];
  sums: AccountSums;
  ctx: ClassificationContext;
  /**
   * The part of `sums` posted by agent-recovery entries
   * (AGENT_RECOVERY_SOURCE_TYPES, same scope). On a selling account it is
   * shown as "Less: recovered from agents" beside the gross company cost,
   * so net = gross − recovered and nothing is counted twice.
   */
  recoverySums?: AccountSums;
}) {
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  const headerLine = (accountId: string): PnlLine | null => {
    const account = byId.get(accountId);
    return account ? classifyPnlAccount(account, input.ctx).line : null;
  };
  const sellingSubOf = (accountId: string): SellingSubLine | null => {
    const account = byId.get(accountId);
    return account ? classifySellingSubLine(account, input.ctx) : null;
  };
  const lineAmounts = new Map<PnlLine, AccountAmounts>();
  const lineOfAccount = new Map<string, PnlLine>();
  const sellingGross = new Map<SellingSubLine, AccountAmounts>();
  const sellingLineOfAccount = new Map<string, SellingSubLine>();
  const sellingRecovered = new Map<SellingSubLine, number>();
  const unclassified: NonNullable<ReportWarning['accounts']> = [];
  const conflicts: NonNullable<ReportWarning['accounts']> = [];
  const capitalReturn: NonNullable<ReportWarning['accounts']> = [];
  let totalRevenue = 0;
  let totalExpense = 0;
  let profitEffect = 0;

  for (const [accountId, { debit, credit }] of input.sums) {
    const account = byId.get(accountId);
    if (!account) continue;
    if (account.accountType !== 'REVENUE' && account.accountType !== 'EXPENSE')
      continue;
    const effect = credit - debit;
    profitEffect += effect;
    if (account.accountType === 'REVENUE') totalRevenue += effect;
    else totalExpense += -effect;

    const classification = classifyPnlAccount(account, input.ctx);
    const line = classification.line;
    lineOfAccount.set(accountId, line);
    const shown =
      line === 'UNCLASSIFIED' || PNL_LINE_NATURE[line] === 'income'
        ? effect
        : -effect;
    const bucket = lineAmounts.get(line) ?? {};
    bucket[accountId] = { balance: money(shown) };
    lineAmounts.set(line, bucket);
    if (line === 'SELLING_DISTRIBUTION') {
      const sub = classifySellingSubLine(account, input.ctx);
      sellingLineOfAccount.set(accountId, sub);
      const recovery = input.recoverySums?.get(accountId);
      // Credit − debit of the recovery lines = expense recovered from agents.
      const recovered = recovery ? recovery.credit - recovery.debit : 0;
      const gross = sellingGross.get(sub) ?? {};
      gross[accountId] = { balance: money(shown + recovered) };
      sellingGross.set(sub, gross);
      sellingRecovered.set(sub, (sellingRecovered.get(sub) ?? 0) + recovered);
    }

    if (line === 'UNCLASSIFIED' && isNonZero(effect)) {
      unclassified.push(accountRow(account, effect));
    }
    if (classification.conflict) {
      conflicts.push({
        ...accountRow(account, effect),
        roles: classification.conflict.roles,
      });
    }
    const roles = input.ctx.rolesByAccount.get(accountId) ?? [];
    if (roles.includes('CAPITAL_RETURN') && isNonZero(effect)) {
      capitalReturn.push(accountRow(account, -effect));
    }
  }

  const lineTotal = (line: PnlLine) =>
    sumBy(Object.values(lineAmounts.get(line) ?? {}), (v) => v.balance);

  const t = {
    grossRevenue: lineTotal('REVENUE'),
    revenueDeductions: lineTotal('REVENUE_DEDUCTIONS'),
    costOfSales: lineTotal('COST_OF_SALES'),
    sellingDistribution: lineTotal('SELLING_DISTRIBUTION'),
    administrative: lineTotal('ADMINISTRATIVE'),
    otherIncome: lineTotal('OTHER_INCOME'),
    otherExpenses: lineTotal('OTHER_EXPENSES'),
    financeCosts: lineTotal('FINANCE_COSTS'),
    fxDifferences: lineTotal('FX_DIFFERENCES'),
    unclassified: lineTotal('UNCLASSIFIED'),
  };
  const sellingBreakdown = Object.fromEntries(
    SELLING_SUB_LINE_ORDER.map((sub) => {
      const gross = sumBy(
        Object.values(sellingGross.get(sub) ?? {}),
        (v) => v.balance,
      );
      const recoveredFromAgents = money(sellingRecovered.get(sub) ?? 0);
      return [
        sub,
        { gross, recoveredFromAgents, net: money(gross - recoveredFromAgents) },
      ];
    }),
  ) as Record<SellingSubLine, SellingLineTotals>;
  const netRevenue = money(t.grossRevenue + t.revenueDeductions);
  const grossProfit = money(netRevenue - t.costOfSales);
  const operatingProfit = money(
    grossProfit - t.sellingDistribution - t.administrative,
  );
  const netIncome = money(
    operatingProfit +
      t.otherIncome -
      t.otherExpenses -
      t.financeCosts -
      t.fxDifferences +
      t.unclassified,
  );

  const section = (line: Exclude<PnlLine, 'UNCLASSIFIED'>) => {
    const def = PNL_SECTIONS.find((s) => s.line === line)!;
    const children = statementForest(
      input.accounts,
      lineAmounts.get(line) ?? {},
      `${def.id}/`,
      (id) => headerLine(id) === line,
    );
    if (children.length === 0) return [];
    return [
      wrapSection({
        id: def.id,
        label: def.label,
        labelEn: def.label,
        children,
        valueKeys: VALUE_KEYS,
        totalLabel: def.totalLabel,
        totalLabelEn: def.totalLabel,
      }),
    ];
  };
  const subtotal = (id: string, label: string, value: number) =>
    leafLine({
      id,
      kind: 'subtotal',
      label,
      labelEn: label,
      values: { balance: value },
    });

  // Selling and distribution: one visible group per selling line (shipping,
  // gateway commissions, fulfilment, other), each gross of agent recoveries
  // with a contra row, so the effect on operating profit is explicit.
  const sellingSection = (): HierarchicalReportLine[] => {
    const def = PNL_SECTIONS.find((s) => s.line === 'SELLING_DISTRIBUTION')!;
    const groups = SELLING_SUB_LINE_ORDER.flatMap((sub) => {
      const subDef = SELLING_SUB_SECTIONS[sub];
      const accountRows = statementForest(
        input.accounts,
        sellingGross.get(sub) ?? {},
        `${subDef.id}/`,
        (id) =>
          headerLine(id) === 'SELLING_DISTRIBUTION' && sellingSubOf(id) === sub,
        2,
      );
      const recovered = sellingBreakdown[sub].recoveredFromAgents;
      if (accountRows.length === 0 && !isNonZero(recovered)) return [];
      const children = isNonZero(recovered)
        ? [
            ...accountRows,
            {
              ...leafLine({
                id: `${subDef.id}:recovered`,
                kind: 'result',
                label: 'Less: recovered from agents',
                labelEn: 'Less: recovered from agents',
                values: { balance: money(-recovered) },
                level: 2,
              }),
              parentId: subDef.id,
            },
          ]
        : accountRows;
      return [
        wrapGroup({
          id: subDef.id,
          label: subDef.label,
          children,
          totalLabel: subDef.totalLabel,
        }),
      ];
    });
    if (groups.length === 0) return [];
    return [
      wrapSection({
        id: def.id,
        label: def.label,
        labelEn: def.label,
        children: groups,
        valueKeys: VALUE_KEYS,
        totalLabel: def.totalLabel,
        totalLabelEn: def.totalLabel,
      }),
    ];
  };

  const deductionsSection = section('REVENUE_DEDUCTIONS');
  const unclassifiedChildren = statementForest(
    input.accounts,
    lineAmounts.get('UNCLASSIFIED') ?? {},
    'is-unclassified/',
    (id) => headerLine(id) === 'UNCLASSIFIED',
  );

  const lines: HierarchicalReportLine[] = [
    ...section('REVENUE'),
    ...deductionsSection,
    ...(deductionsSection.length > 0
      ? [subtotal('is-net-revenue', 'Net revenue', netRevenue)]
      : []),
    ...section('COST_OF_SALES'),
    subtotal('is-gross-profit', 'Gross profit', grossProfit),
    ...sellingSection(),
    ...section('ADMINISTRATIVE'),
    subtotal('is-operating-profit', 'Operating profit', operatingProfit),
    ...section('OTHER_INCOME'),
    ...section('OTHER_EXPENSES'),
    ...section('FINANCE_COSTS'),
    ...section('FX_DIFFERENCES'),
    ...(unclassifiedChildren.length > 0
      ? [
          wrapSection({
            id: 'is-unclassified',
            label: 'Unclassified accounts (effect on profit)',
            labelEn: 'Unclassified accounts (effect on profit)',
            children: unclassifiedChildren,
            valueKeys: VALUE_KEYS,
            totalLabel: 'Total unclassified',
            totalLabelEn: 'Total unclassified',
          }),
        ]
      : []),
    leafLine({
      id: 'net-income',
      kind: 'result',
      label: netIncome >= 0 ? 'Net Profit' : 'Net Loss',
      labelEn: netIncome >= 0 ? 'Net Profit' : 'Net Loss',
      values: { balance: netIncome },
    }),
  ];

  const warnings: ReportWarning[] = [];
  if (unclassified.length > 0)
    warnings.push({ code: 'UNCLASSIFIED_ACCOUNTS', accounts: unclassified });
  if (conflicts.length > 0)
    warnings.push({ code: 'ROLE_CONFLICT', accounts: conflicts });
  if (capitalReturn.length > 0)
    warnings.push({
      code: 'CAPITAL_RETURN_IN_PROFIT_OR_LOSS',
      accounts: capitalReturn,
      correctionsEndpoint: CAPITAL_RETURN_CORRECTIONS_ENDPOINT,
    });

  const totals: IncomeStatementTotals = {
    totalRevenue: money(totalRevenue),
    totalExpense: money(totalExpense),
    netIncome,
    ...t,
    shippingDelivery: sellingBreakdown.SHIPPING_DELIVERY.net,
    paymentGatewayFees: sellingBreakdown.PAYMENT_GATEWAY_FEES.net,
    fulfillment: sellingBreakdown.FULFILLMENT.net,
    otherSelling: sellingBreakdown.OTHER_SELLING.net,
    recoveredFromAgents: sumBy(
      SELLING_SUB_LINE_ORDER,
      (sub) => sellingBreakdown[sub].recoveredFromAgents,
    ),
    sellingBreakdown,
    netRevenue,
    grossProfit,
    operatingProfit,
  };

  return {
    lines,
    totals,
    lineOfAccount,
    sellingLineOfAccount,
    warnings,
    /** Net income by lines − net income by account type; 0 unless an account was dropped. */
    partitionDifference: money(netIncome - money(profitEffect)),
  };
}

// ==========================================================================
// Statement of Financial Position
// ==========================================================================

export interface BalanceSheetTotals {
  totalAssets: number;
  nonCurrentAssets: number;
  currentAssets: number;
  unclassifiedAssets: number;
  totalLiabilities: number;
  nonCurrentLiabilities: number;
  currentLiabilities: number;
  unclassifiedLiabilities: number;
  equityAccounts: number;
  priorPeriodsUnclosedProfit: number;
  currentYearProfit: number;
  /** P&L effect of the current fiscal year's Year Closing (−profit once closed). */
  currentYearClosedToRetainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  difference: number;
  balanced: boolean;
  cashAndCashEquivalents: number;
}

const BS_GROUP_ORDER: BsGroup[] = ['NON_CURRENT', 'CURRENT', 'UNCLASSIFIED'];
const BS_GROUP_LABELS: Record<
  'ASSET' | 'LIABILITY',
  Record<BsGroup, string>
> = {
  ASSET: {
    NON_CURRENT: 'Non-current assets',
    CURRENT: 'Current assets',
    UNCLASSIFIED: 'Assets not classified current / non-current',
  },
  LIABILITY: {
    NON_CURRENT: 'Non-current liabilities',
    CURRENT: 'Current liabilities',
    UNCLASSIFIED: 'Liabilities not classified current / non-current',
  },
};
const BS_GROUP_IDS: Record<BsGroup, string> = {
  NON_CURRENT: 'non-current',
  CURRENT: 'current',
  UNCLASSIFIED: 'unclassified',
};

/**
 * `sums` are cumulative up to the as-of date. The unclosed profit (every
 * P&L balance not yet moved to retained earnings) is split into:
 *   - current-year profit = `currentYearSums`: the Income Statement's own
 *     sums for [fiscal-year start, as-of] (Year Closing excluded), so the two
 *     statements always agree;
 *   - closed to retained earnings = the P&L effect of the CURRENT fiscal
 *     year's own Year Closing entries (and their reversals)
 *     `currentYearClosingSums` — normally 0, or −profit after closing;
 *   - prior periods = the remainder (unclosed − current − closed). A prior
 *     year's closing reversed inside this year (reversal dated today) lands
 *     here, not in the current year.
 */
export function buildBalanceSheet(input: {
  accounts: CoaNode[];
  sums: AccountSums;
  currentYearSums: AccountSums;
  currentYearClosingSums: AccountSums;
  ctx: ClassificationContext;
  cashAccountIds: ReadonlySet<string>;
}) {
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  const grouped: Record<
    'ASSET' | 'LIABILITY',
    Record<BsGroup, AccountAmounts>
  > = {
    ASSET: { NON_CURRENT: {}, CURRENT: {}, UNCLASSIFIED: {} },
    LIABILITY: { NON_CURRENT: {}, CURRENT: {}, UNCLASSIFIED: {} },
  };
  const equity: AccountAmounts = {};
  const unclassified: NonNullable<ReportWarning['accounts']> = [];
  let unclosedProfit = 0;
  let cash = 0;

  for (const [accountId, { debit, credit }] of input.sums) {
    const account = byId.get(accountId);
    if (!account) continue;
    const type = account.accountType;
    if (type === 'REVENUE' || type === 'EXPENSE') {
      unclosedProfit += credit - debit;
      continue;
    }
    if (input.cashAccountIds.has(accountId)) cash += debit - credit;
    if (type === 'EQUITY') {
      equity[accountId] = { balance: money(credit - debit) };
      continue;
    }
    const side = type === 'ASSET' ? 'ASSET' : 'LIABILITY';
    const balance = side === 'ASSET' ? debit - credit : credit - debit;
    const group = input.cashAccountIds.has(accountId)
      ? 'CURRENT'
      : classifyBsAccount(account, input.ctx).line;
    grouped[side][group][accountId] = { balance: money(balance) };
    if (group === 'UNCLASSIFIED' && isNonZero(balance)) {
      unclassified.push(accountRow(account, balance));
    }
  }

  const profitEffect = (sumsMap: AccountSums) => {
    let total = 0;
    for (const [accountId, { debit, credit }] of sumsMap) {
      const type = byId.get(accountId)?.accountType;
      if (type === 'REVENUE' || type === 'EXPENSE') total += credit - debit;
    }
    return money(total);
  };
  const currentYearProfit = profitEffect(input.currentYearSums);
  const currentYearClosedToRetainedEarnings = profitEffect(
    input.currentYearClosingSums,
  );
  const priorPeriodsUnclosedProfit = money(
    unclosedProfit - currentYearProfit - currentYearClosedToRetainedEarnings,
  );

  const groupTotal = (amounts: AccountAmounts) =>
    sumBy(Object.values(amounts), (v) => v.balance);

  const sideLines = (side: 'ASSET' | 'LIABILITY', prefix: string) =>
    BS_GROUP_ORDER.flatMap((group) => {
      const id = `${prefix}-${BS_GROUP_IDS[group]}`;
      const children = statementForest(
        input.accounts,
        grouped[side][group],
        `${id}/`,
        (headerId) => {
          const header = byId.get(headerId);
          return (
            !!header &&
            header.parentAccountId !== null &&
            classifyBsAccount(header, input.ctx).line === group
          );
        },
        2,
      );
      if (children.length === 0) return [];
      const label = BS_GROUP_LABELS[side][group];
      return [
        wrapGroup({
          id,
          label,
          children,
          totalLabel: `Total ${label.toLowerCase()}`,
        }),
      ];
    });

  const totalAssets = sumBy(BS_GROUP_ORDER, (g) =>
    groupTotal(grouped.ASSET[g]),
  );
  const totalLiabilities = sumBy(BS_GROUP_ORDER, (g) =>
    groupTotal(grouped.LIABILITY[g]),
  );
  const equityAccounts = groupTotal(equity);
  const totalEquity = money(
    equityAccounts +
      priorPeriodsUnclosedProfit +
      currentYearProfit +
      currentYearClosedToRetainedEarnings,
  );
  const totalLiabilitiesAndEquity = money(totalLiabilities + totalEquity);
  const difference = money(totalAssets - totalLiabilitiesAndEquity);

  const equityChildren: HierarchicalReportLine[] = [
    ...statementForest(
      input.accounts,
      equity,
      'bs-equity/',
      (headerId) => byId.get(headerId)?.parentAccountId != null,
    ),
    ...(isNonZero(priorPeriodsUnclosedProfit)
      ? [
          leafLine({
            id: 'prior-unclosed-earnings',
            kind: 'result',
            label: 'Unclosed profit / (loss) of prior periods',
            labelEn: 'Unclosed profit / (loss) of prior periods',
            values: { balance: priorPeriodsUnclosedProfit },
            level: 1,
          }),
        ]
      : []),
    leafLine({
      id: 'current-earnings',
      kind: 'result',
      label: 'Profit / (loss) for the current year',
      labelEn: 'Profit / (loss) for the current year',
      values: { balance: currentYearProfit },
      level: 1,
    }),
    ...(isNonZero(currentYearClosedToRetainedEarnings)
      ? [
          leafLine({
            id: 'current-year-closed',
            kind: 'result',
            label: 'Current-year profit transferred to retained earnings',
            labelEn: 'Current-year profit transferred to retained earnings',
            values: { balance: currentYearClosedToRetainedEarnings },
            level: 1,
          }),
        ]
      : []),
  ];

  const lines: HierarchicalReportLine[] = [
    wrapSection({
      id: 'assets',
      label: 'Assets',
      labelEn: 'Assets',
      children: sideLines('ASSET', 'bs-assets'),
      valueKeys: VALUE_KEYS,
      totalLabel: 'Total Assets',
      totalLabelEn: 'Total Assets',
    }),
    wrapSection({
      id: 'liabilities',
      label: 'Liabilities',
      labelEn: 'Liabilities',
      children: sideLines('LIABILITY', 'bs-liabilities'),
      valueKeys: VALUE_KEYS,
      totalLabel: 'Total Liabilities',
      totalLabelEn: 'Total Liabilities',
    }),
    wrapSection({
      id: 'equity',
      label: 'Equity',
      labelEn: 'Equity',
      children: equityChildren,
      valueKeys: VALUE_KEYS,
      totalLabel: 'Total Equity',
      totalLabelEn: 'Total Equity',
    }),
    leafLine({
      id: 'liabilities-equity',
      kind: 'grand_total',
      label: 'Total Liabilities and Equity',
      labelEn: 'Total Liabilities and Equity',
      values: { balance: totalLiabilitiesAndEquity },
    }),
  ];

  const totals: BalanceSheetTotals = {
    totalAssets,
    nonCurrentAssets: groupTotal(grouped.ASSET.NON_CURRENT),
    currentAssets: groupTotal(grouped.ASSET.CURRENT),
    unclassifiedAssets: groupTotal(grouped.ASSET.UNCLASSIFIED),
    totalLiabilities,
    nonCurrentLiabilities: groupTotal(grouped.LIABILITY.NON_CURRENT),
    currentLiabilities: groupTotal(grouped.LIABILITY.CURRENT),
    unclassifiedLiabilities: groupTotal(grouped.LIABILITY.UNCLASSIFIED),
    equityAccounts,
    priorPeriodsUnclosedProfit,
    currentYearProfit,
    currentYearClosedToRetainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    difference,
    balanced: Math.abs(difference) < 0.01,
    cashAndCashEquivalents: money(cash),
  };

  const warnings: ReportWarning[] =
    unclassified.length > 0
      ? [{ code: 'UNCLASSIFIED_ACCOUNTS', accounts: unclassified }]
      : [];

  return {
    lines,
    totals,
    currentEarnings: money(unclosedProfit),
    warnings,
  };
}

// ==========================================================================
// Cash Flow — direct method, classified by counterpart account
// ==========================================================================

/**
 * The source a cash movement is reported under: a reversal created by the
 * Journal Entries screen is stored as MANUAL, so it takes the source of the
 * entry it reverses — the original and its reversal then net on the same
 * row, and a reversed OPENING_BALANCE entry stays outside the activities.
 */
export function effectiveSourceType(entry: {
  sourceType: string | null;
  reversalOfEntry?: { sourceType: string | null } | null;
}): string | null {
  return entry.reversalOfEntry?.sourceType ?? entry.sourceType;
}

export interface CashFlowEntryInput {
  entryId: string;
  sourceType: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
}

export type CashFlowSection = 'OPERATING' | 'INVESTING' | 'FINANCING';
export const CASH_FLOW_SECTIONS: CashFlowSection[] = [
  'OPERATING',
  'INVESTING',
  'FINANCING',
];

export interface CashFlowReconciliation {
  openingCash: number;
  operating: number;
  investing: number;
  financing: number;
  /** IAS 7.28 — FX effect on cash held, outside the three activities. */
  fxEffect: number;
  /** Operating + investing + financing + FX effect. */
  netChange: number;
  /**
   * Cash brought onto the books by OPENING_BALANCE entries (go-live /
   * opening balances) inside the period — not a cash flow of any activity,
   * shown outside them so opening → closing still reconciles.
   */
  openingBalanceEntries: number;
  /** Opening + opening-balance entries + net change. */
  closingCash: number;
  /**
   * Independent figure: the cash accounts' balance as of the period end,
   * aggregated straight from the ledger (the Balance Sheet's source) — not
   * from the entries the activities were built from.
   */
  ledgerClosingCash: number;
  difference: number;
  balanced: boolean;
  /** Gross amount moved between cash accounts (IAS 7.9 — excluded). */
  internalTransfers: number;
}

const toCents = (value: number) => Math.round(value * 100);

/**
 * Attributes each entry's net cash movement to the counterpart lines on the
 * opposite side (pro rata to their amounts, in cents, remainder on the
 * largest) and classifies each share by the counterpart's activity:
 *   - entries whose lines are all cash accounts are internal transfers
 *     (excluded from inflows/outflows; their gross is reported);
 *   - an entry whose opposite-side counterparts are only FX-difference
 *     accounts (revaluation of cash, FX on a transfer) is the IAS 7.28
 *     effect of exchange-rate changes; FX lines mixed with other
 *     counterparts follow those (operating).
 */
export function buildCashFlowActivities(input: {
  entries: CashFlowEntryInput[];
  accounts: CoaNode[];
  ctx: ClassificationContext;
  cashAccountIds: ReadonlySet<string>;
  openingCash: number;
  /** Cash accounts' as-of balance at the period end (independent aggregate). */
  closingCashBalance: number;
}) {
  const byId = new Map(input.accounts.map((a) => [a.id, a]));
  const unclassifiedCash = new Map<string, number>(); // accountId → cents
  const activityCache = new Map<
    string,
    ReturnType<typeof classifyCashFlowAccount>
  >();
  const activityOf = (accountId: string) => {
    let activity = activityCache.get(accountId);
    if (!activity) {
      const account = byId.get(accountId);
      activity = account
        ? classifyCashFlowAccount(account, input.ctx, input.cashAccountIds)
        : 'OPERATING';
      activityCache.set(accountId, activity);
    }
    return activity;
  };

  const bySectionSource = new Map<string, number>(); // `${section}|${source}` → cents
  const bySource = new Map<string, number>();
  let fxEffect = 0;
  let openingEntries = 0;
  let internalGross = 0;

  const add = (section: CashFlowSection, source: string, cents: number) => {
    const key = `${section}|${source}`;
    bySectionSource.set(key, (bySectionSource.get(key) ?? 0) + cents);
    bySource.set(source, (bySource.get(source) ?? 0) + cents);
  };

  for (const entry of input.entries) {
    const source = entry.sourceType ?? 'OTHER';
    let cashNet = 0;
    const counterparts: Array<{ accountId: string; net: number }> = [];
    for (const line of entry.lines) {
      const net = toCents(line.debit) - toCents(line.credit);
      if (input.cashAccountIds.has(line.accountId)) {
        cashNet += net;
      } else if (net !== 0) {
        counterparts.push({ accountId: line.accountId, net });
      }
    }
    if (entry.sourceType === OPENING_BALANCE_SOURCE) {
      // Balances brought in, not cash that flowed in the period.
      openingEntries += cashNet;
      continue;
    }
    if (counterparts.length === 0) {
      internalGross += entry.lines
        .filter((l) => input.cashAccountIds.has(l.accountId))
        .reduce((sum, l) => sum + toCents(l.debit), 0);
      continue;
    }
    if (cashNet === 0) continue;

    const opposite = counterparts.filter((c) =>
      cashNet > 0 ? c.net < 0 : c.net > 0,
    );
    const weights = opposite.length > 0 ? opposite : counterparts;
    const weightTotal = weights.reduce((sum, c) => sum + Math.abs(c.net), 0);
    const fxOnly = weights.every((c) => activityOf(c.accountId) === 'FX');

    const shares = weights.map((c) => ({
      c,
      cents: Math.round((cashNet * Math.abs(c.net)) / weightTotal),
    }));
    const remainder = cashNet - shares.reduce((sum, s) => sum + s.cents, 0);
    if (remainder !== 0) {
      const largest = shares.reduce((a, b) =>
        Math.abs(b.c.net) > Math.abs(a.c.net) ? b : a,
      );
      largest.cents += remainder;
    }

    for (const { c, cents } of shares) {
      if (fxOnly) {
        fxEffect += cents;
        continue;
      }
      const activity = activityOf(c.accountId);
      const account = byId.get(c.accountId);
      if (!account || isCashFlowCounterpartUnclassified(account, input.ctx)) {
        unclassifiedCash.set(
          c.accountId,
          (unclassifiedCash.get(c.accountId) ?? 0) + cents,
        );
      }
      const section: CashFlowSection =
        activity === 'INVESTING' || activity === 'FINANCING'
          ? activity
          : 'OPERATING';
      add(section, source, cents);
    }
  }

  const sectionTotals = Object.fromEntries(
    CASH_FLOW_SECTIONS.map((section) => [
      section,
      [...bySectionSource.entries()]
        .filter(([key]) => key.startsWith(`${section}|`))
        .reduce((sum, [, cents]) => sum + cents, 0) / 100,
    ]),
  ) as Record<CashFlowSection, number>;

  const opening = money(input.openingCash);
  const netChange = money(
    sectionTotals.OPERATING +
      sectionTotals.INVESTING +
      sectionTotals.FINANCING +
      fxEffect / 100,
  );
  const openingBalanceEntries = money(openingEntries / 100);
  const closingCash = money(opening + openingBalanceEntries + netChange);
  const ledgerClosingCash = money(input.closingCashBalance);
  const reconciliation: CashFlowReconciliation = {
    openingCash: opening,
    operating: money(sectionTotals.OPERATING),
    investing: money(sectionTotals.INVESTING),
    financing: money(sectionTotals.FINANCING),
    fxEffect: money(fxEffect / 100),
    netChange,
    openingBalanceEntries,
    closingCash,
    ledgerClosingCash,
    difference: money(closingCash - ledgerClosingCash),
    balanced: Math.abs(closingCash - ledgerClosingCash) < 0.01,
    internalTransfers: money(internalGross / 100),
  };

  const sectionLabels: Record<CashFlowSection, string> = {
    OPERATING: 'Operating Activities',
    INVESTING: 'Investing Activities',
    FINANCING: 'Financing Activities',
  };
  const sectionLines = CASH_FLOW_SECTIONS.map((section) => {
    const children = [...bySectionSource.entries()]
      .filter(([key, cents]) => key.startsWith(`${section}|`) && cents !== 0)
      .map(([key, cents]) => ({ source: key.split('|')[1], cents }))
      .sort((a, b) => a.source.localeCompare(b.source))
      .map(({ source, cents }) =>
        leafLine({
          id: `cf:${section}:${source}`,
          kind: 'posting',
          label: source,
          labelEn: source,
          values: { balance: money(cents / 100) },
          level: 1,
        }),
      );
    const label = sectionLabels[section];
    return wrapSection({
      id: `cf-${section.toLowerCase()}`,
      label,
      labelEn: label,
      children,
      valueKeys: VALUE_KEYS,
      totalLabel: `Net cash from ${label.toLowerCase()}`,
      totalLabelEn: `Net cash from ${label.toLowerCase()}`,
    });
  });

  const lines: HierarchicalReportLine[] = [
    leafLine({
      id: 'cf-opening',
      kind: 'opening',
      label: 'Opening cash',
      labelEn: 'Opening cash',
      values: { balance: opening },
    }),
    ...(isNonZero(openingBalanceEntries)
      ? [
          leafLine({
            id: 'cf-opening-entries',
            kind: 'subtotal',
            label: 'Cash brought in by opening-balance entries',
            labelEn: 'Cash brought in by opening-balance entries',
            values: { balance: openingBalanceEntries },
          }),
        ]
      : []),
    ...sectionLines,
    ...(isNonZero(reconciliation.fxEffect)
      ? [
          leafLine({
            id: 'cf-fx-effect',
            kind: 'subtotal',
            label: 'Effect of exchange rate changes on cash',
            labelEn: 'Effect of exchange rate changes on cash',
            values: { balance: reconciliation.fxEffect },
          }),
        ]
      : []),
    leafLine({
      id: 'cf-net',
      kind: 'result',
      label: 'Net increase (decrease) in cash',
      labelEn: 'Net increase (decrease) in cash',
      values: { balance: netChange },
    }),
    leafLine({
      id: 'cf-closing',
      kind: 'closing',
      label: 'Closing cash',
      labelEn: 'Closing cash',
      values: { balance: closingCash },
    }),
  ];

  const unclassified = [...unclassifiedCash.entries()]
    .filter(([, cents]) => cents !== 0)
    .map(([accountId, cents]) => {
      const account = byId.get(accountId);
      return {
        accountId,
        code: account?.code ?? accountId,
        name: account?.name ?? accountId,
        amount: money(cents / 100),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const warnings: ReportWarning[] =
    unclassified.length > 0
      ? [{ code: 'UNCLASSIFIED_ACCOUNTS', accounts: unclassified }]
      : [];

  return {
    lines,
    reconciliation,
    warnings,
    sections: [
      ...CASH_FLOW_SECTIONS.map((section) => ({
        section,
        netChange: money(sectionTotals[section]),
      })),
      { section: 'FX_EFFECT', netChange: reconciliation.fxEffect },
    ],
    movements: [...bySource.entries()]
      .map(([sourceType, cents]) => ({
        sourceType,
        netChange: money(cents / 100),
      }))
      .sort((a, b) => a.sourceType.localeCompare(b.sourceType)),
  };
}
