"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StatusBadge } from "@/components/business/status-badge";
import { agentStockService, type AgentStockReceipt } from "@/services/agent-stock-service";
import { AgentBadge, AgentFilter } from "./agent-options";
import { localizedName } from "@/lib/localized-name";
import { formatBusinessDate } from "@/lib/business-date";
import { formatNumber } from "@/lib/format-number";
import { apiErrorMessage } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

const EXPORT_KEYS = [
  "number",
  "date",
  "kind",
  "agent",
  "warehouse",
  "lines",
  "quantity",
  "reference",
  "createdBy",
];

function buildColumns(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
  locale: "ar" | "en",
  showAgent: boolean,
): ColumnDef<AgentStockReceipt, unknown>[] {
  const columns: ColumnDef<AgentStockReceipt, unknown>[] = [
    {
      id: "number",
      meta: {
        titleKey: "agentStock.receipts.fields.number",
        type: "code",
        identity: true,
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.receiptNumber,
      cell: ({ row }) => <SemanticValue kind="id">{row.original.receiptNumber}</SemanticValue>,
    },
    {
      id: "date",
      meta: { titleKey: "agentStock.receipts.fields.date", type: "date", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => formatBusinessDate(row.receiptDate),
    },
    {
      id: "kind",
      meta: { titleKey: "agentStock.receipts.fields.kind", type: "status", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => t(`agentStock.receipts.kind.${row.kind}` as MessageKey),
      cell: ({ row }) => (
        <StatusBadge
          label={t(`agentStock.receipts.kind.${row.original.kind}` as MessageKey)}
          tone={row.original.kind === "OPENING" ? "info" : "success"}
        />
      ),
    },
  ];
  if (showAgent) {
    columns.push({
      id: "agent",
      meta: { titleKey: "agentStock.receipts.fields.agent", importance: "high", minWidth: 140 },
      enableSorting: false,
      accessorFn: (row) => row.agent.name,
      cell: ({ row }) => <AgentBadge agent={row.original.agent} />,
    });
  }
  columns.push(
    {
      id: "warehouse",
      meta: { titleKey: "agentStock.receipts.fields.warehouse", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.warehouse.name,
    },
    {
      id: "lines",
      meta: {
        titleKey: "agentStock.receipts.fields.lines",
        type: "name",
        stacked: true,
        importance: "high",
        minWidth: 180,
        grow: 2,
      },
      enableSorting: false,
      accessorFn: (row) =>
        row.lines
          .map((line) => `${localizedName(line.product, locale)} × ${line.quantity}`)
          .join(", "),
      cell: ({ row }) => {
        const [first, ...rest] = row.original.lines;
        return (
          <StackedCell
            primary={
              first
                ? `${localizedName(first.product, locale)} × ${formatNumber(first.quantity)}`
                : "—"
            }
            secondary={
              rest.length > 0
                ? t("agentStock.receipts.linesSummary", { count: row.original.lines.length })
                : first?.product.sku
            }
          />
        );
      },
    },
    {
      id: "quantity",
      meta: {
        titleKey: "agentStock.receipts.fields.quantity",
        type: "quantity",
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.totalQuantity,
      cell: ({ row }) => <span className="num">{formatNumber(row.original.totalQuantity)}</span>,
    },
    {
      id: "reference",
      meta: {
        titleKey: "agentStock.receipts.fields.reference",
        type: "reference",
        importance: "medium",
      },
      enableSorting: false,
      accessorFn: (row) => row.reference ?? "",
      cell: ({ row }) =>
        row.original.reference ? (
          <StackedCell
            primary={row.original.reference}
            secondary={row.original.notes ?? undefined}
          />
        ) : (
          <span className="text-muted-foreground">{row.original.notes ?? "—"}</span>
        ),
    },
    {
      id: "createdBy",
      meta: { titleKey: "agentStock.receipts.fields.createdBy", importance: "low" },
      enableSorting: false,
      accessorFn: (row) => row.createdByUser?.fullName ?? "",
    },
  );
  return columns;
}

/**
 * R18 B — agent stock receipts list, server-paged. With `agentId` it is the
 * agent page's section (agent fixed, no agent column); without it, the
 * receipts page across agents with an agent filter. `receiptId` narrows it to
 * one receipt (the link of a movement's source document).
 */
export function AgentStockReceiptsTable({
  agentId,
  receiptId,
  printTitle,
  reloadKey = 0,
}: {
  agentId?: string;
  receiptId?: string;
  printTitle: string;
  reloadKey?: number;
}) {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<AgentStockReceipt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentStockService.receipts({
        agentId: agentId ?? (agentFilter || undefined),
        receiptId,
        search: search || undefined,
        page,
        pageSize,
      });
      setRows(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, agentFilter, receiptId, search, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, reloadKey]);

  const columns = useMemo(() => buildColumns(t, locale, !agentId), [t, locale, agentId]);

  return (
    <EnterpriseDataTable
      tableId={agentId ? "agent-stock-receipts-agent" : "agent-stock-receipts"}
      printTitle={printTitle}
      columns={columns}
      data={rows}
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
      searchPlaceholder={t("agentStock.receipts.searchPlaceholder")}
      filterBar={
        agentId ? undefined : (
          <AgentFilter
            value={agentFilter}
            onChange={(value) => {
              setAgentFilter(value);
              setPage(1);
            }}
          />
        )
      }
      activeFilterCount={!agentId && agentFilter ? 1 : 0}
      onClearFilters={() => {
        setAgentFilter("");
        setPage(1);
      }}
      isLoading={isLoading}
      error={loadError}
      onRetry={() => void load()}
      onRefresh={() => void load()}
      exportColumns={exportColumnsFromKeys(
        columns,
        EXPORT_KEYS.filter((key) => !agentId || key !== "agent"),
        t,
      )}
      onExport={(keys, labels) =>
        exportRowsToCsv(
          rows.map((row) => ({
            number: row.receiptNumber,
            date: row.receiptDate,
            kind: t(`agentStock.receipts.kind.${row.kind}` as MessageKey),
            agent: `${row.agent.name} (${row.agent.agentNumber})`,
            warehouse: row.warehouse.name,
            lines: row.lines.map((line) => `${line.product.sku} × ${line.quantity}`).join("; "),
            quantity: row.totalQuantity,
            reference: row.reference ?? "",
            createdBy: row.createdByUser?.fullName ?? "",
          })),
          keys,
          "agent-stock-receipts.csv",
          labels,
        )
      }
      emptyTitle={t("agentStock.receipts.empty")}
      getRowId={(row) => row.id}
    />
  );
}
