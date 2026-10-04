"use client";

import { Archive, Ban, Eye, Pencil, Printer } from "lucide-react";
import { SalesDocumentRowActionsMenu, type SalesDocumentRowAction } from "@/components/sales";
import { TRANSACTION_ARCHIVABLE_STATUSES } from "@/config/financial-transactions/status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { FinancialTransactionRow } from "@/services/supplier-payments-service";

export interface SupplierPaymentRowHandlers {
  onView: (row: FinancialTransactionRow) => void;
  onPrint: (row: FinancialTransactionRow) => void;
  onCancel: (row: FinancialTransactionRow) => void;
  onArchive: (row: FinancialTransactionRow) => void;
}

/** The supplier-payment row actions - one control for the table's actions column and the Grid card. */
export function SupplierPaymentActionsCell({
  row,
  handlers,
}: {
  row: FinancialTransactionRow;
  handlers: SupplierPaymentRowHandlers;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const isDraft = row.status === "DRAFT";
  const canView = hasPermission("purchasing.payments.view");
  const canEdit = hasPermission("purchasing.payments.edit");
  const canPrint = hasPermission("purchasing.payments.print");
  const canCancel = hasPermission("purchasing.payments.cancel");
  const canArchive = hasPermission("purchasing.payments.archive");
  const actions: SalesDocumentRowAction[] = [
    {
      key: "view",
      label: t("common.view"),
      icon: Eye,
      hidden: !canView,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden: !isDraft || !canEdit,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "print",
      label: t("table.print"),
      icon: Printer,
      hidden: !canPrint,
      onSelect: () => handlers.onPrint(row),
    },
    {
      key: "cancel",
      label: t("financialTransactions.actions.cancel"),
      icon: Ban,
      hidden: row.status !== "CONFIRMED" || !canCancel,
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("common.archive"),
      icon: Archive,
      hidden: !TRANSACTION_ARCHIVABLE_STATUSES.includes(row.status) || !canArchive,
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
}
