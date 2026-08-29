"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { SalesListBulkActions } from "@/components/sales";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  MultiSelectFilter,
  MultiEntityFilter,
  buildDocumentDetailRegions,
  documentDetailLabels,
  toDocumentLineItems,
} from "@/components/shared/data-table";
import {
  purchaseInvoicesService,
  type PurchaseInvoiceRow,
} from "@/services/purchase-invoices-service";
import type { PurchaseDocumentStatusValue } from "@/services/purchase-quotations-service";
import { partnersService, type PartnerRow } from "@/services/partners-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { buildInvoiceColumns, invoiceExportColumns } from "@/config/purchasing/invoice-columns";
import {
  INVOICE_ARCHIVABLE_STATUSES,
  INVOICE_FILTERABLE_STATUSES,
  INVOICE_STATUS_LABEL_KEY,
} from "@/config/purchasing/invoice-status";
import { buildInvoicePrintPayload } from "@/config/purchasing/invoice-print";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { siteConfig } from "@/config/site";
import { ApiError } from "@/services/api-client";
import { CreateReturnDialog } from "./create-return-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

/** Mirrors `sales/quotations/page.tsx`. */
function PurchaseInvoicesPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<PurchaseInvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [supplierFilter, setSupplierFilter] = usePathRestorableState<PartnerRow[]>("supplier", []);
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [returnTarget, setReturnTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await purchaseInvoicesService.list({
        search: search || undefined,
        status: statusFilter as PurchaseDocumentStatusValue[],
        partnerId: supplierFilter.map((supplier) => supplier.id),
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load purchase invoices.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, supplierFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("purchasing.invoices.create");

  const toPrintRow = useCallback(
    (item: PurchaseInvoiceRow): Record<string, string> => ({
      invoiceNumber: item.invoiceNumber,
      supplier: item.partner?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(INVOICE_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: PurchaseInvoiceRow) => {
    try {
      const created = await purchaseInvoicesService.create({
        partnerId: row.partnerId,
        currencyId: row.currencyId ?? undefined,
        referenceNumber: row.referenceNumber ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        supplierNotes: row.supplierNotes ?? undefined,
        items: row.items.map((item) => ({
          productId: item.productId,
          description: item.description ?? undefined,
          warehouseId: item.warehouseId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          discountValue: Number(item.discountValue),
          taxId: item.taxId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("purchasing.invoices.toasts.duplicated"));
      router.push(`/purchasing/purchase-invoices/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to duplicate purchase invoice.",
      );
    }
  };

  const handlePrintRow = async (row: PurchaseInvoiceRow) => {
    try {
      const full = await purchaseInvoicesService.get(row.id);
      printDocument(
        buildInvoicePrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print purchase invoice.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await purchaseInvoicesService.cancel(cancelTarget.id);
      toast.success(t("purchasing.invoices.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel purchase invoice.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await purchaseInvoicesService.archive(archiveTarget.id);
      toast.success(t("purchasing.invoices.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to archive purchase invoice.",
      );
    } finally {
      setArchiveTarget(null);
    }
  };

  const invoiceColumns = useMemo(
    () =>
      buildInvoiceColumns({
        usersById,
        onView: (row) => router.push(`/purchasing/purchase-invoices/${row.id}`),
        onDuplicate: handleDuplicate,
        onPrint: handlePrintRow,
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
        onCreateReturn: setReturnTarget,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, usersById, activeCompany, user],
  );

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    INVOICE_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("purchasing.invoices.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(invoiceColumns, invoiceExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      invoiceExportColumns,
      "purchase-invoices-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await purchaseInvoicesService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("purchasing.invoices.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("purchasing.invoices.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      title={t("purchasing.invoices.title")}
      description={t("purchasing.invoices.description")}
      actions={
        <>
          <ModuleImportButtons importType="PURCHASE_INVOICES" onImported={load} />
          {canCreate && (
            <EnterpriseButton
              type="button"
              onClick={() => router.push("/purchasing/purchase-invoices/new")}
            >
              <Plus />
              {t("purchasing.invoices.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("purchasing.invoices.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={INVOICE_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(INVOICE_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiEntityFilter
              label={t("purchasing.invoices.fields.supplier")}
              values={supplierFilter}
              onChange={(suppliers) => {
                setSupplierFilter(suppliers);
                setPage(1);
              }}
              onSearch={async (search) => {
                const result = await partnersService.list({
                  search: search || undefined,
                  pageSize: 20,
                });
                return result.items;
              }}
              getId={(supplier) => supplier.id}
              getTitle={(supplier) => supplier.name}
              getSubtitle={(supplier) => supplier.phone || supplier.email || undefined}
              subtitleDir="ltr"
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            {(statusFilter.length > 0 ||
              supplierFilter.length > 0 ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter([]);
                  setSupplierFilter([]);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }

        tableId="purchasing-invoices"
        printTitle={t("purchasing.invoices.title")}
        columns={invoiceColumns}
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
        exportColumns={exportColumnsFromKeys(invoiceColumns, invoiceExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "purchase-invoices.csv",
          )
        }
        emptyTitle={t("purchasing.invoices.empty")}
        renderExpandedRegions={(row) =>
          buildDocumentDetailRegions({
            documentColumnId: "invoiceNumber",
            partyColumnId: "supplier",
            notesColumnId: "createdAt",
            items: toDocumentLineItems(row.items ?? []),
            currency: row.currency,
            party: row.partner,
            notes: row.internalNotes,
            labels: documentDetailLabels(t, "supplier"),
            onShowMore: () => router.push(`/purchasing/purchase-invoices/${row.id}`),
          })
        }
        getRowId={(row) => row.id}
        getRowHref={(row) => `/purchasing/purchase-invoices/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("purchasing.invoices.confirmCancelTitle")}
        description={t("purchasing.invoices.confirmCancelDescription")}
        confirmLabel={t("purchasing.invoices.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("purchasing.invoices.confirmArchiveTitle")}
        description={t("purchasing.invoices.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("purchasing.invoices.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("purchasing.invoices.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />

      {returnTarget && (
        <CreateReturnDialog
          open={!!returnTarget}
          onOpenChange={(open) => !open && setReturnTarget(null)}
          invoice={returnTarget}
          onCreated={(purchaseReturn) => {
            setReturnTarget(null);
            router.push(`/purchasing/purchase-returns/${purchaseReturn.id}`);
          }}
        />
      )}
    </PageWorkspace>
  );
}

export default function PurchaseInvoicesPage() {
  return (
    <PermissionGate permission="purchasing.invoices.view">
      <PurchaseInvoicesPageContent />
    </PermissionGate>
  );
}
