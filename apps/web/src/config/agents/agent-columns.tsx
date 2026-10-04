"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { formatClassRates } from "@/config/agents/agreement-form";
import { StatusBadge } from "@/components/business/status-badge";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { AgentRow } from "@/services/agents-service";

function StatusCell({ row }: { row: AgentRow }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agents.status.${row.status}` as MessageKey)}
      tone={row.status === "ACTIVE" ? "success" : "neutral"}
    />
  );
}

function AgreementCell({ row }: { row: AgentRow }) {
  const { t } = useLocale();
  const agreement = row.activeAgreement;
  if (!agreement) {
    return <span className="text-muted-foreground">{t("agents.noActiveAgreement")}</span>;
  }
  return (
    <StackedCell
      primary={<SemanticValue kind="id">{agreement.agreementNumber}</SemanticValue>}
      secondary={`${t("agents.fields.commission")} ${formatClassRates(agreement)}`}
    />
  );
}

export function buildAgentColumns(): ColumnDef<AgentRow, unknown>[] {
  return [
    {
      id: "agentNumber",
      meta: {
        titleKey: "agents.fields.number",
        type: "code",
        identity: true,
        importance: "critical",
        minWidth: 110,
        maxWidth: 150,
      },
      enableSorting: false,
      accessorFn: (row) => row.agentNumber,
    },
    {
      id: "name",
      meta: {
        titleKey: "agents.fields.name",
        stacked: true,
        type: "name",
        importance: "critical",
        minWidth: 180,
        grow: 2,
      },
      enableSorting: false,
      accessorFn: (row) => row.name,
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.name}
          secondary={row.original.legalName ?? row.original.contactName ?? undefined}
        />
      ),
    },
    {
      id: "status",
      meta: { titleKey: "agents.fields.status", type: "status", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => row.status,
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
    {
      id: "currency",
      meta: { titleKey: "agents.fields.currency", type: "code", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.currency?.code ?? "",
    },
    {
      id: "activeAgreement",
      meta: {
        titleKey: "agents.fields.activeAgreement",
        type: "default",
        stacked: true,
        importance: "medium",
        minWidth: 150,
      },
      enableSorting: false,
      accessorFn: (row) => row.activeAgreement?.agreementNumber ?? "",
      cell: ({ row }) => <AgreementCell row={row.original} />,
    },
    {
      id: "orders",
      meta: { titleKey: "agents.fields.orders", type: "number", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row._count?.storeOrders ?? 0,
    },
    {
      id: "users",
      meta: { titleKey: "agents.fields.users", type: "number", importance: "low" },
      enableSorting: false,
      accessorFn: (row) => row._count?.users ?? 0,
    },
    {
      id: "products",
      meta: {
        titleKey: "agents.fields.products",
        type: "number",
        importance: "low",
        defaultHidden: true,
      },
      enableSorting: false,
      accessorFn: (row) => row._count?.products ?? 0,
    },
  ];
}

export const agentExportColumns = [
  "agentNumber",
  "name",
  "status",
  "currency",
  "activeAgreement",
  "orders",
  "users",
  "products",
];

export function agentExportRow(
  row: AgentRow,
  t: (key: MessageKey) => string,
): Record<string, string> {
  return {
    agentNumber: row.agentNumber,
    name: row.name,
    status: t(`agents.status.${row.status}` as MessageKey),
    currency: row.currency?.code ?? "",
    activeAgreement: row.activeAgreement
      ? `${row.activeAgreement.agreementNumber} (${formatClassRates(row.activeAgreement)})`
      : "",
    orders: String(row._count?.storeOrders ?? 0),
    users: String(row._count?.users ?? 0),
    products: String(row._count?.products ?? 0),
  };
}
