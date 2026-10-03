import {
  deriveNativeAmount,
  type EntryCurrencyHeader,
  type NativeAmountStatus,
} from '../fx/account-currency';
import { roundReportMoney } from './financial-report-tree';

/** Provenance of the rate frozen on the source document (only vouchers record it). */
export interface RateProvenance {
  rateSource: string | null;
  rateAsOf: string | null;
}

export interface NativeMovement {
  lineId: string;
  status: NativeAmountStatus;
  /** Debit / credit in the account's own currency; null when not provable. */
  debit: number | null;
  credit: number | null;
  /** Running native balance (proven lines only); null on an unproven line. */
  runningBalance: number | null;
  rate: number | null;
  rateSource: string | null;
  rateAsOf: string | null;
}

export interface NativeLedger {
  currencyId: string;
  currencyCode: string;
  functionalCurrencyCode: string;
  /** Sum of proven native amounts only — never a balance re-translated at today's rate. */
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
  /** Lines (opening + period) whose native amount the ledger cannot prove. */
  unprovenLineCount: number;
  /** Functional (net debit − credit) of those lines, so nothing is hidden. */
  unprovenFunctionalAmount: number;
  /** True when every line is proven: native closing is then the full native balance. */
  complete: boolean;
  movements: NativeMovement[];
}

/** The native view without its per-line rows (those ride on each ledger movement). */
export type NativeLedgerSummary = Omit<NativeLedger, 'movements'>;

export interface NativeLedgerLine {
  lineId: string;
  debit: number;
  credit: number;
  entry: EntryCurrencyHeader;
  provenance?: RateProvenance;
}

/**
 * Native-currency view of a currency-bound account's ledger. Amounts are
 * derived per line from the entry header (see `deriveNativeAmount`); lines
 * posted in another currency, or without a recorded rate, are counted and
 * reported as unproven instead of guessed.
 */
export function buildNativeLedger(input: {
  accountCurrencyId: string;
  currencyCode: string;
  functionalCurrencyCode: string;
  openingLines: Array<Pick<NativeLedgerLine, 'debit' | 'credit' | 'entry'>>;
  periodLines: NativeLedgerLine[];
}): NativeLedger {
  let unproven = 0;
  let unprovenFunctional = 0;
  let opening = 0;
  for (const line of input.openingLines) {
    const net = line.debit - line.credit;
    const native = deriveNativeAmount(net, line.entry, input.accountCurrencyId);
    if (native.amount === null) {
      unproven += 1;
      unprovenFunctional += net;
    } else {
      opening += native.amount;
    }
  }
  opening = roundReportMoney(opening);

  let running = opening;
  let periodDebit = 0;
  let periodCredit = 0;
  const movements = input.periodLines.map((line): NativeMovement => {
    const net = line.debit - line.credit;
    const native = deriveNativeAmount(net, line.entry, input.accountCurrencyId);
    if (native.amount === null) {
      unproven += 1;
      unprovenFunctional += net;
      return {
        lineId: line.lineId,
        status: native.status,
        debit: null,
        credit: null,
        runningBalance: null,
        rate: null,
        rateSource: null,
        rateAsOf: null,
      };
    }
    const debit = native.amount > 0 ? native.amount : 0;
    const credit = native.amount < 0 ? -native.amount : 0;
    periodDebit += debit;
    periodCredit += credit;
    running = roundReportMoney(running + native.amount);
    return {
      lineId: line.lineId,
      status: native.status,
      debit,
      credit,
      runningBalance: running,
      rate: native.rate,
      rateSource: line.provenance?.rateSource ?? null,
      rateAsOf: line.provenance?.rateAsOf ?? null,
    };
  });

  return {
    currencyId: input.accountCurrencyId,
    currencyCode: input.currencyCode,
    functionalCurrencyCode: input.functionalCurrencyCode,
    openingBalance: opening,
    periodDebit: roundReportMoney(periodDebit),
    periodCredit: roundReportMoney(periodCredit),
    closingBalance: roundReportMoney(opening + periodDebit - periodCredit),
    unprovenLineCount: unproven,
    unprovenFunctionalAmount: roundReportMoney(unprovenFunctional),
    complete: unproven === 0,
    movements,
  };
}
