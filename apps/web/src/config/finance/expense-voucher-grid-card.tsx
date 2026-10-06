"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import {
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { FinancialTransactionRow } from "@/services/expense-vouchers-service";
import {
  ExpenseVoucherActionsCell,
  type ExpenseVoucherRowHandlers,
} from "./expense-voucher-row-actions";

/**
 * Expense card (Grid view, design-system §12.19): named by what was spent,
 * tinted by its workflow state; account, paid-from, date and counterparty.
 */
export function ExpenseVoucherGridCard({
  row,
  handlers,
  selected,
  onToggleSelected,
  href,
}: {
  row: FinancialTransactionRow;
  handlers: ExpenseVoucherRowHandlers;
  selected: boolean;
  onToggleSelected?: () => void;
  href: string;
}) {
  const { t } = useLocale();
  const title = row.description || row.expenseAccount?.name || row.transactionNumber;
  const fields: RecordGridCardField[] = [
    {
      key: "expenseAccount",
      label: t("expenseVouchers.fields.expenseAccount"),
      value: row.expenseAccount ? <LocaleText>{row.expenseAccount.name}</LocaleText> : null,
    },
    {
      key: "paidFrom",
      label: t("expenseVouchers.fields.paidFrom"),
      value: row.receivingAccount ? <LocaleText>{row.receivingAccount.name}</LocaleText> : null,
    },
    {
      key: "date",
      label: t("expenseVouchers.fields.date"),
      value: <SemanticValue kind="date">{formatDate(row.transactionDate)}</SemanticValue>,
    },
    {
      key: "counterparty",
      label: t("expenseVouchers.fields.counterparty"),
      value: row.partner ? <LocaleText>{row.partner.name}</LocaleText> : null,
    },
  ];
  return (
    <RecordGridCard
      tone={TRANSACTION_STATUS_TONE[row.status]}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: title })}
      recordLabel={`${title} — ${row.transactionNumber}`}
      title={<LocaleText>{title}</LocaleText>}
      href={href}
      reference={
        <SemanticValue kind="id" className="font-medium">
          {row.transactionNumber}
        </SemanticValue>
      }
      meta={<MoneyValue value={row.amount} currency={row.currency} className="text-foreground" />}
      fields={fields}
      badges={
        <StatusBadge
          label={t(TRANSACTION_STATUS_LABEL_KEY[row.status])}
          tone={TRANSACTION_STATUS_TONE[row.status]}
        />
      }
      actionsNode={<ExpenseVoucherActionsCell row={row} handlers={handlers} />}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
