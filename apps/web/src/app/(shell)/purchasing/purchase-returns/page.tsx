"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { SupplierPicker } from "@/components/business/supplier-picker";
import { SalesListBulkActions } from "@/components/sales";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  purchaseReturnsService,
  type PurchaseReturnRow,
} from "@/services/purchase-returns-service";
import type { PurchaseDocumentStatusValue } from "@/services/purchase-quotations-service";
import type { SupplierRow } from "@/services/suppliers-service";
import { usersService } from "@/services/users-service";
import { buildReturnColumns, returnExportColumns } from "@/config/purchasing/return-columns";
import {
  RETURN_ARCHIVABLE_STATUSES,
  RETURN_FILTERABLE_STATUSES,
  RETURN_STATUS_LABEL_KEY,
} from "@/config/purchasing/return-status";
import { buildReturnPrintPayload } from "@/config/purchasing/return-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { siteConfig } from "@/config/site";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

/** Mirrors `sales/quotations/page.tsx`. */
function PurchaseReturnsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<PurchaseReturnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [supplierFilter, setSupplierFilter] = useState<SupplierRow | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [usersById, setUsersById] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<PurchaseReturnRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PurchaseReturnRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  useEffect(() => {
    usersService
      .list()
      .then((users) => setUsersById(Object.fromEntries(users.map((u) => [u.id, u.fullName]))))
      .catch(() => setUsersById({}));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await purchaseReturnsService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as PurchaseDocumentStatusValue | undefined,
        supplierId: supplierFilter?.id,
        dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
        dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load purchase returns.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, supplierFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toPrintRow = useCallback(
    (item: PurchaseReturnRow): Record<string, string> => ({
      returnNumber: item.returnNumber,
      supplier: item.supplier?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(RETURN_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handlePrintRow = async (row: PurchaseReturnRow) => {
    try {
      const full = await purchaseReturnsService.get(row.id);
      printDocument(
        buildReturnPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print purchase return.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await purchaseReturnsService.cancel(cancelTarget.id);
      toast.success(t("purchasing.returns.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel purchase return.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await purchaseReturnsService.archive(archiveTarget.id);
      toast.success(t("purchasing.returns.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive purchase return.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const returnColumns = useMemo(
    () =>
      buildReturnColumns({
        usersById,
        onView: (row) => router.push(`/purchasing/purchase-returns/${row.id}`),
        onPrint: handlePrintRow,
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, usersById, activeCompany, user],
  );

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    RETURN_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("purchasing.returns.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(returnColumns, returnExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      returnExportColumns,
      "purchase-returns-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await purchaseReturnsService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("purchasing.returns.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("purchasing.returns.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("purchasing.returns.title")}
        subtitle={t("purchasing.returns.description")}
        actions={<ModuleImportButtons importType="PURCHASE_RETURNS" onImported={load} />}
        filters={
          <>
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) => {
                setStatusFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("purchasing.returns.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("purchasing.returns.filters.allStatuses")}
                </SelectItem>
                {RETURN_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(RETURN_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <SupplierPicker
                value={supplierFilter}
                onChange={(supplier) => {
                  setSupplierFilter(supplier);
                  setPage(1);
                }}
              />
              {supplierFilter && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("purchasing.returns.filters.allSuppliers")}
                  onClick={() => {
                    setSupplierFilter(null);
                    setPage(1);
                  }}
                >
                  <X className="size-3.5" />
                </EnterpriseButton>
              )}
            </div>
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
          </>
        }
      />

      <EnterpriseDataTable
        tableId="purchasing-returns"
        printTitle={t("purchasing.returns.title")}
        columns={returnColumns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(nextSortBy, nextSortOrder) => {
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        bulkActions={
          <SalesListBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            onArchive={() => setBulkArchiveOpen(true)}
            archiveDisabled={selectedArchivable.length === 0}
            labels={{
              print: t("table.print"),
              export: t("table.export"),
              archive: t("common.archive"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(returnColumns, returnExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "purchase-returns.csv",
          )
        }
        emptyTitle={t("purchasing.returns.empty")}
        getRowId={(row) => row.id}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("purchasing.returns.confirmCancelTitle")}
        description={t("purchasing.returns.confirmCancelDescription")}
        confirmLabel={t("purchasing.returns.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("purchasing.returns.confirmArchiveTitle")}
        description={t("purchasing.returns.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("purchasing.returns.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("purchasing.returns.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </div>
  );
}

export default function PurchaseReturnsPage() {
  return (
    <PermissionGate permission="purchasing.returns.view">
      <PurchaseReturnsPageContent />
    </PermissionGate>
  );
}
