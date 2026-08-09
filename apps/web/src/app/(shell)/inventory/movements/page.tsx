"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, Plus, X } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { getColumnDisplayValue } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { SalesListBulkActions } from "@/components/sales";
import { ProductPicker } from "@/components/business/product-picker";
import { WarehousePicker } from "@/components/business/warehouse-picker";
import { OpeningInventoryDialog } from "./opening-inventory-dialog";
import { AdjustmentDialog } from "./adjustment-dialog";
import { TransferDialog } from "./transfer-dialog";
import { inventoryService, type InventoryMovementRow } from "@/services/inventory-service";
import type { ProductRow } from "@/services/products-service";
import type { WarehouseRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { useCompany } from "@/providers/company-provider";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import { siteConfig } from "@/config/site";
import type { MessageKey } from "@/i18n/translate";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

const POSITIVE_TYPES = new Set([
  "OPENING_BALANCE",
  "PURCHASE_RECEIPT",
  "SALES_RETURN",
  "PRODUCTION_OUTPUT",
  "ASSEMBLY",
]);

const MOVEMENT_TYPES = [
  "OPENING_BALANCE",
  "ADJUSTMENT",
  "TRANSFER",
  "RESERVATION",
  "RESERVATION_RELEASE",
  "DAMAGE",
  "EXPIRED",
  "ASSEMBLY",
  "DISASSEMBLY",
  "PRODUCTION",
  "PURCHASE_RECEIPT",
  "PURCHASE_RETURN",
  "SALES_DELIVERY",
  "SALES_RETURN",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "PHYSICAL_COUNT",
] as const;

function InventoryMovementsPageContent() {
  const { t } = useLocale();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList } = usePrintEngine();
  const canCreate = hasPermission("inventory.movements.create");
  const [rows, setRows] = useState<InventoryMovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [productFilter, setProductFilter] = useState<ProductRow | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState<WarehouseRow | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await inventoryService.getMovements({
        productId: productFilter?.id,
        warehouseId: warehouseFilter?.id,
        type: typeFilter || undefined,
      });
      setRows(items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load movements.");
    } finally {
      setIsLoading(false);
    }
  }, [productFilter, warehouseFilter, typeFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<InventoryMovementRow, unknown>[]>(
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
        accessorFn: (row) => row.type,
        cell: (info) => {
          const type = info.getValue() as string;
          return (
            <StatusBadge
              tone={POSITIVE_TYPES.has(type) ? "success" : "neutral"}
              label={t(`inventory.movementType.${type}` as MessageKey)}
            />
          );
        },
      },
      {
        id: "product",
        header: t("inventory.fields.product"),
        meta: { titleKey: "inventory.fields.product" },
        accessorFn: (row) => row.product?.displayName || row.product?.name || row.productId,
        cell: (info) => info.getValue() as string,
      },
      {
        id: "warehouse",
        header: t("masterData.fields.warehouse"),
        meta: { titleKey: "masterData.fields.warehouse" },
        accessorFn: (row) =>
          row.warehouse ? `${row.warehouse.code} — ${row.warehouse.name}` : row.warehouseId,
        cell: (info) => info.getValue() as string,
      },
      {
        id: "reference",
        header: t("inventory.fields.reference"),
        meta: { titleKey: "inventory.fields.reference" },
        accessorFn: (row) => row.referenceType ?? "",
        cell: (info) => {
          const row = info.row.original;
          return row.referenceType ? (
            <span dir="ltr" className="text-caption text-muted-foreground">
              {row.referenceType}
            </span>
          ) : (
            "—"
          );
        },
      },
      {
        id: "quantity",
        header: t("inventory.fields.quantity"),
        meta: { titleKey: "inventory.fields.quantity" },
        accessorFn: (row) => row.quantity,
        cell: (info) => {
          const value = info.getValue() as number;
          return (
            <span className={value < 0 ? "text-destructive" : "text-success"}>
              {value > 0 ? `+${value}` : value}
            </span>
          );
        },
      },
      {
        id: "quantityBefore",
        header: t("products.stockMovements.before"),
        meta: { titleKey: "products.stockMovements.before" },
        accessorFn: (row) => row.quantityBefore,
        cell: (info) => info.getValue() as number,
      },
      {
        id: "quantityAfter",
        header: t("inventory.fields.balanceAfter"),
        meta: { titleKey: "inventory.fields.balanceAfter" },
        accessorFn: (row) => row.quantityAfter,
        cell: (info) => info.getValue() as number,
      },
      {
        id: "unitCost",
        header: t("products.stockMovements.cost"),
        meta: { titleKey: "products.stockMovements.cost" },
        accessorFn: (row) => row.unitCost ?? "",
        cell: (info) => {
          const row = info.row.original;
          return row.unitCost != null ? (
            <span dir="ltr">{Number(row.unitCost).toLocaleString()}</span>
          ) : (
            "—"
          );
        },
      },
      {
        id: "runningCost",
        header: t("inventory.fields.runningCost"),
        meta: { titleKey: "inventory.fields.runningCost" },
        accessorFn: (row) => (row.unitCost != null ? row.unitCost * row.quantityAfter : ""),
        cell: (info) => {
          const row = info.row.original;
          return row.unitCost != null ? (
            <span dir="ltr">{(Number(row.unitCost) * row.quantityAfter).toLocaleString()}</span>
          ) : (
            "—"
          );
        },
      },
      {
        id: "costCenter",
        header: t("products.fields.costCenter"),
        meta: { titleKey: "products.fields.costCenter" },
        accessorFn: (row) => row.product?.analyticAccount?.name ?? "",
        cell: (info) => (info.getValue() as string) || "—",
      },
      {
        id: "createdByUser",
        header: t("products.fields.createdBy"),
        meta: { titleKey: "products.fields.createdBy" },
        accessorFn: (row) => row.createdByUser?.fullName ?? "",
        cell: (info) => (info.getValue() as string) || "—",
      },
      {
        id: "createdAt",
        header: t("inventory.fields.date"),
        meta: { titleKey: "inventory.fields.date" },
        accessorFn: (row) => formatDateTime(row.createdAt),
        cell: (info) => info.getValue() as string,
      },
    ],
    [t],
  );

  const filteredRows = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return rows;
    return rows.filter((row) => {
      const createdAt = new Date(row.createdAt);
      if (dateRange.from && createdAt < dateRange.from) return false;
      if (dateRange.to) {
        const endOfDay = new Date(dateRange.to);
        endOfDay.setHours(23, 59, 59, 999);
        if (createdAt > endOfDay) return false;
      }
      return true;
    });
  }, [rows, dateRange]);

  const exportKeys = columns.map((column) => column.id!);
  const toExportRow = (row: InventoryMovementRow) =>
    Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row)]));

  const selectedRows = filteredRows.filter((row) => rowSelection[row.id]);

  const handleBulkPrint = () => {
    if (selectedRows.length === 0) return;
    printList({
      variant: "list",
      title: t("nav.inventoryMovements"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(columns, exportKeys, t),
      rows: selectedRows.map((row) => toExportRow(row)),
    });
  };

  const handleBulkExport = () => {
    if (selectedRows.length === 0) return;
    exportRowsToCsv(
      selectedRows.map((row) => toExportRow(row)) as unknown as Record<string, unknown>[],
      exportKeys,
      "inventory-movements-selected.csv",
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.inventoryMovements")}
        subtitle={t("inventory.movements.description")}
        actions={
          <>
            <ModuleImportButtons importType="OPENING_STOCK" onImported={load} />
            <ModuleImportButtons importType="INVENTORY_ADJUSTMENTS" onImported={load} />
            {canCreate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <EnterpriseButton type="button">
                    <Plus />
                    {t("inventory.createMovement.title")}
                    <ChevronDown className="size-3.5" />
                  </EnterpriseButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setOpeningOpen(true)}>
                    {t("inventory.openingInventory.title")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAdjustmentOpen(true)}>
                    {t("inventory.adjustment.title")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTransferOpen(true)}>
                    {t("inventory.transfer.title")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        filters={
          <>
            <div className="flex items-center gap-1">
              <ProductPicker value={productFilter} onChange={setProductFilter} />
              {productFilter && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("datePicker.clear")}
                  onClick={() => setProductFilter(null)}
                >
                  <X className="size-3.5" />
                </EnterpriseButton>
              )}
            </div>
            <div className="flex items-center gap-1">
              <WarehousePicker value={warehouseFilter} onChange={setWarehouseFilter} />
              {warehouseFilter && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("datePicker.clear")}
                  onClick={() => setWarehouseFilter(null)}
                >
                  <X className="size-3.5" />
                </EnterpriseButton>
              )}
            </div>
            <Select
              value={typeFilter || "__all__"}
              onValueChange={(v) => setTypeFilter(v === "__all__" ? "" : v)}
            >
              <SelectTrigger size="sm" className="w-44">
                <SelectValue placeholder={t("inventory.fields.type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("inventory.filters.allTypes")}</SelectItem>
                {MOVEMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`inventory.movementType.${type}` as MessageKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <EnterpriseDateRangePicker value={dateRange} onChange={setDateRange} />
          </>
        }
      />

      <EnterpriseDataTable
        tableId="inventory-movements"
        printTitle={t("nav.inventoryMovements")}
        columns={columns}
        data={filteredRows}
        isLoading={isLoading}
        getRowId={(row) => row.id}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={
          <SalesListBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            labels={{
              print: t("table.print"),
              export: t("table.export"),
              archive: t("common.archive"),
            }}
          />
        }
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys) =>
          exportRowsToCsv(
            filteredRows.map((row) => toExportRow(row)),
            keys,
            "inventory-movements.csv",
          )
        }
      />

      <OpeningInventoryDialog open={openingOpen} onOpenChange={setOpeningOpen} onCreated={load} />
      <AdjustmentDialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen} onCreated={load} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} onCreated={load} />
    </div>
  );
}

export default function InventoryMovementsPage() {
  return (
    <PermissionGate permission="inventory.view">
      <InventoryMovementsPageContent />
    </PermissionGate>
  );
}
