/**
 * Pure agent-ledger arithmetic (specs/agents-fulfillment-partners §7–§10).
 * No I/O: the services load rows and call these, so preview, payout,
 * statement and portal all compute the same numbers, and the rules are
 * unit-testable in isolation. Money is handled in integer minor units
 * (0.01) internally and returned as 2-dp numbers.
 */
import { allocateMinor } from '../pricing/agent-order-pricing';

export const toMinor = (value: number): number => Math.round(value * 100);
export const fromMinor = (minor: number): number => minor / 100;
export const round2 = (value: number): number =>
  fromMinor(toMinor(Number(value)));

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Entry-type vocabulary
// ---------------------------------------------------------------------------

export type AgentEntryType =
  | 'COLLECTION_RECEIVED'
  | 'COLLECTION_BY_AGENT'
  | 'COLLECTION_REVERSAL'
  | 'COMMISSION'
  | 'COMMISSION_REVERSAL'
  | 'CUSTOMER_SHIPPING_RETAINED'
  | 'CUSTOMER_SHIPPING_RETAINED_REVERSAL'
  | 'SHIPPING_FEE'
  | 'RETURN_FEE'
  | 'SERVICE_FEE'
  | 'PROVIDER_FEE'
  | 'CUSTOMER_REFUND'
  | 'PAYOUT'
  | 'PAYOUT_REVERSAL'
  | 'ADJUSTMENT';

/** Deductions shown on the statement summary (debits that are neither payouts nor collection reversals). */
export const DEDUCTION_TYPES: AgentEntryType[] = [
  'COMMISSION',
  'CUSTOMER_SHIPPING_RETAINED',
  'SHIPPING_FEE',
  'RETURN_FEE',
  'SERVICE_FEE',
  'PROVIDER_FEE',
  'CUSTOMER_REFUND',
];

// ---------------------------------------------------------------------------
// Availability (spec §7 stages)
// ---------------------------------------------------------------------------

export interface AvailabilityInput {
  /** PaymentMethod.requiresReconciliation (legacy claims without a method: false). */
  requiresReconciliation: boolean;
  paymentAmount: number;
  settledAmount: number;
  /** Date of the settlement that completed the claim (null until settled). */
  settledAt: Date | null;
  verifiedAt: Date | null;
  /** Order's earning event (StoreOrder.agentEarnedAt). */
  earnedAt: Date | null;
  /** Snapshot payoutHoldDays. */
  holdDays: number;
}

/**
 * When a COLLECTION_RECEIVED credit becomes available for payout, or null
 * while it is not yet determinable:
 *  (a) the money is with us — method needs no reconciliation, or the claim
 *      is fully settled by the provider;
 *  (b) the order reached its earning event;
 *  (c) + hold days counted from the later of the earning event and the
 *      receipt (settlement date, else verification date).
 */
export function computeCollectionAvailableAt(
  input: AvailabilityInput,
): Date | null {
  if (!input.earnedAt) return null;
  let receivedAt: Date | null;
  if (input.requiresReconciliation) {
    const settled =
      toMinor(input.settledAmount) >= toMinor(input.paymentAmount) &&
      toMinor(input.paymentAmount) > 0;
    if (!settled || !input.settledAt) return null;
    receivedAt = input.settledAt;
  } else {
    receivedAt = input.verifiedAt;
  }
  if (!receivedAt) return null;
  const base = Math.max(input.earnedAt.getTime(), receivedAt.getTime());
  return new Date(base + Math.max(0, input.holdDays) * DAY_MS);
}

export type AgentPaymentStage =
  | 'DECLARED'
  | 'REJECTED'
  | 'VERIFIED'
  | 'COLLECTED_BY_AGENT'
  | 'HELD_WITH_PROVIDER'
  | 'SETTLED'
  | 'PENDING_ELIGIBILITY'
  | 'AVAILABLE'
  | 'PAID_OUT'
  | 'REVERSED';

export interface PaymentStageInput {
  status: 'PENDING' | 'MATCHED' | 'VERIFIED' | 'REJECTED' | 'DISPUTED';
  destinationOwnership: 'COMPANY' | 'AGENT' | null;
  requiresReconciliation: boolean;
  amount: number;
  settledAmount: number;
  earnedAt: Date | null;
  /** The (not reversed) COLLECTION_RECEIVED credit, when one exists. */
  credit: {
    amount: number;
    availableAt: Date | null;
    allocated: number;
    reversed: boolean;
  } | null;
  now: Date;
}

