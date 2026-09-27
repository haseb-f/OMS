import { Prisma } from '@prisma/client';

/**
 * Pure settlement math (payment-declaration-reconciliation, IMPL-SET). No I/O,
 * so preview and confirm compute byte-identical results for the same inputs,
 * and the owner-confirmed formulas are unit-testable in isolation:
 *
 *   Cr Clearing   = Σ carrying value of the settled portions (functional, at
 *                   each claim's frozen receipt rate — what was debited)
 *   Dr Bank       = received × rate(received currency → functional, settlement date)
 *   Dr Commission = fee × rate(claim currency → functional, settlement date)
 *   FX difference = Cr Clearing − (Dr Bank + Dr Commission)
 *                   > 0 → Dr exchange difference (loss); < 0 → Cr (gain)
 *
 * Same currency: fee = gross − received (must be ≥ 0). Cross-currency: the
 * fee is supplied in the claim currency — unlike currencies are never
 * subtracted.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export function money(value: Prisma.Decimal.Value): Dec {
  return new D(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export interface CalculatorClaim {
  paymentId: string;
  /** Claim amount (claim currency). */
  amount: Prisma.Decimal.Value;
  /** Already settled by POSTED settlements (claim currency). */
  settledAmount: Prisma.Decimal.Value;
  /** Functional amount the receipt debited to clearing for the whole claim. */
  carryingTotal: Prisma.Decimal.Value;
  /** Carrying already released by POSTED settlements for this claim. */
  carryingReleased: Prisma.Decimal.Value;
  /** Frozen receipt rate (claim currency → functional). */
  receiptRate: Prisma.Decimal.Value;
  /** Explicit portion to settle; omitted = the whole remaining amount. */
  requestedAmount?: Prisma.Decimal.Value | null;
}

export interface CalculatorAccounts {
  bankAccountId: string;
  commissionAccountId: string;
  clearingAccountId: string;
  /** Required only when an FX difference arises. */
  exchangeDifferenceAccountId: string | null;
}

export interface CalculatorInput {
  claims: CalculatorClaim[];
  sameCurrency: boolean;
  receivedAmount: Prisma.Decimal.Value;
  /** Cross-currency only: commission in the claim currency. */
  feeAmount?: Prisma.Decimal.Value | null;
  /** Claim currency → functional at the settlement date. */
  claimRate: Prisma.Decimal.Value;
  /** Received currency → functional at the settlement date. */
  receivedRate: Prisma.Decimal.Value;
  accounts: CalculatorAccounts;
  labels: { bank: string; commission: string; clearing: string; fx: string };
}

export interface CalculatedLine {
  paymentId: string;
  amount: string;
  remainingBefore: string;
  carryingAmountFunctional: string;
  fullyReleases: boolean;
}

export interface JeLine {
  accountId: string;
  role: 'BANK' | 'COMMISSION' | 'CLEARING' | 'FX_DIFFERENCE';
  debit: number;
  credit: number;
  description: string;
}

export interface CalculationResult {
  lines: CalculatedLine[];
  grossAmount: string;
  receivedAmount: string;
  feeAmount: string;
  functional: {
    bank: string;
    commission: string;
    clearing: string;
    /** Signed: > 0 loss (debit), < 0 gain (credit). */
    fxDifference: string;
  };
  jeLines: JeLine[];
}

export class SettlementCalculationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function calculateSettlement(input: CalculatorInput): CalculationResult {
  if (input.claims.length === 0) {
    throw new SettlementCalculationError(
      'NO_CLAIMS_SELECTED',
      'Select at least one claim to settle.',
    );
  }
  const received = money(input.receivedAmount);
  if (received.lte(0)) {
    throw new SettlementCalculationError(
      'INVALID_RECEIVED_AMOUNT',
      'The received amount must be greater than zero.',
    );
  }

