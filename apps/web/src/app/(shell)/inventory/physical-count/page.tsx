"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
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
import { CreateCountDialog } from "./create-count-dialog";
import { CountDetailDialog } from "./count-detail-dialog";
import { physicalCountService, type PhysicalCountListRow } from "@/services/physical-count-service";
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

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

const STATUS_TONE: Record<string, "success" | "neutral" | "warning"> = {
  DRAFT: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
};

function PhysicalCountPageContent() {
  const { t } = useLocale();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList } = usePrintEngine();
  const canCreate = hasPermission("inventory.physical-count.create");
  const [rows, setRows] = useState<PhysicalCountListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [openCountId, setOpenCountId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await physicalCountService.list());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo<ColumnDef<PhysicalCountListRow, unknown>[]>(
    () => [
      {
        id: "countNumber",
        header: t("inventory.physicalCount.countNumber"),
        meta: { titleKey: "inventory.physicalCount.countNumber" },
        accessorFn: (row) => row.countNumber,
        cell: (info) => (
          <button
            type="button"
            onClick={() => setOpenCountId(info.row.original.id)}
            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
            dir="ltr"
          >
            {info.getValue() as string}
          </button>
        ),
      },
      {
        id: "warehouse",
        header: t("masterData.fields.warehouse"),
        meta: { titleKey: "masterData.fields.warehouse" },
        accessorFn: (row) => `${row.warehouse.code} — ${row.warehouse.name}`,
      },
      {
        id: "status",
        header: t("common.status"),
        meta: { titleKey: "common.status" },
        accessorFn: (row) => row.status,
        cell: (info) => {
          const status = info.getValue() as string;
          return (
            <StatusBadge
              tone={STATUS_TONE[status]}
              label={t(`inventory.physicalCount.status.${status}` as MessageKey)}
            />
          );
        },
      },
      {
        id: "lines",
        header: t("inventory.physicalCount.lines"),
        meta: { titleKey: "inventory.physicalCount.lines" },
        accessorFn: (row) => row._count.lines,
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
  const toExportRow = (row: PhysicalCountListRow) =>
    Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row)]));

  const selectedRows = filteredRows.filter((row) => rowSelection[row.id]);

  const handleBulkPrint = () => {
    if (selectedRows.length === 0) return;
    printList({
      variant: "list",
      title: t("nav.inventoryPhysicalCount"),
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
      "physical-count-selected.csv",
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("nav.inventoryPhysicalCount")}
        subtitle={t("inventory.physicalCount.description")}
        actions={
          canCreate && (
            <EnterpriseButton type="button" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("inventory.physicalCount.createTitle")}
            </EnterpriseButton>
          )
        }
        filters={<EnterpriseDateRangePicker value={dateRange} onChange={setDateRange} />}
      />

      <EnterpriseDataTable
        tableId="inventory-physical-count"
        printTitle={t("nav.inventoryPhysicalCount")}
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
            "physical-count.csv",
          )
        }
      />

      <CreateCountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(count) => {
          load();
          setOpenCountId(count.id);
        }}
      />

      <CountDetailDialog
        countId={openCountId}
        onOpenChange={(open) => !open && setOpenCountId(null)}
        onChanged={load}
      />
    </div>
  );
}

export default function PhysicalCountPage() {
  return (
    <PermissionGate permission="inventory.view">
      <PhysicalCountPageContent />
    </PermissionGate>
  );
}
