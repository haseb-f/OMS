/**
 * Account-currency rules (Round 7 — FX policy gap).
 *
 * Facts this module encodes (see specs/round7-grid-scope-fx/fx-policy-gap.md):
 *  - Every Journal Entry line is stored in the FUNCTIONAL (base) currency.
 *  - The entry header carries the document currency + the frozen rate
 *    (functional per 1 unit of document currency); manual entries carry a
 *    currency label but no rate.
 *  - `ChartOfAccount.currencyId` ("locked to SAR") is a statement about which
 *    native currency the account is *meant* to hold. Nothing at posting time
 *    used to compare it with the entry currency; this module is that check
 *    (policy-driven) and the one place that derives native amounts.
 */

export type AccountCurrencyPolicy = 'OFF' | 'WARN' | 'BLOCK';

/**
 * `ACCOUNT_CURRENCY_POLICY` (env). Default WARN: a posting whose currency
 * differs from a currency-bound account is still posted (history and existing
 * flows are untouched) but leaves an activity-log warning on the entry. BLOCK
 * fails closed (opt-in once Finance has reviewed the affected entries); OFF
 * disables the check.
 */
export function readAccountCurrencyPolicy(
  env: Record<string, string | undefined> = process.env,
): AccountCurrencyPolicy {
  const raw = (env.ACCOUNT_CURRENCY_POLICY ?? 'WARN').trim().toUpperCase();
  return raw === 'OFF' || raw === 'BLOCK' ? raw : 'WARN';
}

export interface CurrencyBoundAccount {
  id: string;
  code: string;
  name?: string | null;
  currencyId: string | null;
}

export interface CurrencyMismatch {
  accountId: string;
  accountCode: string;
  accountCurrencyId: string;
  /** The entry's effective currency (header currency, else functional). */
  entryCurrencyId: string;
}

/**
 * Lines that hit a currency-bound (non-functional) account while the entry's
 * effective currency is different. Accounts bound to the functional currency
 * never mismatch (lines are always functional amounts), and unbound accounts
 * "follow whatever currency each posting uses".
 */
export function findCurrencyMismatches(
  accounts: CurrencyBoundAccount[],
  entryCurrencyId: string | null | undefined,
  functionalCurrencyId: string | null | undefined,
): CurrencyMismatch[] {
  if (!functionalCurrencyId) return [];
  const effective = entryCurrencyId ?? functionalCurrencyId;
  return accounts
    .filter(
      (account) =>
        account.currencyId &&
        account.currencyId !== functionalCurrencyId &&
        account.currencyId !== effective,
    )
    .map((account) => ({
      accountId: account.id,
      accountCode: account.code,
      accountCurrencyId: account.currencyId as string,
      entryCurrencyId: effective,
    }));
}

export type NativeAmountStatus =
  /** Entry currency = account currency and a positive rate is recorded. */
  | 'PROVEN'
  /** The entry was posted in a different currency than the account's. */
  | 'ENTRY_CURRENCY_DIFFERS'
  /** Same currency but the entry header holds no rate (e.g. a manual entry). */
  | 'NO_RATE_RECORDED';

export interface NativeAmount {
  status: NativeAmountStatus;
  /** Signed (debit − credit) in the account's own currency; null when not provable. */
  amount: number | null;
  /** Functional per 1 native unit, as frozen on the entry header. */
  rate: number | null;
}

export interface EntryCurrencyHeader {
  currencyId: string | null;
  exchangeRate: { toString(): string } | number | string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Native amount of one ledger line of a currency-bound account, derived from
 * the entry header: (debit − credit) ÷ header rate. Only claimed when the
 * entry is in the account's currency and records a rate — otherwise the
 * honest answer is "cannot be proven", never a guess.
 */
export function deriveNativeAmount(
  netFunctional: number,
  entry: EntryCurrencyHeader,
  accountCurrencyId: string,
): NativeAmount {
  // A zero line carries no native value in any currency: nothing to prove.
  if (Math.abs(netFunctional) < 0.005) {
    return { status: 'PROVEN', amount: 0, rate: null };
  }
  if (entry.currencyId !== accountCurrencyId) {
    return { status: 'ENTRY_CURRENCY_DIFFERS', amount: null, rate: null };
  }
  const rate =
    entry.exchangeRate == null ? NaN : Number(entry.exchangeRate.toString());
  if (!Number.isFinite(rate) || rate <= 0) {
    return { status: 'NO_RATE_RECORDED', amount: null, rate: null };
  }
  return { status: 'PROVEN', amount: round2(netFunctional / rate), rate };
}
