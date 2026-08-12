"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus, X } from "lucide-react";
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
  purchaseQuotationsService,
  type PurchaseDocumentStatusValue,
  type PurchaseQuotationRow,
} from "@/services/purchase-quotations-service";
import type { SupplierRow } from "@/services/suppliers-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import {
  buildQuotationColumns,
  quotationExportColumns,
} from "@/config/purchasing/quotation-columns";
import {
  QUOTATION_ARCHIVABLE_STATUSES,
  QUOTATION_FILTERABLE_STATUSES,
  QUOTATION_STATUS_LABEL_KEY,
} from "@/config/purchasing/quotation-status";
import { buildQuotationPrintPayload } from "@/config/purchasing/quotation-print";
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

/** Mirrors `sales/quotations/page.tsx` (TASK-048). */
function PurchaseQuotationsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<PurchaseQuotationRow[]>([]);
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
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<PurchaseQuotationRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PurchaseQuotationRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await purchaseQuotationsService.list({
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load quotations.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, supplierFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("purchasing.quotations.create");

  const toPrintRow = useCallback(
    (item: PurchaseQuotationRow): Record<string, string> => ({
      quotationNumber: item.quotationNumber,
      supplier: item.supplier?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(QUOTATION_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: PurchaseQuotationRow) => {
    try {
      const created = await purchaseQuotationsService.create({
        supplierId: row.supplierId,
        currencyId: row.currencyId ?? undefined,
        purchaseType: row.purchaseType,
        referenceNumber: row.referenceNumber ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        supplierNotes: row.supplierNotes ?? undefined,
        items: row.items.map((item) => ({
          productId: item.productId,
          description: item.description ?? undefined,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          discountValue: Number(item.discountValue),
          taxId: item.taxId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("purchasing.quotations.toasts.duplicated"));
      router.push(`/purchasing/purchase-quotations/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to duplicate quotation.");
    }
  };

  const handlePrintRow = async (row: PurchaseQuotationRow) => {
    try {
      const full = await purchaseQuotationsService.get(row.id);
      printDocument(
        buildQuotationPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print quotation.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await purchaseQuotationsService.cancel(cancelTarget.id);
      toast.success(t("purchasing.quotations.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel quotation.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await purchaseQuotationsService.archive(archiveTarget.id);
      toast.success(t("purchasing.quotations.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive quotation.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const quotationColumns = useMemo(
    () =>
      buildQuotationColumns({
        usersById,
        onView: (row) => router.push(`/purchasing/purchase-quotations/${row.id}`),
        onDuplicate: handleDuplicate,
        onPrint: handlePrintRow,
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, usersById, activeCompany, user],
  );

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    QUOTATION_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("purchasing.quotations.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(quotationColumns, quotationExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      quotationExportColumns,
      "purchase-quotations-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await purchaseQuotationsService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("purchasing.quotations.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("purchasing.quotations.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("purchasing.quotations.title")}
        subtitle={t("purchasing.quotations.description")}
        actions={
          <>
            <ModuleImportButtons importType="PURCHASE_QUOTATIONS" onImported={load} />
            {canCreate && (
              <EnterpriseButton
                type="button"
                onClick={() => router.push("/purchasing/purchase-quotations/new")}
              >
                <Plus />
                {t("purchasing.quotations.addNew")}
              </EnterpriseButton>
            )}
          </>
        }
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
                <SelectValue placeholder={t("purchasing.quotations.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("purchasing.quotations.filters.allStatuses")}
                </SelectItem>
                {QUOTATION_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(QUOTATION_STATUS_LABEL_KEY[status])}
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
                  aria-label={t("purchasing.quotations.filters.allSuppliers")}
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
        tableId="purchasing-quotations"
        printTitle={t("purchasing.quotations.title")}
        columns={quotationColumns}
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
        exportColumns={exportColumnsFromKeys(quotationColumns, quotationExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "purchase-quotations.csv",
          )
        }
        emptyTitle={t("purchasing.quotations.empty")}
        getRowId={(row) => row.id}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("purchasing.quotations.confirmCancelTitle")}
        description={t("purchasing.quotations.confirmCancelDescription")}
        confirmLabel={t("purchasing.quotations.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("purchasing.quotations.confirmArchiveTitle")}
        description={t("purchasing.quotations.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("purchasing.quotations.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("purchasing.quotations.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </div>
  );
}

export default function PurchaseQuotationsPage() {
  return (
    <PermissionGate permission="purchasing.quotations.view">
      <PurchaseQuotationsPageContent />
    </PermissionGate>
  );
}
