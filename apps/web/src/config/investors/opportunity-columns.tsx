"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Ban, Eye, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { StackedCell } from "@/components/shared/stacked-cell";
import { RowActionsMenu, type RowAction } from "@/components/shared/data-table";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import type { InvestmentOpportunityRow } from "@/services/investment-opportunities-service";
import type { MessageKey } from "@/i18n/translate";

const statusTone: Record<
  InvestmentOpportunityRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  OPEN: "success",
  FUNDED: "success",
  ACTIVE: "success",
  ENDED: "warning",
  SETTLED: "neutral",
  CLOSED: "neutral",
  CANCELLED: "destructive",
};

const ARCHIVABLE_STATUSES: InvestmentOpportunityRow["status"][] = ["DRAFT", "CANCELLED", "CLOSED"];
const CANCELLABLE_STATUSES: InvestmentOpportunityRow["status"][] = ["DRAFT", "OPEN", "FUNDED"];
const EDITABLE_STATUSES: InvestmentOpportunityRow["status"][] = ["DRAFT", "OPEN"];

export interface OpportunityRowHandlers {
  onView: (row: InvestmentOpportunityRow) => void;
  onCancel: (row: InvestmentOpportunityRow) => void;
  onArchive: (row: InvestmentOpportunityRow) => void;
}

function ActionsCell({
  row,
  handlers,
}: {
  row: InvestmentOpportunityRow;
  handlers: OpportunityRowHandlers;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const actions: RowAction[] = [
    {
      key: "view",
      label: t("common.view"),
      icon: Eye,
      onSelect: () => handlers.onView(row),
    },
    {
      key: "edit",
      label: t("common.edit"),
      icon: Pencil,
      hidden:
        !EDITABLE_STATUSES.includes(row.status) || !hasPermission("investment-opportunities.edit"),
      onSelect: () => handlers.onView(row),
    },
    {
      key: "cancel",
      label: t("investors.opportunities.actions.cancel"),
      icon: Ban,
      hidden:
        !CANCELLABLE_STATUSES.includes(row.status) ||
        !hasPermission("investment-opportunities.cancel"),
      destructive: true,
      separatorBefore: true,
      onSelect: () => handlers.onCancel(row),
    },
    {
      key: "archive",
      label: t("investors.opportunities.actions.archive"),
      icon: Archive,
      hidden:
        !ARCHIVABLE_STATUSES.includes(row.status) ||
        !hasPermission("investment-opportunities.archive"),
      destructive: true,
      onSelect: () => handlers.onArchive(row),
    },
  ];
  return <RowActionsMenu actions={actions} label={t("common.actions")} />;
}

function StatusCell({ status }: { status: InvestmentOpportunityRow["status"] }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`investors.opportunities.status.${status}` as MessageKey)}
      tone={statusTone[status]}
    />
  );
}

export function buildOpportunityColumns(
  handlers: OpportunityRowHandlers,
): ColumnDef<InvestmentOpportunityRow, unknown>[] {
  return [
    {
      id: "code",
      meta: { titleKey: "investors.opportunities.fields.code", identity: true },
      accessorFn: (row) => row.code,
      cell: ({ row }) => (
        <StackedCell primary={row.original.code} secondary={row.original.nameAr} />
      ),
    },
    {
      id: "startDate",
      meta: { titleKey: "investors.opportunities.fields.startDate" },
      accessorFn: (row) => formatDate(row.startDate),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "endDate",
      meta: { titleKey: "investors.opportunities.fields.endDate" },
      accessorFn: (row) => formatDate(row.endDate),
      cell: (info) => info.getValue() as string,
    },
    {
      id: "status",
      meta: { titleKey: "investors.opportunities.fields.status" },
      cell: ({ row }) => <StatusCell status={row.original.status} />,
      enableSorting: false,
    },
    {
      id: "productsCount",
      meta: { titleKey: "investors.opportunities.fields.productsCount" },
      accessorFn: (row) => row.productsCount,
      cell: (info) => info.getValue() as number,
    },
    {
      id: "targetCapital",
      meta: { titleKey: "investors.opportunities.fields.targetCapital" },
      accessorFn: (row) => row.targetCapital,
      cell: (info) => formatMoney(info.getValue() as number, info.row.original.currency?.code),
    },
    {
      id: "confirmedFundedCapital",
      meta: { titleKey: "investors.opportunities.fields.confirmedFundedCapital" },
      accessorFn: (row) => row.confirmedFundedCapital,
      cell: ({ row }) => (
        <StackedCell
          primary={formatMoney(row.original.confirmedFundedCapital, row.original.currency?.code)}
          secondary={`${row.original.fundingPercent.toFixed(0)}%`}
        />
      ),
    },
    {
      id: "investorsCount",
      meta: { titleKey: "investors.opportunities.fields.investorsCount" },
      accessorFn: (row) => row.investorsCount,
      cell: (info) => info.getValue() as number,
    },
    {
      id: "__actions",
      meta: { titleKey: "common.actions" },
      enableHiding: false,
      cell: ({ row }) => <ActionsCell row={row.original} handlers={handlers} />,
    },
  ];
}

export const opportunityExportColumns = [
  "code",
  "startDate",
  "endDate",
  "status",
  "productsCount",
  "targetCapital",
  "confirmedFundedCapital",
  "investorsCount",
];
