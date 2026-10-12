"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { ErrorState } from "@/components/shared/error-state";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseButton } from "@/components/ui/button";
import type { ColumnDef } from "@tanstack/react-table";
import {
  agentsService,
  type AgentStockResult,
  type AgentStockRow,
} from "@/services/agents-service";
import { agentStockService } from "@/services/agent-stock-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { AgentStockReceiptDialog } from "./agent-stock-receipt-dialog";
import { AgentStockReceiptsTable } from "./agent-stock-receipts-table";
import { AgentStockMovementsTable, INTERNAL_DOCUMENT_LINKS } from "./agent-stock-movements-table";

const QUANTITY_KEYS = [
  "onHand",
  "reserved",
  "available",
  "inTransit",
  "delivered",
  "returned",
] as const;
type QuantityKey = (typeof QUANTITY_KEYS)[number];
const IMPORTANCE: Record<QuantityKey, "critical" | "high" | "medium" | "low"> = {
  onHand: "critical",
  reserved: "medium",
  available: "high",
  inTransit: "medium",
  delivered: "low",
  returned: "low",
};

const quantity = (value: number) => <SemanticValue kind="number">{value}</SemanticValue>;

function buildStockColumns(): ColumnDef<AgentStockRow, unknown>[] {
  return [
    {
      id: "product",
      meta: {
        titleKey: "agents.stock.product",
        stacked: true,
        type: "name",
        importance: "critical",
        minWidth: 180,
        grow: 2,
      },
      enableSorting: false,
      accessorFn: (row) => `${row.product.name} ${row.product.sku ?? ""}`,
      cell: ({ row }) => (
        <StackedCell
          primary={
            <Link href={`/products/${row.original.productId}`} className="hover:underline">
              {row.original.product.name}
            </Link>
          }
          secondary={
            row.original.product.sku ? (
              <SemanticValue kind="id">{row.original.product.sku}</SemanticValue>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "warehouse",
      meta: { titleKey: "agents.stock.warehouse", importance: "high", minWidth: 120 },
      enableSorting: false,
      accessorFn: (row) => row.warehouse?.name ?? "",
      cell: ({ row }) => row.original.warehouse?.name ?? <StockPlaceholder />,
    },
    ...QUANTITY_KEYS.map((id): ColumnDef<AgentStockRow, unknown> => ({
      id,
      meta: {
        titleKey: `agents.stock.${id}` as MessageKey,
        type: "quantity",
        importance: IMPORTANCE[id],
      },
      enableSorting: false,
      accessorFn: (row) => row[id],
      cell: ({ row }) => quantity(row.original[id]),
    })),
  ];
}

function StockPlaceholder() {
  const { t } = useLocale();
  return <span className="text-muted-foreground">{t("agents.stock.noWarehouse")}</span>;
}

/**
 * Agent page "Products & stock" tab (R18 B): the agent's consignment stock
 * (physical quantities only — never company value), its custody receipts and
 * the movement history linked to receipts, orders, transit and returns.
 */
export function AgentStockTab({ agentId, agentLabel }: { agentId: string; agentLabel: string }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canReceive = hasPermission("inventory.movements.create");
  const [stock, setStock] = useState<AgentStockResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStock(await agentsService.stock(agentId));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, reloadKey]);

  const columns = useMemo(() => buildStockColumns(), []);
  const loadMovements = useCallback(
    (params: { page: number; pageSize: number }) => agentStockService.movements(agentId, params),
    [agentId],
  );

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!stock) return null;

  return (
    <div className="flex flex-col gap-3">
      <DetailSection
        title={t("agents.stock.stockTitle")}
        actions={
          canReceive ? (
            <EnterpriseButton type="button" size="sm" onClick={() => setReceiveOpen(true)}>
              <PackagePlus />
              {t("agents.stock.receive")}
            </EnterpriseButton>
          ) : null
        }
      >
        <p className="text-caption text-muted-foreground">{t("agents.stock.receiveDescription")}</p>
        <EnterpriseDataTable
          tableId="agent-stock"
          printTitle={`${t("agents.stock.stockTitle")} — ${agentLabel}`}
          columns={columns}
          data={stock.items}
          getRowId={(row) => `${row.productId}:${row.warehouseId ?? "none"}`}
          onRefresh={() => void load()}
          emptyTitle={t("agents.stock.stockEmpty")}
          footerRow={{
            product: t("agents.stock.total"),
            ...Object.fromEntries(QUANTITY_KEYS.map((key) => [key, quantity(stock.totals[key])])),
          }}
        />
      </DetailSection>

      <DetailSection title={t("agents.stock.receipts")}>
        <AgentStockReceiptsTable
          agentId={agentId}
          printTitle={`${t("agentStock.receipts.title")} — ${agentLabel}`}
          reloadKey={reloadKey}
        />
      </DetailSection>

      <DetailSection title={t("agentStock.history.title")}>
        <AgentStockMovementsTable
          tableId="agent-stock-movements"
          printTitle={`${t("agentStock.history.title")} — ${agentLabel}`}
          load={loadMovements}
          links={INTERNAL_DOCUMENT_LINKS}
          reloadKey={reloadKey}
        />
      </DetailSection>

      {receiveOpen ? (
        <AgentStockReceiptDialog
          agent={{ id: agentId, label: agentLabel }}
          onOpenChange={setReceiveOpen}
          onReceived={() => setReloadKey((key) => key + 1)}
        />
      ) : null}
    </div>
  );
}
