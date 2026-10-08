"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldAlert, Undo2 } from "lucide-react";
import { RowActionsMenu } from "@/components/shared/data-table";
import { RecordRefundDialog } from "./agent-finance-dialogs";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import {
  AgentOrderEntryButton,
  type AgentEntryTarget,
} from "@/components/order-entry/agent/agent-order-entry-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import {
  DECLARED_STATUS_TONE,
  declaredStatusLabelKey,
} from "@/components/payments/declaration/declaration-status";
import { agentOrderBreakdown } from "@/config/agents/agent-order";
import type { StoreOrderRow } from "@/services/store-orders-service";
import { agentsService } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";
import { fetchAllPages } from "@/lib/fetch-all-pages";

function money(row: StoreOrderRow, value: number | string | null | undefined) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <MoneyValue value={value} currency={row.currency} />;
}

function FulfillmentCell({ row }: { row: StoreOrderRow }) {
  const { locale } = useLocale();
  const status = row.fulfillmentStatus;
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge label={(locale === "en" ? status.nameEn : null) ?? status.name} tone="neutral" />
  );
}

function DeclaredCell({ row }: { row: StoreOrderRow }) {
  const { t } = useLocale();
  const status = row.declaredPaymentStatus ?? "UNPAID";
  return (
    <StatusBadge label={t(declaredStatusLabelKey(status))} tone={DECLARED_STATUS_TONE[status]} />
  );
}

function RefundActionCell({
  row,
  onRefund,
}: {
  row: StoreOrderRow;
  onRefund: (row: StoreOrderRow) => void;
}) {
  const { t } = useLocale();
  return (
    <RowActionsMenu
      label={t("common.actions")}
      actions={[
        {
          key: "refund",
          label: t("agents.refund.action"),
          icon: Undo2,
          onSelect: () => onRefund(row),
        },
      ]}
    />
  );
}

function buildColumns(
  onRefund?: (row: StoreOrderRow) => void,
): ColumnDef<StoreOrderRow, unknown>[] {
  const amount = (
    id: "merchandise" | "shipping" | "service",
    pick: (row: StoreOrderRow) => number | null,
  ): ColumnDef<StoreOrderRow, unknown> => ({
    id,
    meta: { titleKey: `agents.orders.${id}`, type: "money", importance: "low" },
    enableSorting: false,
    accessorFn: (row) => pick(row) ?? "",
    cell: ({ row }) => money(row.original, pick(row.original)),
  });
  return [
    {
      id: "internalOrderId",
      meta: {
        titleKey: "agents.orders.order",
        type: "code",
        identity: true,
        importance: "critical",
        minWidth: 130,
      },
      enableSorting: false,
      accessorFn: (row) => row.internalOrderId,
    },
    {
      id: "orderDate",
      meta: { titleKey: "agents.orders.date", type: "date", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => formatDate(row.orderDate),
    },
    {
      id: "customer",
      meta: {
        titleKey: "agents.orders.customer",
        stacked: true,
        type: "name",
        importance: "high",
        minWidth: 160,
      },
      enableSorting: false,
      accessorFn: (row) => row.partner?.name ?? "",
      cell: ({ row }) => (
        <StackedCell
          primary={row.original.partner?.name ?? "—"}
          secondary={row.original.partner?.phone ?? row.original.partner?.mobile ?? undefined}
        />
      ),
    },
    amount("merchandise", (row) => agentOrderBreakdown(row)?.merchandise ?? null),
    amount("shipping", (row) => agentOrderBreakdown(row)?.shipping ?? null),
    amount("service", (row) => agentOrderBreakdown(row)?.service ?? null),
    {
      id: "payable",
      meta: { titleKey: "agents.orders.payable", type: "money", importance: "critical" },
      enableSorting: false,
      accessorFn: (row) => row.payableTotal ?? row.total ?? "",
      cell: ({ row }) =>
        money(row.original, row.original.payableTotal ?? row.original.total ?? null),
    },
    {
      id: "fulfillment",
      meta: { titleKey: "agents.orders.fulfillment", type: "status", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.fulfillmentStatus?.name ?? "",
      cell: ({ row }) => <FulfillmentCell row={row.original} />,
    },
    {
      id: "declared",
      meta: { titleKey: "agents.orders.declared", type: "status", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.declaredPaymentStatus ?? "",
      cell: ({ row }) => <DeclaredCell row={row.original} />,
    },
    ...(onRefund
      ? ([
          {
            id: "__actions",
            meta: { titleKey: "common.actions", importance: "critical" },
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => <RefundActionCell row={row.original} onRefund={onRefund} />,
          },
        ] satisfies ColumnDef<StoreOrderRow, unknown>[])
      : []),
  ];
}

/**
 * The agent's orders with their price breakdown — `GET /agents/:id/orders`
 * (`agents.view`), not the sales-scoped Store Orders list.
 */
export function AgentOrdersTab({
  agentId,
  agentLabel,
  entryTarget,
}: {
  agentId: string;
  agentLabel: string;
  /** R15 (D15-19) — staff enter an order for this agent with the shared order-entry flow. */
  entryTarget?: AgentEntryTarget;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canView = hasPermission("agents.view");
  const [items, setItems] = useState<StoreOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentsService.orders(agentId, {
        search: search || undefined,
        page,
        pageSize,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, canView, page, pageSize, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        agentsService.orders(agentId, {
          search: search || undefined,
          page: nextPage,
          pageSize: nextPageSize,
          sortBy: "createdAt",
          sortOrder: "desc",
        }),
      ),
    [agentId, search],
  );

  const canRefund = hasPermission("agents.finance.adjust");
  const [refundTarget, setRefundTarget] = useState<StoreOrderRow | null>(null);
  const columns = useMemo(() => buildColumns(canRefund ? setRefundTarget : undefined), [canRefund]);

  if (!canView) {
    return <EmptyState icon={ShieldAlert} tone="denied" title={t("agents.orders.noPermission")} />;
  }

  return (
    <>
      {/* Its own row (not the filter bar, which folds into a sheet on phones). */}
      {entryTarget ? (
        <div className="flex justify-end">
          <AgentOrderEntryButton agent={entryTarget} onCreated={() => void load()} />
        </div>
      ) : null}
      <EnterpriseDataTable
        tableId="agent-orders"
        printTitle={`${t("agents.tabs.orders")} — ${agentLabel}`}
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
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        fetchAllRows={fetchAllRows}
        emptyTitle={t("agents.orders.empty")}
        getRowId={(row) => row.id}

        getRowHref={(row) => `/store-orders/${row.id}`}
      />
      {refundTarget ? (
        <RecordRefundDialog
          orderId={refundTarget.id}
          orderNumber={refundTarget.internalOrderId}
          currency={refundTarget.currency?.code ?? ""}
          onOpenChange={(open) => !open && setRefundTarget(null)}
          onRecorded={() => void load()}
        />
      ) : null}
    </>
  );
}
