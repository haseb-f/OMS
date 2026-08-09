"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  inventoryService,
  type InventoryMovementRow,
  type StockCard,
  type WarehouseBalanceRow,
} from "@/services/inventory-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import { PermissionGate } from "@/components/shared/permission-gate";

function formatMoney(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shared CSV-export wiring for every tab on this page — builds display-value rows straight from each tab's own `accessorFn`, never a second hand-written mapping. */
function toExportRows<TRow>(
  columns: ColumnDef<TRow, unknown>[],
  rows: TRow[],
): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column.id!, getColumnDisplayValue(column, row)])),
  );
}

/**
 * TASK-029 — Inventory Reports: five report views over the same real data
 * already computed by the Inventory module (movement ledger, stock cards,
 * warehouse balances). Nothing here calculates a new figure — each tab is a
 * filtered/re-columned read of data the operational Inventory pages already
 * expose.
 */
function ReportsInventoryPageContent() {
  const { t } = useLocale();
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [stockCards, setStockCards] = useState<StockCard[]>([]);
  const [warehouseBalances, setWarehouseBalances] = useState<WarehouseBalanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movementRange, setMovementRange] = useState<DateRangeValue>({ from: null, to: null });

  const load = () => {
    setIsLoading(true);
    Promise.all([
      inventoryService.getMovements(),
      inventoryService.getStockCards(),
      inventoryService.getWarehouseBalances(),
    ])
      .then(([movementRows, stockRows, balanceRows]) => {
        setMovements(movementRows);
        setStockCards(stockRows);
        setWarehouseBalances(balanceRows);
      })
      .catch((error) =>
        toast.error(error instanceof ApiError ? error.message : t("common.noResults")),
      )
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const negativeStock = useMemo(() => stockCards.filter((row) => row.onHand < 0), [stockCards]);

  const filteredMovements = useMemo(() => {
    if (!movementRange.from && !movementRange.to) return movements;
    return movements.filter((row) => {
      const createdAt = new Date(row.createdAt);
      if (movementRange.from && createdAt < movementRange.from) return false;
      if (movementRange.to) {
        const endOfDay = new Date(movementRange.to);
        endOfDay.setHours(23, 59, 59, 999);
        if (createdAt > endOfDay) return false;
      }
      return true;
    });
  }, [movements, movementRange]);

  const movementColumns = useMemo<ColumnDef<InventoryMovementRow, unknown>[]>(
    () => [
      {
        id: "movementNumber",
        header: t("inventory.fields.movementNumber"),
        meta: { titleKey: "inventory.fields.movementNumber" },
        accessorFn: (row) => row.movementNumber,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "type",
        header: t("inventory.fields.type"),
        meta: { titleKey: "inventory.fields.type" },
        accessorFn: (row) => t(`inventory.movementType.${row.type}` as MessageKey),
      },
      {
        id: "product",
        header: t("inventory.fields.product"),
        meta: { titleKey: "inventory.fields.product" },
        accessorFn: (row) => row.product?.displayName || row.product?.name || row.productId,
      },
      {
        id: "warehouse",
        header: t("masterData.fields.warehouse"),
        meta: { titleKey: "masterData.fields.warehouse" },
        accessorFn: (row) =>
          row.warehouse ? `${row.warehouse.code} — ${row.warehouse.name}` : row.warehouseId,
      },
      {
        id: "quantity",
        header: t("inventory.fields.quantity"),
        meta: { titleKey: "inventory.fields.quantity" },
        accessorFn: (row) => row.quantity,
      },
      {
        id: "createdAt",
        header: t("inventory.fields.date"),
        meta: { titleKey: "inventory.fields.date" },
        accessorFn: (row) => formatDateTime(row.createdAt),
      },
    ],
    [t],
  );

  const valuationColumns = useMemo<ColumnDef<StockCard, unknown>[]>(
    () => [
      {
        id: "sku",
        header: t("masterData.fields.code"),
        meta: { titleKey: "masterData.fields.code" },
        accessorFn: (row) => row.sku,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "productName",
        header: t("masterData.fields.name"),
        meta: { titleKey: "masterData.fields.name" },
        accessorFn: (row) => row.productName,
      },
      {
        id: "onHand",
        header: t("inventory.fields.onHand"),
        meta: { titleKey: "inventory.fields.onHand" },
        accessorFn: (row) => row.onHand,
      },
      {
        id: "averageCost",
        header: t("inventory.fields.averageCost"),
        meta: { titleKey: "inventory.fields.averageCost" },
        accessorFn: (row) => formatMoney(row.averageCost),
      },
      {
        id: "stockValue",
        header: t("inventory.fields.stockValue"),
        meta: { titleKey: "inventory.fields.stockValue" },
        accessorFn: (row) => formatMoney(row.stockValue),
      },
    ],
    [t],
  );

  const stockColumns = useMemo<ColumnDef<StockCard, unknown>[]>(
    () => [
      {
        id: "sku",
        header: t("masterData.fields.code"),
        meta: { titleKey: "masterData.fields.code" },
        accessorFn: (row) => row.sku,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "productName",
        header: t("masterData.fields.name"),
        meta: { titleKey: "masterData.fields.name" },
        accessorFn: (row) => row.productName,
      },
      {
        id: "onHand",
        header: t("inventory.fields.onHand"),
        meta: { titleKey: "inventory.fields.onHand" },
        accessorFn: (row) => row.onHand,
        cell: (info) => {
          const value = info.getValue() as number;
          return (
            <span className={value < 0 ? "text-destructive font-semibold" : undefined}>
              {value}
            </span>
          );
        },
      },
      {
        id: "reserved",
        header: t("inventory.fields.reserved"),
        meta: { titleKey: "inventory.fields.reserved" },
        accessorFn: (row) => row.reserved,
      },
      {
        id: "available",
        header: t("inventory.fields.available"),
        meta: { titleKey: "inventory.fields.available" },
        accessorFn: (row) => row.available,
      },
    ],
    [t],
  );

  const warehouseBalanceColumns = useMemo<ColumnDef<WarehouseBalanceRow, unknown>[]>(
    () => [
      {
        id: "warehouse",
        header: t("masterData.fields.warehouse"),
        meta: { titleKey: "masterData.fields.warehouse" },
        accessorFn: (row) =>
          row.warehouse ? `${row.warehouse.code} — ${row.warehouse.name}` : row.warehouseId,
      },
      {
        id: "sku",
        header: t("masterData.fields.code"),
        meta: { titleKey: "masterData.fields.code" },
        accessorFn: (row) => row.product?.sku ?? row.productId,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "productName",
        header: t("masterData.fields.name"),
        meta: { titleKey: "masterData.fields.name" },
        accessorFn: (row) => row.product?.displayName || row.product?.name || "",
      },
      {
        id: "onHand",
        header: t("inventory.fields.onHand"),
        meta: { titleKey: "inventory.fields.onHand" },
        accessorFn: (row) => row.onHand,
        cell: (info) => {
          const value = info.getValue() as number;
          return (
            <span className={value < 0 ? "text-destructive font-semibold" : undefined}>
              {value}
            </span>
          );
        },
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("nav.reportsInventory")} subtitle={t("reports.inventory.description")} />

      <Tabs defaultValue="movements">
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="movements">{t("reports.inventory.movements")}</TabsTrigger>
          <TabsTrigger value="valuation">{t("reports.inventory.valuation")}</TabsTrigger>
          <TabsTrigger value="stock">{t("reports.inventory.currentStock")}</TabsTrigger>
          <TabsTrigger value="negative">
            {t("reports.inventory.negativeStock")}
            {negativeStock.length > 0 && (
              <StatusBadge
                tone="destructive"
                label={String(negativeStock.length)}
                className="ms-1.5"
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="warehouseBalance">
            {t("reports.inventory.warehouseBalance")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="movements" className="flex flex-col gap-3">
          <div className="flex justify-end">
            <EnterpriseDateRangePicker value={movementRange} onChange={setMovementRange} />
          </div>
          <EnterpriseDataTable
            tableId="reports-inventory-movements"
            printTitle={t("reports.inventory.movements")}
            columns={movementColumns}
            data={filteredMovements}
            isLoading={isLoading}
            exportColumns={exportColumnsFromKeys(
              movementColumns,
              movementColumns.map((c) => c.id!),
              t,
            )}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(movementColumns, filteredMovements),
                keys,
                "inventory-movements-report.csv",
              )
            }
          />
        </TabsContent>
        <TabsContent value="valuation">
          <EnterpriseDataTable
            tableId="reports-inventory-valuation"
            printTitle={t("reports.inventory.valuation")}
            columns={valuationColumns}
            data={stockCards}
            getRowId={(row) => row.productId}
            isLoading={isLoading}
            exportColumns={exportColumnsFromKeys(
              valuationColumns,
              valuationColumns.map((c) => c.id!),
              t,
            )}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(valuationColumns, stockCards),
                keys,
                "inventory-valuation.csv",
              )
            }
          />
        </TabsContent>
        <TabsContent value="stock">
          <EnterpriseDataTable
            tableId="reports-inventory-stock"
            printTitle={t("reports.inventory.currentStock")}
            columns={stockColumns}
            data={stockCards}
            getRowId={(row) => row.productId}
            isLoading={isLoading}
            exportColumns={exportColumnsFromKeys(
              stockColumns,
              stockColumns.map((c) => c.id!),
              t,
            )}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(stockColumns, stockCards),
                keys,
                "inventory-current-stock.csv",
              )
            }
          />
        </TabsContent>
        <TabsContent value="negative">
          <EnterpriseDataTable
            tableId="reports-inventory-negative"
            printTitle={t("reports.inventory.negativeStock")}
            columns={stockColumns}
            data={negativeStock}
            getRowId={(row) => row.productId}
            isLoading={isLoading}
            emptyTitle={t("reports.inventory.negativeStockEmpty")}
            exportColumns={exportColumnsFromKeys(
              stockColumns,
              stockColumns.map((c) => c.id!),
              t,
            )}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(stockColumns, negativeStock),
                keys,
                "inventory-negative-stock.csv",
              )
            }
          />
        </TabsContent>
        <TabsContent value="warehouseBalance">
          <EnterpriseDataTable
            tableId="reports-inventory-warehouse-balance"
            printTitle={t("reports.inventory.warehouseBalance")}
            columns={warehouseBalanceColumns}
            data={warehouseBalances}
            getRowId={(row) => `${row.warehouseId}-${row.productId}`}
            isLoading={isLoading}
            exportColumns={exportColumnsFromKeys(
              warehouseBalanceColumns,
              warehouseBalanceColumns.map((c) => c.id!),
              t,
            )}
            onExport={(keys) =>
              exportRowsToCsv(
                toExportRows(warehouseBalanceColumns, warehouseBalances),
                keys,
                "inventory-warehouse-balance.csv",
              )
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ReportsInventoryPage() {
  return (
    <PermissionGate permission="reports.inventory.view">
      <ReportsInventoryPageContent />
    </PermissionGate>
  );
}
