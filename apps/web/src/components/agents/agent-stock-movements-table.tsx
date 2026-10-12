"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import type { Paged } from "@/services/agents-service";
import {
  type AgentStockDocument,
  type AgentStockEvent,
  type AgentStockMovement,
} from "@/services/agent-stock-service";
import { agentStockReceiptHref } from "@/config/traceability/record-routes";
import { localizedName } from "@/lib/localized-name";
import { formatBusinessDateTime } from "@/lib/business-date";
import { formatNumber } from "@/lib/format-number";
import { apiErrorMessage } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

const EVENT_TONE: Partial<Record<AgentStockEvent, StatusTone>> = {
  OPENING: "success",
  RECEIPT: "success",
  RETURNED: "success",
  DELIVERED: "info",
  DISPATCHED: "info",
  WRITTEN_OFF: "destructive",
};

/**
 * Where a source document opens for this audience: the internal agent page
 * links orders to Store Orders, the agent portal to its own order page; a
 * receipt opens on the receipts page only internally.
 */
export interface AgentStockDocumentLinks {
  order: (storeOrderId: string) => string;
  receipt?: (receiptId: string) => string;
}

export const INTERNAL_DOCUMENT_LINKS: AgentStockDocumentLinks = {
  order: (id) => `/store-orders/${id}`,
  receipt: agentStockReceiptHref,
};

export function documentHref(document: AgentStockDocument, links: AgentStockDocumentLinks) {
  if (document.kind === "AGENT_STOCK_RECEIPT") return links.receipt?.(document.id) ?? null;
  if (document.kind === "AGENT_RETURN") return links.order(document.storeOrderId);
  return links.order(document.id);
}

function DocumentCell({
  document,
  links,
}: {
  document: AgentStockDocument | null;
  links: AgentStockDocumentLinks;
}) {
  const { t } = useLocale();
  if (!document) return <span className="text-muted-foreground">—</span>;
  const href = documentHref(document, links);
  const number = <SemanticValue kind="id">{document.number}</SemanticValue>;
  return (
    <StackedCell
      primary={
        href ? (
          <Link href={href} className="hover:underline">
            {number}
          </Link>
        ) : (
          number
        )
      }
      secondary={t(`agentStock.history.document.${document.kind}` as MessageKey)}
    />
  );
}

function buildColumns(
  t: (key: MessageKey) => string,
  locale: "ar" | "en",
  links: AgentStockDocumentLinks,
): ColumnDef<AgentStockMovement, unknown>[] {
  return [
    {
      id: "date",
      meta: { titleKey: "agentStock.history.fields.date", type: "date", importance: "high" },
      enableSorting: false,
      accessorFn: (row) => formatBusinessDateTime(row.createdAt),
    },
    {
      id: "event",
      meta: { titleKey: "agentStock.history.fields.event", type: "status", importance: "critical" },
      enableSorting: false,
      accessorFn: (row) => t(`agentStock.history.event.${row.event}` as MessageKey),
      cell: ({ row }) => (
        <StatusBadge
          label={t(`agentStock.history.event.${row.original.event}` as MessageKey)}
          tone={EVENT_TONE[row.original.event] ?? "neutral"}
        />
      ),
    },
    {
      id: "product",
      meta: {
        titleKey: "agentStock.history.fields.product",
        type: "name",
        stacked: true,
        importance: "critical",
        minWidth: 160,
        grow: 2,
      },
      enableSorting: false,
      accessorFn: (row) => `${localizedName(row.product, locale)} ${row.product.sku}`,
      cell: ({ row }) => (
        <StackedCell
          primary={localizedName(row.original.product, locale)}
          secondary={<SemanticValue kind="id">{row.original.product.sku}</SemanticValue>}
        />
      ),
    },
    {
      id: "warehouse",
      meta: { titleKey: "agentStock.history.fields.warehouse", importance: "medium" },
      enableSorting: false,
      accessorFn: (row) => row.warehouse.name,
    },
    {
      id: "quantity",
      meta: {
        titleKey: "agentStock.history.fields.quantity",
        type: "quantity",
        importance: "critical",
      },
      enableSorting: false,
      accessorFn: (row) => row.quantity,
      cell: ({ row }) => (
        <span className="num">
          {row.original.quantity > 0 ? "+" : ""}
          {formatNumber(row.original.quantity)}
        </span>
      ),
    },
    {
      id: "document",
      meta: {
        titleKey: "agentStock.history.fields.document",
        type: "reference",
        importance: "high",
      },
      enableSorting: false,
      accessorFn: (row) => row.document?.number ?? "",
      cell: ({ row }) => <DocumentCell document={row.original.document} links={links} />,
    },
    {
      id: "movement",
      meta: { titleKey: "agentStock.history.fields.movement", type: "code", importance: "low" },
      enableSorting: false,
      accessorFn: (row) => row.movementNumber,
      cell: ({ row }) => <SemanticValue kind="id">{row.original.movementNumber}</SemanticValue>,
    },
  ];
}

/**
 * R18 B — an agent's stock movement history (receipts, reservations,
 * dispatch / back from transit, delivery, returns), each row linked to its
 * document. One component for the internal agent page and the agent portal;
 * `load` is the audience's own endpoint (the portal one is scoped server-side
 * to the caller's agent).
 */
export function AgentStockMovementsTable({
  tableId,
  printTitle,
  load,
  links,
  reloadKey = 0,
}: {
  tableId: string;
  printTitle: string;
  load: (params: { page: number; pageSize: number }) => Promise<Paged<AgentStockMovement>>;
  links: AgentStockDocumentLinks;
  /** Bump to reload after a change elsewhere on the page (e.g. a new receipt). */
  reloadKey?: number;
}) {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<AgentStockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchPage = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await load({ page, pageSize });
      setRows(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [load, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPage();
  }, [fetchPage, reloadKey]);

  const columns = useMemo(() => buildColumns(t, locale, links), [t, locale, links]);

  return (
    <EnterpriseDataTable
      tableId={tableId}
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
      isLoading={isLoading}
      error={loadError}
      onRetry={() => void fetchPage()}
      onRefresh={() => void fetchPage()}
      emptyTitle={t("agentStock.history.empty")}
      getRowId={(row) => row.id}
    />
  );
}
