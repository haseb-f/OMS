"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Ban, Eye, Pencil, Plus, Printer, Archive } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  SalesDocumentRowActionsMenu,
  SalesListBulkActions,
  type SalesDocumentRowAction,
} from "@/components/sales";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { MultiSelectFilter, MultiEntityFilter } from "@/components/shared/data-table";
import {
  supplierPaymentsService,
  type FinancialTransactionRow,
} from "@/services/supplier-payments-service";
import type { FinancialTransactionStatusValue } from "@/services/financial-transactions-service";
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import {
  TRANSACTION_ARCHIVABLE_STATUSES,
  TRANSACTION_FILTERABLE_STATUSES,
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { buildPaymentPrintPayload } from "@/config/purchasing/payment-print";
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

/** Mirrors `sales/payments/page.tsx` exactly. */
function SupplierPaymentsPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<FinancialTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [supplierFilter, setSupplierFilter] = useState<SupplierRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const usersById = useUsersLookup();
  const [cancelTarget, setCancelTarget] = useState<FinancialTransactionRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinancialTransactionRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await supplierPaymentsService.list({
        search: search || undefined,
        status: statusFilter as FinancialTransactionStatusValue[],
        supplierId: supplierFilter.map((supplier) => supplier.id),
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load payments.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, supplierFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("purchasing.payments.create");

  const toPrintRow = useCallback(
    (item: FinancialTransactionRow): Record<string, string> => ({
      transactionNumber: item.transactionNumber,
      supplier: item.supplier?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      amount: item.amount,
      status: t(TRANSACTION_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handlePrintRow = async (row: FinancialTransactionRow) => {
    try {
      const full = await supplierPaymentsService.get(row.id);
      printDocument(
        buildPaymentPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print payment.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await supplierPaymentsService.cancel(cancelTarget.id);
      toast.success(t("financialTransactions.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel payment.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await supplierPaymentsService.archive(archiveTarget.id);
      toast.success(t("financialTransactions.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive payment.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const columns = useMemo<ColumnDef<FinancialTransactionRow, unknown>[]>(
    () => [
      {
        id: "transactionNumber",
        meta: { titleKey: "purchasing.payments.fields.number" },
        accessorFn: (row) => row.transactionNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.transactionNumber}</SemanticValue>}
            secondary={formatDate(row.original.createdAt)}
          />
        ),
      },
      {
        id: "supplier",
        meta: { titleKey: "purchasing.payments.fields.supplier" },
        accessorFn: (row) => row.supplier?.name ?? "—",
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.supplier?.name ?? "—"}
            secondary={
              row.original.referenceNumber ? (
                <SemanticValue kind="id">{row.original.referenceNumber}</SemanticValue>
              ) : undefined
            }
          />
        ),
      },
      {
        id: "referenceNumber",
        meta: { titleKey: "purchasing.payments.fields.reference", defaultHidden: true },
        accessorFn: (row) => row.referenceNumber ?? "—",
        enableSorting: false,
      },
      {
        id: "status",
        meta: { titleKey: "purchasing.suppliers.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StackedCell
            primary={
              <StatusBadge
                label={t(TRANSACTION_STATUS_LABEL_KEY[row.original.status])}
                tone={TRANSACTION_STATUS_TONE[row.original.status]}
              />
            }
            secondary={<MoneyValue value={row.original.amount} />}
          />
        ),
      },
      {
        id: "amount",
        meta: { titleKey: "purchasing.payments.fields.amount", defaultHidden: true },
        accessorFn: (row) => row.amount,
        cell: (info) => <MoneyValue value={info.getValue() as string} />,
      },
      {
        id: "createdAt",
        meta: { titleKey: "purchasing.payments.fields.date", defaultHidden: true },
        accessorFn: (row) => formatDate(row.createdAt),
      },
      {
        id: "createdBy",
        meta: { titleKey: "purchasing.payments.fields.createdBy", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => (row.createdBy ? (usersById[row.createdBy] ?? "—") : "—"),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          const isDraft = item.status === "DRAFT";
          const canView = hasPermission("purchasing.payments.view");
          const canEdit = hasPermission("purchasing.payments.edit");
          const canPrint = hasPermission("purchasing.payments.print");
          const canCancel = hasPermission("purchasing.payments.cancel");
          const canArchive = hasPermission("purchasing.payments.archive");
          const actions: SalesDocumentRowAction[] = [
            {
              key: "view",
              label: t("purchasing.payments.open"),
              icon: Eye,
              hidden: !canView,
              onSelect: () => router.push(`/purchasing/payments/${item.id}`),
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !isDraft || !canEdit,
              onSelect: () => router.push(`/purchasing/payments/${item.id}`),
            },
            {
              key: "print",
              label: t("table.print"),
              icon: Printer,
              hidden: !canPrint,
              onSelect: () => handlePrintRow(item),
            },
            {
              key: "cancel",
              label: t("financialTransactions.actions.cancel"),
              icon: Ban,
              hidden: item.status !== "CONFIRMED" || !canCancel,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setCancelTarget(item),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !TRANSACTION_ARCHIVABLE_STATUSES.includes(item.status) || !canArchive,
              destructive: true,
              onSelect: () => setArchiveTarget(item),
            },
          ];
          return <SalesDocumentRowActionsMenu actions={actions} label={t("common.actions")} />;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, usersById, router, activeCompany, user],
  );

  const exportColumnKeys = [
    "transactionNumber",
    "supplier",
    "referenceNumber",
    "amount",
    "status",
    "createdAt",
    "createdBy",
  ];

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    TRANSACTION_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("purchasing.payments.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(columns, exportColumnKeys, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      exportColumnKeys,
      "supplier-payment-vouchers-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await supplierPaymentsService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("financialTransactions.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("financialTransactions.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      title={t("purchasing.payments.title")}
      description={t("purchasing.payments.description")}
      actions={
        <>
          <ModuleImportButtons importType="SUPPLIER_PAYMENTS" onImported={load} />
          {canCreate && (
            <EnterpriseButton type="button" onClick={() => router.push("/purchasing/payments/new")}>
              <Plus />
              {t("purchasing.payments.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("purchasing.payments.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={TRANSACTION_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(TRANSACTION_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiEntityFilter
              label={t("purchasing.payments.fields.supplier")}
              values={supplierFilter}
              onChange={(suppliers) => {
                setSupplierFilter(suppliers);
                setPage(1);
              }}
              onSearch={async (search) => {
                const result = await suppliersService.list({
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

        tableId="purchasing-payments"
        printTitle={t("purchasing.payments.title")}
        columns={columns}
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
        exportColumns={exportColumnsFromKeys(columns, exportColumnKeys, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "supplier-payment-vouchers.csv",
          )
        }
        emptyTitle={t("purchasing.payments.empty")}
        getRowId={(row) => row.id}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("financialTransactions.confirmCancelTitle")}
        description={t("financialTransactions.confirmCancelDescription")}
        confirmLabel={t("financialTransactions.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("financialTransactions.confirmArchiveTitle")}
        description={t("financialTransactions.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("financialTransactions.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("financialTransactions.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function SupplierPaymentsPage() {
  return (
    <PermissionGate permission="purchasing.payments.view">
      <SupplierPaymentsPageContent />
    </PermissionGate>
  );
}
