import { useCallback, useRef, useState } from "react";
import type { MessageKey } from "@/i18n/translate";
import type { DocumentActionConfirmation } from "@/components/documents/document-action-bar";

/** Half a minor unit — the same money tolerance as the voucher validation. */
const MONEY_TOLERANCE = 0.005;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The money a receipt / payment moved (R18). A "Receive / Record Payment"
 * prefill proposes the invoice balance; until the user types an amount
 * themselves the amount follows the allocation lines, so lowering the
 * allocated part of a prefilled invoice lowers the money recorded with it —
 * never a silent advance of the difference posted to the bank.
 */
export function useVoucherAmount() {
  const [amount, setAmountState] = useState(0);
  const followsAllocations = useRef(false);

  /** Typed by the user (or loaded from the saved voucher): the amount is theirs. */
  const setAmount = useCallback((value: number) => {
    followsAllocations.current = false;
    setAmountState(value);
  }, []);

  /** Proposed from an invoice balance: follows the allocation lines until typed over. */
  const proposeAmount = useCallback((value: number) => {
    followsAllocations.current = true;
    setAmountState(value);
  }, []);

  const syncToAllocations = useCallback((lines: readonly { allocatedAmount: number }[]) => {
    if (!followsAllocations.current) return;
    setAmountState(round2(lines.reduce((sum, line) => sum + line.allocatedAmount, 0)));
  }, []);

  return { amount, setAmount, proposeAmount, syncToAllocations };
}

/**
 * Confirmation before posting a voucher that leaves part of its money
 * unapplied while the party has invoices to apply it to (R18): the whole
 * amount is posted to the cash / bank account and the rest stays an advance
 * on the party's account. Null when everything is applied or nothing could be.
 */
export function unappliedPostingConfirmation(
  input: {
    amount: number;
    allocatedTotal: number;
    hasOpenInvoices: boolean;
    direction: "IN" | "OUT";
  },
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  formatMoney: (value: number) => string,
): DocumentActionConfirmation | undefined {
  const unapplied = round2(input.amount - input.allocatedTotal);
  if (unapplied <= MONEY_TOLERANCE) return undefined;
  if (!input.hasOpenInvoices && input.allocatedTotal <= MONEY_TOLERANCE) return undefined;
  const values = {
    amount: formatMoney(round2(input.amount)),
    allocated: formatMoney(round2(input.allocatedTotal)),
    unapplied: formatMoney(unapplied),
  };
  // R20 — open invoices but none selected: the whole amount is an explicit
  // unapplied advance, said so before posting (no invoice is marked paid).
  if (input.allocatedTotal <= MONEY_TOLERANCE) {
    return {
      title: t("financialTransactions.unapplied.noInvoiceTitle"),
      description: t(
        input.direction === "IN"
          ? "financialTransactions.unapplied.noInvoiceReceiptDescription"
          : "financialTransactions.unapplied.noInvoicePaymentDescription",
        values,
      ),
      confirmLabel: t("financialTransactions.unapplied.confirmAdvance", values),
      tone: "warning",
    };
  }
  return {
    title: t("financialTransactions.unapplied.title"),
    description: t(
      input.direction === "IN"
        ? "financialTransactions.unapplied.receiptDescription"
        : "financialTransactions.unapplied.paymentDescription",
      values,
    ),
    confirmLabel: t("financialTransactions.unapplied.confirm", values),
    tone: "warning",
  };
}