  const lines: CalculatedLine[] = input.claims.map((claim) => {
    const amount = money(claim.amount);
    const remaining = amount.minus(money(claim.settledAmount));
    if (remaining.lte(0)) {
      throw new SettlementCalculationError(
        'CLAIM_ALREADY_SETTLED',
        'A selected claim has no unsettled amount left.',
        { paymentId: claim.paymentId },
      );
    }
    const requested =
      claim.requestedAmount == null ? remaining : money(claim.requestedAmount);
    if (requested.lte(0)) {
      throw new SettlementCalculationError(
        'INVALID_SETTLE_AMOUNT',
        'A per-claim settle amount must be greater than zero.',
        { paymentId: claim.paymentId },
      );
    }
    if (requested.gt(remaining)) {
      throw new SettlementCalculationError(
        'SETTLE_AMOUNT_EXCEEDS_REMAINING',
        `A settle amount (${requested.toFixed(2)}) exceeds the claim's unsettled remainder (${remaining.toFixed(2)}).`,
        {
          paymentId: claim.paymentId,
          requested: requested.toFixed(2),
          remaining: remaining.toFixed(2),
        },
      );
    }
    const fullyReleases = requested.eq(remaining);
    const remainingCarrying = money(claim.carryingTotal).minus(
      money(claim.carryingReleased),
    );
    // The last portion releases exactly what is left, so clearing returns to
    // zero for the claim without rounding residue.
    const carrying = fullyReleases
      ? remainingCarrying
      : D.min(money(requested.times(claim.receiptRate)), remainingCarrying);
    return {
      paymentId: claim.paymentId,
      amount: requested.toFixed(2),
      remainingBefore: remaining.toFixed(2),
      carryingAmountFunctional: carrying.toFixed(2),
      fullyReleases,
    };
  });

  const gross = lines.reduce((sum, l) => sum.plus(l.amount), new D(0));

  let fee: Dec;
  if (input.sameCurrency) {
    fee = gross.minus(received);
    if (fee.lt(0)) {
      throw new SettlementCalculationError(
        'OVER_RECEIPT',
        `The received amount (${received.toFixed(2)}) is more than the gross of the selected claims (${gross.toFixed(2)}). An over-receipt needs manual handling — settle it through a journal entry after investigating the difference.`,
        { gross: gross.toFixed(2), received: received.toFixed(2) },
      );
    }
  } else {
    if (input.feeAmount == null || input.feeAmount === '') {
      throw new SettlementCalculationError(
        'FEE_REQUIRED',
        'The received currency differs from the claim currency. Enter the provider commission in the claim currency — the fee is never derived by subtracting different currencies.',
      );
    }
    fee = money(input.feeAmount);
    if (fee.lt(0)) {
      throw new SettlementCalculationError(
        'INVALID_FEE_AMOUNT',
        'The commission cannot be negative.',
      );
    }
    if (fee.gt(gross)) {
      throw new SettlementCalculationError(
        'FEE_EXCEEDS_GROSS',
        `The commission (${fee.toFixed(2)}) cannot exceed the gross of the selected claims (${gross.toFixed(2)}).`,
      );
    }
  }

  const clearing = lines.reduce(
    (sum, l) => sum.plus(l.carryingAmountFunctional),
    new D(0),
  );
  const bank = money(received.times(input.receivedRate));
  const commission = money(fee.times(input.claimRate));
  const fxDifference = clearing.minus(bank).minus(commission);

  const { accounts, labels } = input;
  const jeLines: JeLine[] = [];
  if (bank.gt(0)) {
    jeLines.push({
      accountId: accounts.bankAccountId,
      role: 'BANK',
      debit: bank.toNumber(),
      credit: 0,
      description: labels.bank,
    });
  }
  if (commission.gt(0)) {
    jeLines.push({
      accountId: accounts.commissionAccountId,
      role: 'COMMISSION',
      debit: commission.toNumber(),
      credit: 0,
      description: labels.commission,
    });
  }
  if (!fxDifference.isZero()) {
    if (!accounts.exchangeDifferenceAccountId) {
      throw new SettlementCalculationError(
        'EXCHANGE_DIFFERENCE_ACCOUNT_NOT_CONFIGURED',
        'This settlement has an FX difference but no Exchange Difference account is configured. Set it in Accounting Settings → Posting Settings, then preview again.',
      );
    }
    jeLines.push({
      accountId: accounts.exchangeDifferenceAccountId,
      role: 'FX_DIFFERENCE',
      debit: fxDifference.gt(0) ? fxDifference.toNumber() : 0,
      credit: fxDifference.lt(0) ? fxDifference.abs().toNumber() : 0,
      description: labels.fx,
    });
  }
  jeLines.push({
    accountId: accounts.clearingAccountId,
    role: 'CLEARING',
    debit: 0,
    credit: clearing.toNumber(),
    description: labels.clearing,
  });

  return {
    lines,
    grossAmount: gross.toFixed(2),
    receivedAmount: received.toFixed(2),
    feeAmount: fee.toFixed(2),
    functional: {
      bank: bank.toFixed(2),
      commission: commission.toFixed(2),
      clearing: clearing.toFixed(2),
      fxDifference: fxDifference.toFixed(2),
    },
    jeLines,
  };
}
