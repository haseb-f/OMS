"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inventoryService,
  type InventoryValuationMethod,
  type StockCard,
} from "@/services/inventory-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import { InventoryStockGridCard } from "@/config/inventory/inventory-grid-cards";
import { canViewInventoryCost, omitInventoryCostColumns } from "@/config/inventory/cost-visibility";
import { PermissionGate } from "@/components/shared/permission-gate";
import { SelectFilter } from "@/components/shared/data-table";
import { useUserContext } from "@/providers/user-context";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import {
  STOCK_OWNER_FILTERS,
  companyStockValueTotal,
  stockOwnerLabel,
  stockOwnerQuery,
} from "@/config/inventory/stock-owner";

// TASK-057 — FIFO is a real enum value but no costing logic implements it
// anywhere (InventoryValuationService only computes moving-average cost);
// offering it here would let a user select a method that silently does
// nothing. Only list methods that are actually computed.
const VALUATION_METHODS: InventoryValuationMethod[] = ["AVERAGE_COST"];

/**
 * R15 (D15-4) — the API splits what is owned but not sellable: goods with
 * the carrier (goods-in-transit warehouse) and damaged goods. `available`
 * already excludes both.
 */
type StockCardRow = StockCard & { inTransit?: number; damaged?: number };

function formatCost(value: number | null) {
  return value === null ? "—" : formatAmount(value);
}

function InventoryStockPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  // The API enforces `settings.manage` on the company-wide costing method (SEC-03).
  const canManageValuation = hasPermission("settings.manage");
  // Valuation data: shown only with a costing permission (the API enforces the same rule).
  const canViewCost = canViewInventoryCost(hasPermission);
  const [rows, setRows] = useState<StockCardRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [valuationMethod, setValuationMethod] = useState<InventoryValuationMethod | null>(null);
  const [isSavingValuation, setIsSavingValuation] = useState(false);
  // R13 — company stock, agent stock, or both (the owner is shown on every row).
  const [ownerFilter, setOwnerFilter] = usePathRestorableState("owner", "");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [items, settings] = await Promise.all([
        inventoryService.getStockCards(stockOwnerQuery(ownerFilter)),
        inventoryService.getValuationSettings().catch(() => null),
      ]);
      setRows(items);
      if (settings) setValuationMethod(settings.valuationMethod);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [ownerFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changeValuationMethod = async (value: InventoryValuationMethod) => {
    setIsSavingValuation(true);
    try {
      const settings = await inventoryService.updateValuationSettings(value);
      setValuationMethod(settings.valuationMethod);
      toast.success(t("common.saved"));
    } catch (error) {
      reportApiError(error, "errors.updateFailed");
    } finally {
      setIsSavingValuation(false);
    }
  };

  const allColumns = useMemo<ColumnDef<StockCardRow, unknown>[]>(
    () => [
      {
        id: "productName",
        header: t("masterData.fields.name"),
        meta: { titleKey: "masterData.fields.name", stacked: true, type: "name" },
        accessorFn: (row) => row.productName,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.productName}
            secondary={
              row.original.sku ? (
                <SemanticValue kind="id">{row.original.sku}</SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      {
        id: "sku",
        header: t("masterData.fields.code"),
        meta: { titleKey: "masterData.fields.code", defaultHidden: true },
        accessorFn: (row) => row.sku,
        cell: (info) => <SemanticValue kind="id">{info.getValue() as string}</SemanticValue>,
      },
      {
        id: "owner",
        header: t("inventory.owner.label"),
        meta: { titleKey: "inventory.owner.label" },
        accessorFn: (row) =>
          stockOwnerLabel(row, {
            company: t("inventory.owner.COMPANY"),
            unknownAgent: t("inventory.owner.unknownAgent"),
          }),
      },
      {
        id: "available",
        header: t("inventory.fields.available"),
        meta: { titleKey: "inventory.fields.available", stacked: true, type: "number" },
        accessorFn: (row) => row.available,
        cell: ({ row }) => (
          <StackedCell
            primary={<span className="font-semibold">{row.original.available}</span>}
            secondary={`${row.original.onHand} / ${row.original.reserved}`}
          />
        ),
      },
      {
        id: "onHand",
        header: t("inventory.fields.onHand"),
        meta: { titleKey: "inventory.fields.onHand", defaultHidden: true, type: "quantity" },
        accessorFn: (row) => row.onHand,
      },
      {
        id: "reserved",
        header: t("inventory.fields.reserved"),
        meta: { titleKey: "inventory.fields.reserved", defaultHidden: true, type: "quantity" },
        accessorFn: (row) => row.reserved,
      },
      {
        id: "inTransit",
        header: t("storeOrderStock.inventory.inTransit"),
        meta: { titleKey: "storeOrderStock.inventory.inTransit", type: "quantity" },
        accessorFn: (row) => row.inTransit ?? 0,
      },
      {
        id: "damaged",
        header: t("storeOrderStock.inventory.damaged"),
        meta: {
          titleKey: "storeOrderStock.inventory.damaged",
          defaultHidden: true,
          type: "quantity",
        },
        accessorFn: (row) => row.damaged ?? 0,
      },
      {
        id: "stockValue",
        header: t("inventory.fields.stockValue"),
        meta: { titleKey: "inventory.fields.stockValue", type: "money" },
        accessorFn: (row) => formatCost(row.stockValue),
        cell: ({ row }) =>
          row.original.stockValue === null ? "—" : <MoneyValue value={row.original.stockValue} />,
      },
      {
        id: "averageCost",
        header: t("inventory.fields.averageCost"),
        meta: { titleKey: "inventory.fields.averageCost", defaultHidden: true, type: "money" },
        accessorFn: (row) => formatCost(row.averageCost),
      },
      {
        id: "lastCost",
        header: t("inventory.fields.lastCost"),
        meta: { titleKey: "inventory.fields.lastCost", defaultHidden: true, type: "money" },
        accessorFn: (row) => formatCost(row.lastCost),
      },
      {
        id: "lastMovement",
        header: t("inventory.fields.lastMovement"),
        meta: { titleKey: "inventory.fields.lastMovement", defaultHidden: true },
        accessorFn: (row) =>
          row.lastMovement
            ? `${row.lastMovement.movementNumber} — ${formatDate(row.lastMovement.createdAt)}`
            : "—",
      },
    ],
    [t],
  );
  // Cost columns (and their export columns) exist only for a caller who may see valuation data.
  const columns = useMemo(
    () => omitInventoryCostColumns(allColumns, canViewCost),
    [allColumns, canViewCost],
  );
  // Valuation total = company-owned stock only (agent stock is never a company asset).
  const companyValue = useMemo(
    () => (canViewCost ? companyStockValueTotal(rows) : null),
    [rows, canViewCost],
  );

  return (
    <PageWorkspace
      title={t("nav.inventoryStock")}
      description={t("inventory.stock.description")}
      dense
    >
      <EnterpriseCard size="sm">
        <EnterpriseCardHeader>
          <EnterpriseCardTitle>{t("inventory.valuationMethod.title")}</EnterpriseCardTitle>
        </EnterpriseCardHeader>
        <EnterpriseCardContent>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption text-muted-foreground">
              {t("inventory.valuationMethod.description")}
            </p>
            <Select
              value={valuationMethod ?? undefined}
              onValueChange={(value) => changeValuationMethod(value as InventoryValuationMethod)}
              disabled={isSavingValuation || valuationMethod === null || !canManageValuation}
            >
              <SelectTrigger aria-label={t("inventory.valuationMethod.title")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUATION_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {t(`inventory.valuationMethod.${method}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </EnterpriseCardContent>
      </EnterpriseCard>

      <EnterpriseDataTable
        filterBar={
          <SelectFilter
            label={t("inventory.owner.label")}
            value={ownerFilter}
            onChange={setOwnerFilter}
            allLabel={t("inventory.owner.all")}
            options={STOCK_OWNER_FILTERS.map((value) => ({
              value,
              label: t(`inventory.owner.${value}`),
            }))}
          />
        }
        activeFilterCount={ownerFilter ? 1 : 0}
        onClearFilters={ownerFilter ? () => setOwnerFilter("") : undefined}
        footerRow={
          companyValue !== null
            ? {
                productName: t("inventory.stock.companyValueTotal"),
                stockValue: <MoneyValue value={companyValue} />,
              }
            : undefined
        }
        tableId="inventory-stock"
        printTitle={t("nav.inventoryStock")}
        columns={columns}
        data={rows}
        getRowId={(row) => row.productId}
        renderGridCard={({ row }) => <InventoryStockGridCard row={row} />}
        isLoading={isLoading}
        exportColumns={exportColumnsFromKeys(
          columns,
          columns.map((column) => column.id!),
          t,
        )}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            rows.map((row) =>
              Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row, t)])),
            ),
            keys,
            "inventory-stock.csv",
            labels,
          )
        }
      />
      {canViewCost ? (
        <p className="text-caption text-muted-foreground">
          {t("inventory.stock.companyValueNote")}
        </p>
      ) : null}
    </PageWorkspace>
  );
}

export default function InventoryStockPage() {
  return (
    <PermissionGate permission="inventory.view">
      <InventoryStockPageContent />
    </PermissionGate>
  );
}
