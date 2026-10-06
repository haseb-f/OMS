import { Prisma } from '@prisma/client';
import {
  VIOLATION_CAP,
  type IntegrityReport,
  type IntegrityStatus,
  type IntegrityViolation,
  type InvariantId,
  type InvariantResult,
} from './integrity.types';

/**
 * Pure helpers of the integrity report (no I/O) — status rules, the valuation
 * ↔ GL comparison, the kit COGS comparison and the markdown rendering shared
 * by the API and the `r13-integrity` script. Unit-tested in
 * `integrity-rules.spec.ts`.
 */

type DecimalInput = Prisma.Decimal | string | number;
const D = (value: DecimalInput | null | undefined) =>
  new Prisma.Decimal(value ?? 0);

const STATUS_RANK: Record<IntegrityStatus, number> = {
  PASS: 0,
  WARN: 1,
  FAIL: 2,
};

export function worstStatus(statuses: IntegrityStatus[]): IntegrityStatus {
  return statuses.reduce<IntegrityStatus>(
    (worst, status) =>
      STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst,
    'PASS',
  );
}

/** JSON-safe value: bigint → number, Decimal → string, Date → ISO string. */
export function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

/** A raw SQL row turned into a violation (every column made JSON-safe). */
export function violationFromRow(
  row: Record<string, unknown>,
  severity: IntegrityViolation['severity'],
  message: string,
): IntegrityViolation {
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'total' || key === 'rule') continue;
    details[key] = plain(value);
  }
  return {
    ...details,
    rule: typeof row.rule === 'string' ? row.rule : 'UNKNOWN',
    severity,
    message,
  };
}

/**
 * Builds an invariant result: status = worst violation severity (PASS when
 * none), the list capped at `VIOLATION_CAP`, `violationCount` the real total
 * (a capped SQL query passes its `COUNT(*) OVER ()` as `extraTotal`).
 */
export function buildInvariant(input: {
  id: InvariantId;
  title: string;
  checked: number;
  violations: IntegrityViolation[];
  /** Findings counted but not returned (beyond a SQL LIMIT). */
  uncounted?: number;
  /** Minimum status when nothing failed (e.g. WARN for an unexplained GL difference). */
  floor?: IntegrityStatus;
  notes?: string[];
  metrics?: Record<string, string | number | null>;
}): InvariantResult {
  const total = input.violations.length + (input.uncounted ?? 0);
  const status = worstStatus([
    input.floor ?? 'PASS',
    ...input.violations.map((violation) => violation.severity),
  ]);
  return {
    id: input.id,
    title: input.title,
    status,
    checked: input.checked,
    violationCount: total,
    violations: input.violations.slice(0, VIOLATION_CAP),
    truncated: total > VIOLATION_CAP,
    notes: input.notes ?? [],
    metrics: input.metrics ?? {},
  };
}

export function summarize(
  invariants: InvariantResult[],
): Pick<IntegrityReport, 'status' | 'summary'> {
  const summary: Record<IntegrityStatus, number> = {
    PASS: 0,
    WARN: 0,
    FAIL: 0,
  };
  for (const invariant of invariants) summary[invariant.status] += 1;
  return {
    status: worstStatus(invariants.map((invariant) => invariant.status)),
    summary,
  };
}

// ----------------------------------------------------------------- I6 (valuation ↔ GL)

export interface ValuationAccountRow {
  accountId: string | null;
  code: string | null;
  name: string | null;
  /** Σ onHand × moving average of the company-owned products mapped to this account. */
  subledgerValue: string;
  /** Posted balance (Σ debit − credit of POSTED + REVERSED journal lines). */
  glBalance: string;
  difference: string;
  products: number;
}

/**
 * Sub-ledger value per inventory account vs the account's posted balance.
 * Accounts known only to one side are still listed (a GL balance with no
 * stock behind it is a difference too). The sub-ledger bucket `accountId:
 * null` collects products whose category resolves to no inventory account.
 */
export function reconcileValuation(input: {
  subledger: { accountId: string | null; value: DecimalInput }[];
  gl: {
    accountId: string;
    code: string | null;
    name: string | null;
    balance: DecimalInput;
  }[];
}): {
  rows: ValuationAccountRow[];
  subledgerTotal: Prisma.Decimal;
  glTotal: Prisma.Decimal;
  difference: Prisma.Decimal;
} {
  const byAccount = new Map<
    string,
    {
      accountId: string | null;
      code: string | null;
      name: string | null;
      sub: Prisma.Decimal;
      gl: Prisma.Decimal;
      products: number;
    }
  >();
  const keyOf = (accountId: string | null) => accountId ?? '__UNMAPPED__';
  for (const account of input.gl) {
    byAccount.set(keyOf(account.accountId), {
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      sub: D(0),
      gl: D(account.balance),
      products: 0,
    });
  }
  for (const item of input.subledger) {
    const key = keyOf(item.accountId);
    const row = byAccount.get(key) ?? {
      accountId: item.accountId,
      code: null,
      name: null,
      sub: D(0),
      gl: D(0),
      products: 0,
    };
    row.sub = row.sub.add(D(item.value));
    row.products += 1;
    byAccount.set(key, row);
  }
  const rows = [...byAccount.values()]
    .map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      subledgerValue: row.sub.toFixed(2),
      glBalance: row.gl.toFixed(2),
      difference: row.sub.sub(row.gl).toFixed(2),
      products: row.products,
    }))
    .sort((a, b) =>
      a.code === null || b.code === null
        ? Number(a.code === null) - Number(b.code === null)
        : a.code.localeCompare(b.code),
    );
  const subledgerTotal = [...byAccount.values()].reduce(
    (sum, row) => sum.add(row.sub),
    D(0),
  );
  const glTotal = [...byAccount.values()].reduce(
    (sum, row) => sum.add(row.gl),
    D(0),
  );
  return {
    rows,
    subledgerTotal,
    glTotal,
    difference: subledgerTotal.sub(glTotal),
  };
}