/** Declared → verified → held with provider → settled → pending eligibility → available → paid out. */
export function paymentStage(input: PaymentStageInput): AgentPaymentStage {
  if (input.status === 'REJECTED') return 'REJECTED';
  if (input.status !== 'VERIFIED') return 'DECLARED';
  if (input.destinationOwnership === 'AGENT') return 'COLLECTED_BY_AGENT';
  if (!input.credit) return 'VERIFIED';
  if (input.credit.reversed) return 'REVERSED';
  if (
    input.requiresReconciliation &&
    toMinor(input.settledAmount) < toMinor(input.amount)
  ) {
    return 'HELD_WITH_PROVIDER';
  }
  if (!input.earnedAt) return 'SETTLED';
  const availableAt = input.credit.availableAt;
  if (!availableAt || availableAt.getTime() > input.now.getTime()) {
    return 'PENDING_ELIGIBILITY';
  }
  if (toMinor(input.credit.allocated) >= toMinor(input.credit.amount)) {
    return 'PAID_OUT';
  }
  return 'AVAILABLE';
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export interface LedgerRowLite {
  id: string;
  entryNumber: string;
  entryType: AgentEntryType;
  entryDate: Date;
  sourceType: string;
  sourceId: string;
  payoutId: string | null;
  currencyId: string;
  debit: number;
  credit: number;
  availableAt: Date | null;
  /** Σ allocations of CONFIRMED payouts to this credit. */
  allocated?: number;
}

export interface AgentBalance {
  currencyId: string;
  /** Credits − debits: what we owe the agent (negative = the agent owes us). */
  balance: number;
  /** Collections not yet available (held, not earned, in hold period). */
  pending: number;
  availableCredits: number;
  deductions: number;
  paidOut: number;
  /** max(0, availableCredits − deductions − paidOut). */
  available: number;
  /** Unfloored value (negative ⇒ carried forward, spec §11 D5). */
  availableRaw: number;
}

/** A credit whose own reversal was recorded (same source, reversal type). */
function reversalKeys(rows: LedgerRowLite[]) {
  const reversedCollections = new Set<string>();
  const reversedPayouts = new Set<string>();
  for (const row of rows) {
    if (row.entryType === 'COLLECTION_REVERSAL') {
      reversedCollections.add(`${row.sourceType}|${row.sourceId}`);
    }
    if (row.entryType === 'PAYOUT_REVERSAL' && row.payoutId) {
      reversedPayouts.add(row.payoutId);
    }
  }
  return { reversedCollections, reversedPayouts };
}

export function isCreditAvailable(row: LedgerRowLite, now: Date): boolean {
  if (row.credit <= 0) return false;
  if (row.entryType === 'COLLECTION_RECEIVED') {
    return !!row.availableAt && row.availableAt.getTime() <= now.getTime();
  }
  // Reversals of deductions and Finance credit adjustments are available
  // from their entry date (they offset charges already deducted).
  const at = row.availableAt ?? row.entryDate;
  return at.getTime() <= now.getTime();
}

/**
 * Per-currency balances. Paired rows cancel out of the availability math: a
 * reversed collection and its COLLECTION_REVERSAL, a reversed payout and its
 * PAYOUT_REVERSAL. Everything else: available = available credits − every
 * other debit (deductions, refunds, payouts), floored at 0.
 */
export function computeAgentBalances(
  rows: LedgerRowLite[],
  now: Date,
): AgentBalance[] {
  const { reversedCollections, reversedPayouts } = reversalKeys(rows);
  const byCurrency = new Map<
    string,
    {
      balance: number;
      pending: number;
      availableCredits: number;
      deductions: number;
      paidOut: number;
    }
  >();
  for (const row of rows) {
    const acc = byCurrency.get(row.currencyId) ?? {
      balance: 0,
      pending: 0,
      availableCredits: 0,
      deductions: 0,
      paidOut: 0,
    };
    byCurrency.set(row.currencyId, acc);
    const debit = toMinor(row.debit);
    const credit = toMinor(row.credit);
    acc.balance += credit - debit;

    const pairedCollection =
      (row.entryType === 'COLLECTION_RECEIVED' ||
        row.entryType === 'COLLECTION_REVERSAL') &&
      reversedCollections.has(`${row.sourceType}|${row.sourceId}`);
    const pairedPayout =
      (row.entryType === 'PAYOUT' || row.entryType === 'PAYOUT_REVERSAL') &&
      !!row.payoutId &&
      reversedPayouts.has(row.payoutId);
    if (pairedCollection || pairedPayout) continue;

    if (credit > 0) {
      if (isCreditAvailable(row, now)) acc.availableCredits += credit;
      else acc.pending += credit;
    }
    if (debit > 0) {
      if (row.entryType === 'PAYOUT') acc.paidOut += debit;
      else acc.deductions += debit;
    }
  }
  return [...byCurrency.entries()].map(([currencyId, acc]) => {
    const raw = acc.availableCredits - acc.deductions - acc.paidOut;
    return {
      currencyId,
      balance: fromMinor(acc.balance),
      pending: fromMinor(acc.pending),
      availableCredits: fromMinor(acc.availableCredits),
      deductions: fromMinor(acc.deductions),
      paidOut: fromMinor(acc.paidOut),
      available: fromMinor(Math.max(0, raw)),
      availableRaw: fromMinor(raw),
    };
  });
}

/** Available credits with an unallocated remainder, FIFO by availableAt then number. */
export function eligibleCredits(
  rows: LedgerRowLite[],
  now: Date,
  currencyId: string,
): Array<LedgerRowLite & { remaining: number }> {
  const { reversedCollections } = reversalKeys(rows);
  return rows
    .filter(
      (row) =>
        row.currencyId === currencyId &&
        row.entryType !== 'PAYOUT_REVERSAL' &&
        !(
          row.entryType === 'COLLECTION_RECEIVED' &&
          reversedCollections.has(`${row.sourceType}|${row.sourceId}`)
        ) &&
        isCreditAvailable(row, now),
    )
    .map((row) => ({
      ...row,
      remaining: fromMinor(
        Math.max(0, toMinor(row.credit) - toMinor(row.allocated ?? 0)),
      ),
    }))
    .filter((row) => row.remaining > 0)
    .sort(
      (a, b) =>
        (a.availableAt ?? a.entryDate).getTime() -
          (b.availableAt ?? b.entryDate).getTime() ||
        a.entryNumber.localeCompare(b.entryNumber),
    );
}

/** FIFO allocation of `amount` over the credits' remainders (informational trace of what was paid). */
export function allocateFifo(
  amount: number,
  credits: Array<{ id: string; remaining: number }>,
): Array<{ ledgerEntryId: string; amount: number }> {
  let left = toMinor(amount);
  const result: Array<{ ledgerEntryId: string; amount: number }> = [];
  for (const credit of credits) {
    if (left <= 0) break;
    const take = Math.min(left, toMinor(credit.remaining));
    if (take <= 0) continue;
    result.push({ ledgerEntryId: credit.id, amount: fromMinor(take) });
    left -= take;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Returns, commission reversal, provider fees
// ---------------------------------------------------------------------------

/**
 * Merchandise value of returning `quantity` more units of a line, computed
 * cumulatively so the line's returns always add up to exactly its amount
 * once every unit is back (no rounding residue).
 */
export function returnedLineAmount(
  lineAmount: number,
  lineQuantity: number,
  previouslyReturned: number,
  quantity: number,
): number {
  if (lineQuantity <= 0) return 0;
  const minor = toMinor(lineAmount);
  const before = Math.round((minor * previouslyReturned) / lineQuantity);
  const after = Math.round(
    (minor * (previouslyReturned + quantity)) / lineQuantity,
  );
  return fromMinor(after - before);
}

/**
 * Commission to reverse for a return after the earning event (REVERSE
 * treatment): the commission's share of the cumulative returned base,
 * minus what was already reversed, never exceeding the commission.
 */
export function commissionReversalAmount(input: {
  commission: number;
  base: number;
  returnedAfterEarningCumulative: number;
  alreadyReversed: number;
}): number {
  if (input.base <= 0 || input.commission <= 0) return 0;
  const target = Math.min(
    toMinor(input.commission),
    Math.round(
      (toMinor(input.commission) *
        Math.min(
          toMinor(input.returnedAfterEarningCumulative),
          toMinor(input.base),
        )) /
        toMinor(input.base),
    ),
  );
  return fromMinor(Math.max(0, target - toMinor(input.alreadyReversed)));
}

/** Pro-rata split of a settlement fee over its lines (largest remainder; Σ = fee exactly). */
export function allocateSettlementFee(
  fee: number,
  lines: Array<{ key: string; amount: number }>,
): Map<string, number> {
  const result = new Map<string, number>();
  const feeMinor = toMinor(fee);
  if (feeMinor <= 0 || lines.length === 0) {
    for (const line of lines) result.set(line.key, 0);
    return result;
  }
  const weights = lines.map((line) => Math.max(0, toMinor(line.amount)));
  const shares = allocateMinor(feeMinor, weights);
  lines.forEach((line, index) =>
    result.set(line.key, fromMinor(shares[index])),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

export interface StatementLineInput {
  entryType: AgentEntryType;
  debit: number;
  credit: number;
  memoAmount: number | null;
}

/** Running balance over ordered lines, starting from the opening balance. */
export function withRunningBalance<T extends StatementLineInput>(
  opening: number,
  lines: T[],
): { lines: Array<T & { balance: number; memo: boolean }>; closing: number } {
  let running = toMinor(opening);
  const out = lines.map((line) => {
    running += toMinor(line.credit) - toMinor(line.debit);
    const memo =
      toMinor(line.debit) === 0 &&
      toMinor(line.credit) === 0 &&
      line.memoAmount != null;
    return { ...line, balance: fromMinor(running), memo };
  });
  return { lines: out, closing: fromMinor(running) };
}

/** Σ debit / Σ credit / memo by entry type — the money half of the statement summary. */
export function sumByType(
  lines: StatementLineInput[],
): Record<AgentEntryType, { debit: number; credit: number; memo: number }> {
  const acc = {} as Record<
    AgentEntryType,
    { debit: number; credit: number; memo: number }
  >;
  for (const line of lines) {
    const current = acc[line.entryType] ?? { debit: 0, credit: 0, memo: 0 };
    current.debit = fromMinor(toMinor(current.debit) + toMinor(line.debit));
    current.credit = fromMinor(toMinor(current.credit) + toMinor(line.credit));
    current.memo = fromMinor(
      toMinor(current.memo) + toMinor(line.memoAmount ?? 0),
    );
    acc[line.entryType] = current;
  }
  return acc;
}
