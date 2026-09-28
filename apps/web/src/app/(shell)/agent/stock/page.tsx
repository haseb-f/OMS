"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { localizedName } from "@/config/agent-portal/labels";
import {
  agentPortalService,
  type PortalStock,
  type PortalStockRow,
} from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage } from "@/lib/toast";
import { formatNumber } from "@/lib/format-number";

const QUANTITY_KEYS = ["onHand", "reserved", "available", "shipped", "returned"] as const;
const EXPORT_KEYS = ["product", "warehouse", ...QUANTITY_KEYS];

function ProductCell({ row }: { row: PortalStockRow }) {
  const { locale } = useLocale();
  return (
    <StackedCell
      primary={localizedName(row.product, locale)}
      secondary={<SemanticValue kind="id">{row.product.sku}</SemanticValue>}
    />
  );
}

function WarehouseCell({ row }: { row: PortalStockRow }) {
  const { t } = useLocale();
  return row.warehouse ? (
    <>{row.warehouse.name}</>
  ) : (
    <span className="text-muted-foreground">{t("agentPortal.stock.noWarehouse")}</span>
  );
}

function buildStockColumns(): ColumnDef<PortalStockRow, unknown>[] {
  return [
    {
      id: "product",
      meta: {
        titleKey: "agentPortal.stock.fields.product",
        type: "name",
        stacked: true,
        importance: "critical",
      },
      accessorFn: (row) => `${row.product.name} ${row.product.sku}`,
      cell: ({ row }) => <ProductCell row={row.original} />,
    },
    {
      id: "warehouse",
      meta: { titleKey: "agentPortal.stock.fields.warehouse", importance: "high" },
      accessorFn: (row) => row.warehouse?.name ?? "",
      cell: ({ row }) => <WarehouseCell row={row.original} />,
    },
    ...QUANTITY_KEYS.map((key): ColumnDef<PortalStockRow, unknown> => ({
      id: key,
      meta: {
        titleKey: `agentPortal.stock.fields.${key}`,
        type: "quantity",
        importance: key === "available" || key === "onHand" ? "critical" : "medium",
      },
      accessorFn: (row) => row[key],
      cell: ({ row }) => <span className="num">{formatNumber(row.original[key])}</span>,
    })),
  ];
}

/** Agent stock held by the company (spec §4): on-hand / reserved / available / shipped / returned. */
export default function AgentStockPage() {
  const { t, locale } = useLocale();
  const [stock, setStock] = useState<PortalStock | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setStock(await agentPortalService.stock());
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildStockColumns(), []);
  const totals = stock?.totals;
  const footerRow = totals
    ? {
        product: <span className="font-semibold">{t("agentPortal.stock.totals")}</span>,
        ...Object.fromEntries(
          QUANTITY_KEYS.map((key) => [
            key,
            <span key={key} className="num font-semibold">
              {formatNumber(totals[key])}
            </span>,
          ]),
        ),
      }
    : undefined;

  return (
    <PageWorkspace
      dense
      title={t("agentPortal.stock.title")}
      description={t("agentPortal.stock.description")}
    >
      <EnterpriseDataTable
        tableId="agent-portal-stock"
        printTitle={t("agentPortal.stock.title")}
        columns={columns}
        data={stock?.items ?? []}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        footerRow={footerRow}
        exportColumns={exportColumnsFromKeys(columns, EXPORT_KEYS, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            (stock?.items ?? []).map((row) => ({
              product: `${localizedName(row.product, locale)} (${row.product.sku})`,
              warehouse: row.warehouse?.name ?? "",
              onHand: row.onHand,
              reserved: row.reserved,
              available: row.available,
              shipped: row.shipped,
              returned: row.returned,
            })),
            keys,
            "agent-stock.csv",
            labels,
          )
        }
        emptyTitle={t("agentPortal.stock.empty")}
        getRowId={(row) => `${row.productId}:${row.warehouseId ?? "none"}`}
      />
    </PageWorkspace>
  );
}
