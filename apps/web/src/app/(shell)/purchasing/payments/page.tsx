"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Ban, Eye, Pencil, Plus, Printer, Archive, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { SupplierPicker } from "@/components/business/supplier-picker";
import { StatusBadge } from "@/components/business/status-badge";
import {
  SalesDocumentRowActionsMenu,
  SalesListBulkActions,
  type SalesDocumentRowAction,
} from "@/components/sales";
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
  supplierPaymentsService,
  type FinancialTransactionRow,
} from "@/services/supplier-payments-service";
import type { FinancialTransactionStatusValue } from "@/services/financial-transactions-service";
import type { SupplierRow } from "@/services/suppliers-service";
import { usersService } from "@/services/users-service";
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

function MoneyCell({ value }: { value: string }) {
  return (
    <span dir="ltr">
      {Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  );
}

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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [supplierFilter, setSupplierFilter] = useState<SupplierRow | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [usersById, setUsersById] = useState<Record<string, string>>({});
  const [cancelTarget, setCancelTarget] = useState<FinancialTransactionRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinancialTransactionRow | null>(null);
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
      const result = await supplierPaymentsService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as FinancialTransactionStatusValue | undefined,
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
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "supplier",
        meta: { titleKey: "purchasing.payments.fields.supplier" },
        accessorFn: (row) => row.supplier?.name ?? "—",
        cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
      },
      {
        id: "referenceNumber",
        meta: { titleKey: "purchasing.payments.fields.reference" },
        accessorFn: (row) => row.referenceNumber ?? "—",
        enableSorting: false,
      },
      {
        id: "amount",
        meta: { titleKey: "purchasing.payments.fields.amount" },
        accessorFn: (row) => row.amount,
        cell: (info) => <MoneyCell value={info.getValue() as string} />,
      },
      {
        id: "status",
        meta: { titleKey: "purchasing.suppliers.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(TRANSACTION_STATUS_LABEL_KEY[row.original.status])}
            tone={TRANSACTION_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "createdAt",
        meta: { titleKey: "purchasing.payments.fields.date" },
        accessorFn: (row) => formatDate(row.createdAt),
      },
      {
        id: "createdBy",
        meta: { titleKey: "purchasing.payments.fields.createdBy" },
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
          const actions: SalesDocumentRowAction[] = [
            {
              key: "view",
              label: t("purchasing.payments.open"),
              icon: Eye,
              onSelect: () => router.push(`/purchasing/payments/${item.id}`),
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !isDraft,
              onSelect: () => router.push(`/purchasing/payments/${item.id}`),
            },
            {
              key: "print",
              label: t("table.print"),
              icon: Printer,
              onSelect: () => handlePrintRow(item),
            },
            {
              key: "cancel",
              label: t("financialTransactions.actions.cancel"),
              icon: Ban,
              hidden: item.status !== "CONFIRMED",
              destructive: true,
              separatorBefore: true,
              onSelect: () => setCancelTarget(item),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !TRANSACTION_ARCHIVABLE_STATUSES.includes(item.status),
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("purchasing.payments.title")}
        subtitle={t("purchasing.payments.description")}
        actions={
          <>
            <ModuleImportButtons importType="SUPPLIER_PAYMENTS" onImported={load} />
            {canCreate && (
              <EnterpriseButton
                type="button"
                onClick={() => router.push("/purchasing/payments/new")}
              >
                <Plus />
                {t("purchasing.payments.addNew")}
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
                <SelectValue placeholder={t("purchasing.payments.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("purchasing.payments.filters.allStatuses")}
                </SelectItem>
                {TRANSACTION_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(TRANSACTION_STATUS_LABEL_KEY[status])}
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
                  aria-label={t("purchasing.payments.filters.allSuppliers")}
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
    </div>
  );
}

export default function SupplierPaymentsPage() {
  return (
    <PermissionGate permission="purchasing.payments.view">
      <SupplierPaymentsPageContent />
    </PermissionGate>
  );
}