/**
 * Rounding bound of the sub-ledger value: the stored average carries 4 dp
 * (≤ 0.00005 per unit) and each product's value is rounded to 2 dp
 * (≤ 0.005 per product).
 */
export function valuationRoundingBound(
  onHand: { onHand: number }[],
): Prisma.Decimal {
  const units = onHand.reduce((sum, item) => sum + Math.abs(item.onHand), 0);
  return D(units)
    .mul('0.00005')
    .add(D(onHand.length).mul('0.005'))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
}

// ----------------------------------------------------------------- I5 (kit COGS)

/**
 * The invoice's single active journal must debit each COGS account with
 * exactly the COGS its lines imply (kit lines: Σ round2(qtyPerKit × qty ×
 * snapshot cost) per component; plain stocked lines: round2(unitCost × qty)).
 * Only the accounts a kit line maps to are compared.
 */
export function compareKitCogs(input: {
  expected: {
    invoiceId: string;
    invoiceNumber: string;
    accountId: string;
    amount: DecimalInput;
    hasKit: boolean;
  }[];
  actual: { invoiceId: string; accountId: string; debit: DecimalInput }[];
  tolerance?: DecimalInput;
}): IntegrityViolation[] {
  const tolerance = D(input.tolerance ?? '0.005');
  const key = (invoiceId: string, accountId: string) =>
    `${invoiceId}|${accountId}`;
  const expected = new Map<
    string,
    {
      invoiceId: string;
      invoiceNumber: string;
      accountId: string;
      amount: Prisma.Decimal;
      hasKit: boolean;
    }
  >();
  for (const row of input.expected) {
    const k = key(row.invoiceId, row.accountId);
    const current = expected.get(k);
    expected.set(k, {
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoiceNumber,
      accountId: row.accountId,
      amount: (current?.amount ?? D(0)).add(D(row.amount)),
      hasKit: (current?.hasKit ?? false) || row.hasKit,
    });
  }
  const actual = new Map<string, Prisma.Decimal>();
  for (const row of input.actual) {
    const k = key(row.invoiceId, row.accountId);
    actual.set(k, (actual.get(k) ?? D(0)).add(D(row.debit)));
  }
  const violations: IntegrityViolation[] = [];
  for (const [k, row] of expected) {
    if (!row.hasKit) continue;
    const posted = actual.get(k) ?? D(0);
    if (posted.sub(row.amount).abs().gt(tolerance)) {
      violations.push({
        rule: 'KIT_COGS_MISMATCH',
        severity: 'FAIL',
        message: `Invoice ${row.invoiceNumber}: COGS debited ${posted.toFixed(2)} on the kit's COGS account, expected ${row.amount.toFixed(2)} from the line snapshots.`,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        accountId: row.accountId,
        expected: row.amount.toFixed(2),
        actual: posted.toFixed(2),
      });
    }
  }
  return violations;
}

// ----------------------------------------------------------------- markdown

const STATUS_LABEL: Record<IntegrityStatus, string> = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
};

/** Human summary of a report (script output, evidence files). */
export function renderIntegrityMarkdown(
  report: IntegrityReport,
  heading = 'Inventory integrity report',
  sampleSize = 10,
): string {
  const lines: string[] = [
    `# ${heading}`,
    '',
    `Generated ${report.generatedAt} in ${report.durationMs} ms — overall **${STATUS_LABEL[report.status]}** ` +
      `(PASS ${report.summary.PASS} · WARN ${report.summary.WARN} · FAIL ${report.summary.FAIL}).`,
    '',
    `Filter: products ${report.filter.productIds ? report.filter.productIds.length : 'all'}, warehouse ${report.filter.warehouseId ?? 'all'}.`,
    '',
    '| Invariant | Status | Checked | Findings |',
    '| --- | --- | ---: | ---: |',
    ...report.invariants.map(
      (inv) =>
        `| ${inv.id} ${inv.title} | ${STATUS_LABEL[inv.status]} | ${inv.checked} | ${inv.violationCount} |`,
    ),
  ];
  for (const inv of report.invariants) {
    lines.push('', `## ${inv.id} — ${inv.title}: ${STATUS_LABEL[inv.status]}`);
    for (const note of inv.notes) lines.push('', `- ${note}`);
    const metrics = Object.entries(inv.metrics);
    if (metrics.length > 0) {
      lines.push('', '| Metric | Value |', '| --- | ---: |');
      for (const [name, value] of metrics) {
        lines.push(`| ${name} | ${value ?? '—'} |`);
      }
    }
    if (inv.violations.length > 0) {
      lines.push(
        '',
        `Findings (${inv.violationCount}${inv.truncated ? ', list capped' : ''}; first ${Math.min(sampleSize, inv.violations.length)}):`,
        '',
      );
      for (const violation of inv.violations.slice(0, sampleSize)) {
        lines.push(
          `- [${violation.severity}] ${violation.rule}: ${violation.message}`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
