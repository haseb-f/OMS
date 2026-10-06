import type { DocumentPrintPayload } from "@/types/print-engine";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import {
  buildVoucherPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";
import { expenseVoucherHref } from "./expense-voucher";

/** Expense voucher — the shared voucher layout (portrait): one line, the expense account and what was spent. */
export function buildExpenseVoucherPrintPayload(
  voucher: FinancialTransactionRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const { t } = options;
  const meta: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) meta.push({ label, value });
  };
  push(
    t("expenseVouchers.fields.expenseAccount"),
    voucher.expenseAccount
      ? `${voucher.expenseAccount.code} — ${voucher.expenseAccount.name}`
      : null,
  );
  push(t("expenseVouchers.fields.paidFrom"), voucher.receivingAccount?.name);
  push(t("expenseVouchers.fields.paymentMethod"), voucher.paymentSource?.name);
  push(t("printDocument.reference"), voucher.referenceNumber);
  push(t("expenseVouchers.fields.costCenter"), voucher.costCenter?.name);
  push(t("expenseVouchers.fields.project"), voucher.project?.name);
  return buildVoucherPrintPayload(
    {
      type: "payment-voucher",
      variant: "voucher",
      titleKey: "expenseVouchers.printTitle",
      documentNumber: voucher.transactionNumber,
      date: voucher.transactionDate,
      partner: voucher.partner,
      partyRole: "supplier",
      currency: voucher.currency,
      meta,
      allocations: [
        {
          id: voucher.id,
          description:
            voucher.description || voucher.expenseAccount?.name || t("expenseVouchers.editorTitle"),
          amount: Number(voucher.amount),
        },
      ],
      amount: Number(voucher.amount),
      recordPath: expenseVoucherHref(voucher.id),
    },
    options,
  );
}
