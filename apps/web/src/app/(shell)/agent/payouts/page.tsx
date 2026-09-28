"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StatusBadge } from "@/components/business/status-badge";
import { agentPortalService, type PortalPayoutRow } from "@/services/agent-portal-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const EXPORT_KEYS = ["number", "date", "amount", "status", "reference", "account"];

function PayoutStatusCell({ row }: { row: PortalPayoutRow }) {
  const { t } = useLocale();
  return (
    <StatusBadge
      label={t(`agentPortal.status.payout.${row.status}`)}
      tone={row.status === "CONFIRMED" ? "success" : "destructive"}
    />
  );
}

function buildPayoutColumns(): ColumnDef<PortalPayoutRow, unknown>[] {
  return [
    {
      id: "number",
      meta: {
        titleKey: "agentPortal.payouts.fields.number",
        type: "code",
        identity: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.payoutNumber,
    },
    {
      id: "date",
      meta: { titleKey: "agentPortal.payouts.fields.date", type: "date" },
      enableSorting: false,
      accessorFn: (row) => formatDate(row.payoutDate),
    },
    {
      id: "amount",
      meta: {
        titleKey: "agentPortal.payouts.fields.amount",
        type: "money",
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.amount,
      cell: ({ row }) => (
        <MoneyValue value={row.original.amount} currency={row.original.currency} />
      ),
    },
    {
      id: "status",
      meta: { titleKey: "agentPortal.payouts.fields.status", type: "status" },
      enableSorting: false,
      accessorFn: (row) => row.status,
      cell: ({ row }) => <PayoutStatusCell row={row.original} />,
    },
    {
      id: "reference",
      meta: { titleKey: "agentPortal.payouts.fields.reference", type: "reference" },
      enableSorting: false,
      accessorFn: (row) => row.reference ?? "",
      cell: ({ row }) =>
        row.original.reference ? (
          <SemanticValue kind="id">{row.original.reference}</SemanticValue>
        ) : (
          "—"
        ),
    },
    {
      id: "account",
      meta: { titleKey: "agentPortal.payouts.fields.account", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.payingAccount?.name ?? "",
    },
    {
      id: "allocations",
      meta: {
        titleKey: "agentPortal.payouts.fields.allocations",
        type: "number",
        defaultHidden: true,
      },
      enableSorting: false,
      accessorFn: (row) => row.allocationCount,
    },
  ];
}

/** Payouts the company made to the agent — read-only (spec §9). */
export default function AgentPayoutsPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<PortalPayoutRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentPortalService.payouts.list({ page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        agentPortalService.payouts.list({ page: nextPage, pageSize: Math.min(nextPageSize, 200) }),
      ),
    [],
  );

  const columns = useMemo(() => buildPayoutColumns(), []);

  return (
    <PageWorkspace
      dense
      title={t("agentPortal.payouts.title")}
      description={t("agentPortal.payouts.description")}
    >
      <EnterpriseDataTable
        tableId="agent-portal-payouts"
        printTitle={t("agentPortal.payouts.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        fetchAllRows={fetchAllRows}
        exportColumns={exportColumnsFromKeys(columns, EXPORT_KEYS, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            items.map((row) => ({
              number: row.payoutNumber,
              date: formatDate(row.payoutDate),
              amount: formatMoney(row.amount, row.currency?.code ?? null),
              status: t(`agentPortal.status.payout.${row.status}`),
              reference: row.reference ?? "",
              account: row.payingAccount?.name ?? "",
            })),
            keys,
            "agent-payouts.csv",
            labels,
          )
        }
        emptyTitle={t("agentPortal.payouts.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/agent/payouts/${row.id}`}
      />
    </PageWorkspace>
  );
}
