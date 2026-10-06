"use client";

import { Archive, Eye, Pencil, Printer, Undo2 } from "lucide-react";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { TRANSACTION_ARCHIVABLE_STATUSES } from "@/config/financial-transactions/status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { FinancialTransactionRow } from "@/services/expense-vouchers-service";

export interface ExpenseVoucherRowHandlers {
  onView: (row: FinancialTransactionRow) => void;
  onPrint: (row: FinancialTransactionRow) => void;
  onReverse: (row: FinancialTransactionRow) => void;
  onArchive: (row: FinancialTransactionRow) => void;
}

/** Expense row actions — one control for the table's actions column and the Grid card. */
export function ExpenseVoucherActionsCell({
  row,
  handlers,
}: {
  row: FinancialTransactionRow;
  handlers: ExpenseVoucherRowHandlers;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("common.view"),
      icon: Eye,
      hidden: !hasPermission("accounting.expense-payments.view"),
      onSelect: () => handlers.onView(row),
    },
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden: row.status !== "DRAFT" || !hasPermission("accounting.expense-payments.edit"),
      onSelect: () => handlers.onView(row),
    },
    {
      key: "print",
      label: t("table.print"),
      icon: Printer,
      hidden: !hasPermission("accounting.expense-payments.print"),
      onSelect: () => handlers.onPrint(row),
    },
    {
      key: "reverse",
      label: t("expenseVouchers.actions.reverse"),
      icon: Undo2,
      hidden: row.status !== "CONFIRMED" || !hasPermission("accounting.expense-payments.cancel"),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onReverse(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden:
        !TRANSACTION_ARCHIVABLE_STATUSES.includes(row.status) ||
        !hasPermission("accounting.expense-payments.archive"),
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}
