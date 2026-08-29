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
  salesInvoicesService,
  type SalesDocumentStatusValue,
  type SalesInvoiceRow,
} from "@/services/sales-invoices-service";
import { partnersService, type PartnerRow } from "@/services/partners-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { buildInvoiceColumns, invoiceExportColumns } from "@/config/sales/invoice-columns";
import {
  INVOICE_ARCHIVABLE_STATUSES,
  INVOICE_FILTERABLE_STATUSES,
  INVOICE_STATUS_LABEL_KEY,
} from "@/config/sales/invoice-status";
import { buildInvoicePrintPayload } from "@/config/sales/invoice-print";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
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

function SalesInvoicesPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<SalesInvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [customerFilter, setCustomerFilter] = usePathRestorableState<PartnerRow[]>("customer", []);
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<SalesInvoiceRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SalesInvoiceRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesInvoicesService.list({
        search: search || undefined,
        status: statusFilter as SalesDocumentStatusValue[],
        partnerId: customerFilter.map((customer) => customer.id),
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load sales invoices.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, customerFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("sales.invoices.create");

  const toPrintRow = useCallback(
    (item: SalesInvoiceRow): Record<string, string> => ({
      invoiceNumber: item.invoiceNumber,
      partner: item.partner?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.grandTotal,
      status: t(INVOICE_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: SalesInvoiceRow) => {
    try {
      const created = await salesInvoicesService.create({
        partnerId: row.partnerId,
        currencyId: row.currencyId ?? undefined,
        referenceNumber: row.referenceNumber ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        customerNotes: row.customerNotes ?? undefined,
        items: row.items.map((item) => ({
          productId: item.productId,
          description: item.description ?? undefined,
          warehouseId: item.warehouseId ?? undefined,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          discountValue: Number(item.discountValue),
          taxId: item.taxId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("sales.invoices.toasts.duplicated"));
      router.push(`/sales/invoices/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to duplicate sales invoice.");
    }
  };

  const handlePrintRow = async (row: SalesInvoiceRow) => {
    try {
      const full = await salesInvoicesService.get(row.id);
      printDocument(
        buildInvoicePrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print sales invoice.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await salesInvoicesService.cancel(cancelTarget.id);
      toast.success(t("sales.invoices.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel sales invoice.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await salesInvoicesService.archive(archiveTarget.id);
      toast.success(t("sales.invoices.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive sales invoice.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const invoiceColumns = useMemo(
    () =>
      buildInvoiceColumns({
        usersById,
        onView: (row) => router.push(`/sales/invoices/${row.id}`),
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
    INVOICE_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("sales.invoices.title"),
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
      "sales-invoices-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await salesInvoicesService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(t("sales.invoices.toasts.bulkArchived", { count: selectedArchivable.length }));
    } else {
      toast.error(t("sales.invoices.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      title={t("sales.invoices.title")}
      description={t("sales.invoices.description")}
      actions={
        <>
          <ModuleImportButtons importType="SALES_INVOICES" onImported={load} />
          {canCreate && (
            <EnterpriseButton type="button" onClick={() => router.push("/sales/invoices/new")}>
              <Plus />
              {t("sales.invoices.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("sales.invoices.filters.status")}
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
              label={t("sales.invoices.fields.customer")}
              values={customerFilter}
              onChange={(customers) => {
                setCustomerFilter(customers);
                setPage(1);
              }}
              onSearch={async (search) => {
                const result = await partnersService.list({
                  search: search || undefined,
                  pageSize: 20,
                });
                return result.items;
              }}
              getId={(customer) => customer.id}
              getTitle={(customer) => customer.name}
              getSubtitle={(customer) =>
                customer.phone || customer.mobile || customer.email || undefined
              }
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
              customerFilter.length > 0 ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter([]);
                  setCustomerFilter([]);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }

        tableId="sales-invoices"
        printTitle={t("sales.invoices.title")}
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
            "sales-invoices.csv",
          )
        }
        emptyTitle={t("sales.invoices.empty")}
        renderExpandedRegions={(row) =>
          buildDocumentDetailRegions({
            documentColumnId: "invoiceNumber",
            partyColumnId: "customer",
            notesColumnId: "createdAt",
            items: toDocumentLineItems(row.items ?? []),
            currency: row.currency,
            party: row.partner,
            notes: row.internalNotes,
            labels: documentDetailLabels(t, "customer"),
            onShowMore: () => router.push(`/sales/invoices/${row.id}`),
          })
        }
        getRowId={(row) => row.id}
        getRowHref={(row) => `/sales/invoices/${row.id}`}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("sales.invoices.confirmCancelTitle")}
        description={t("sales.invoices.confirmCancelDescription")}
        confirmLabel={t("sales.invoices.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("sales.invoices.confirmArchiveTitle")}
        description={t("sales.invoices.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("sales.invoices.bulk.archiveConfirmTitle", { count: selectedArchivable.length })}
        description={t("sales.invoices.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function SalesInvoicesPage() {
  return (
    <PermissionGate permission="sales.invoices.view">
      <SalesInvoicesPageContent />
    </PermissionGate>
  );
}
