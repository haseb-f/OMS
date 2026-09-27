import type { MessageKey } from "@/i18n/translate";
import type { FinancialTransactionEditorFieldErrors } from "./financial-transaction-editor.types";

/** Rounding tolerance for comparing money amounts (half a minor unit). */
const MONEY_TOLERANCE = 0.005;

export type FinancialTransactionErrorKeys = Partial<
  Record<keyof FinancialTransactionEditorFieldErrors, MessageKey>
>;

export interface FinancialTransactionValidationInput {
  hasParty: boolean;
  amount: number;
  allocatedTotal: number;
  receivingAccountId: string | null;
  /** Posting (Confirm) also needs the cash/bank account the money moves through. */
  forPosting?: boolean;
  /**
   * `atMost` (receipts/payments): allocations may leave part of the amount unapplied.
   * `exact` (refunds): the refund must be fully allocated to its returns.
   */
  allocationMode?: "atMost" | "exact";
}

/**
 * Every problem with a receipt/payment/refund, keyed by the field it belongs
 * under — so the editor can show them all inline at once (design §8) instead
 * of one toast at a time. Returns null when the transaction is valid.
 */
export function financialTransactionErrorKeys(
  input: FinancialTransactionValidationInput,
): FinancialTransactionErrorKeys | null {
  const errors: FinancialTransactionErrorKeys = {};
  if (!input.hasParty) errors.party = "financialTransactions.validation.partyRequired";
  if (!(input.amount > 0)) {
    errors.amount = "financialTransactions.validation.amountRequired";
  } else if (
    input.allocationMode === "exact" &&
    Math.abs(input.allocatedTotal - input.amount) > MONEY_TOLERANCE
  ) {
    errors.allocations = "financialTransactions.validation.allocationMustEqualAmount";
  } else if (input.allocatedTotal - input.amount > MONEY_TOLERANCE) {
    errors.allocations = "financialTransactions.validation.allocationExceedsAmount";
  }
  if (input.forPosting && !input.receivingAccountId) {
    errors.receivingAccount = "financialTransactions.validation.receivingAccountRequired";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** Resolves message keys into the editor's inline messages. */
export function translateFieldErrors<TField extends string>(
  keys: Partial<Record<TField, MessageKey>> | null,
  t: (key: MessageKey) => string,
): Partial<Record<TField, string>> | undefined {
  if (!keys) return undefined;
  const result: Partial<Record<TField, string>> = {};
  for (const field of Object.keys(keys) as TField[]) {
    const key = keys[field];
    if (key) result[field] = t(key);
  }
  return result;
}
