"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
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
  type StockCard as StockCardRow,
} from "@/services/inventory-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import { PermissionGate } from "@/components/shared/permission-gate";

// TASK-057 — FIFO is a real enum value but no costing logic implements it
// anywhere (InventoryValuationService only computes moving-average cost);
// offering it here would let a user select a method that silently does
// nothing. Only list methods that are actually computed.
const VALUATION_METHODS: InventoryValuationMethod[] = ["AVERAGE_COST"];

function formatMoney(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InventoryStockPageContent() {
  const { t } = useLocale();
  const [rows, setRows] = useState<StockCardRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [valuationMethod, setValuationMethod] = useState<InventoryValuationMethod | null>(null);
  const [isSavingValuation, setIsSavingValuation] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [items, settings] = await Promise.all([
        inventoryService.getStockCards(),
        inventoryService.getValuationSettings().catch(() => null),
      ]);
      setRows(items);
      if (settings) setValuationMethod(settings.valuationMethod);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load stock cards.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changeValuationMethod = async (value: InventoryValuationMethod) => {
    setIsSavingValuation(true);
    try {
      const settings = await inventoryService.updateValuationSettings(value);
      setValuationMethod(settings.valuationMethod);
      toast.success(t("common.save"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to update valuation method.");
    } finally {
      setIsSavingValuation(false);
    }
  };

  const columns = useMemo<ColumnDef<StockCardRow, unknown>[]>(
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
        cell: (info) => info.getValue() as string,
      },
      {
        id: "onHand",
        header: t("inventory.fields.onHand"),
        meta: { titleKey: "inventory.fields.onHand" },
        accessorFn: (row) => row.onHand,
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
        cell: (info) => <span className="font-semibold">{info.getValue() as number}</span>,
      },
      {
        id: "averageCost",
        header: t("inventory.fields.averageCost"),
        meta: { titleKey: "inventory.fields.averageCost" },
        accessorFn: (row) => formatMoney(row.averageCost),
      },
      {
        id: "lastCost",
        header: t("inventory.fields.lastCost"),
        meta: { titleKey: "inventory.fields.lastCost" },
        accessorFn: (row) => formatMoney(row.lastCost),
      },
      {
        id: "stockValue",
        header: t("inventory.fields.stockValue"),
        meta: { titleKey: "inventory.fields.stockValue" },
        accessorFn: (row) => formatMoney(row.stockValue),
      },
      {
        id: "lastMovement",
        header: t("inventory.fields.lastMovement"),
        meta: { titleKey: "inventory.fields.lastMovement" },
        accessorFn: (row) =>
          row.lastMovement
            ? `${row.lastMovement.movementNumber} — ${formatDate(row.lastMovement.createdAt)}`
            : "—",
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("nav.inventoryStock")} subtitle={t("inventory.stock.description")} />

      <EnterpriseCard size="sm" className="hover:translate-y-0 hover:shadow-sm">
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
              disabled={isSavingValuation || valuationMethod === null}
            >
              <SelectTrigger className="w-56">
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
        tableId="inventory-stock"
        printTitle={t("nav.inventoryStock")}
        columns={columns}
        data={rows}
        getRowId={(row) => row.productId}
        isLoading={isLoading}
        exportColumns={exportColumnsFromKeys(
          columns,
          columns.map((column) => column.id!),
          t,
        )}
        onExport={(keys) =>
          exportRowsToCsv(
            rows.map((row) =>
              Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row)])),
            ),
            keys,
            "inventory-stock.csv",
          )
        }
      />
    </div>
  );
}

export default function InventoryStockPage() {
  return (
    <PermissionGate permission="inventory.view">
      <InventoryStockPageContent />
    </PermissionGate>
  );
}
