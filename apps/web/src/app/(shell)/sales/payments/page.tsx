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
import { CustomerPicker } from "@/components/business/customer-picker";
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
  customerReceiptsService,
  type FinancialTransactionRow,
} from "@/services/customer-receipts-service";
import type { FinancialTransactionStatusValue } from "@/services/financial-transactions-service";
import type { CustomerRow } from "@/services/customers-service";
import { usersService } from "@/services/users-service";
import {
  TRANSACTION_ARCHIVABLE_STATUSES,
  TRANSACTION_FILTERABLE_STATUSES,
  TRANSACTION_STATUS_LABEL_KEY,
  TRANSACTION_STATUS_TONE,
} from "@/config/financial-transactions/status";
import { buildReceiptPrintPayload } from "@/config/sales/receipt-print";
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

/** Fills the pre-provisioned `/sales/payments` nav stub — mirrors `sales/quotations/page.tsx` exactly. */
function CustomerReceiptsPageContent() {
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
  const [customerFilter, setCustomerFilter] = useState<CustomerRow | null>(null);
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
      const result = await customerReceiptsService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as FinancialTransactionStatusValue | undefined,
        customerId: customerFilter?.id,
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load receipts.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, customerFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("sales.receipts.create");

  const toPrintRow = useCallback(
    (item: FinancialTransactionRow): Record<string, string> => ({
      transactionNumber: item.transactionNumber,
      customer: item.customer?.name ?? "",
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
      const full = await customerReceiptsService.get(row.id);
      printDocument(
        buildReceiptPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print receipt.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await customerReceiptsService.cancel(cancelTarget.id);
      toast.success(t("financialTransactions.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel receipt.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await customerReceiptsService.archive(archiveTarget.id);
      toast.success(t("financialTransactions.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive receipt.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const columns = useMemo<ColumnDef<FinancialTransactionRow, unknown>[]>(
    () => [
      {
        id: "transactionNumber",
        meta: { titleKey: "sales.receipts.fields.number" },
        accessorFn: (row) => row.transactionNumber,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "customer",
        meta: { titleKey: "sales.receipts.fields.customer" },
        accessorFn: (row) => row.customer?.name ?? "—",
        cell: (info) => <span className="font-medium">{info.getValue() as string}</span>,
      },
      {
        id: "referenceNumber",
        meta: { titleKey: "sales.receipts.fields.reference" },
        accessorFn: (row) => row.referenceNumber ?? "—",
        enableSorting: false,
      },
      {
        id: "amount",
        meta: { titleKey: "sales.receipts.fields.amount" },
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
        meta: { titleKey: "sales.receipts.fields.date" },
        accessorFn: (row) => formatDate(row.createdAt),
      },
      {
        id: "createdBy",
        meta: { titleKey: "sales.receipts.fields.createdBy" },
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
              label: t("sales.receipts.open"),
              icon: Eye,
              onSelect: () => router.push(`/sales/payments/${item.id}`),
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !isDraft,
              onSelect: () => router.push(`/sales/payments/${item.id}`),
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
    "customer",
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
      title: t("sales.receipts.title"),
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
      "customer-receipt-vouchers-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await customerReceiptsService.archive(item.id);
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
        title={t("sales.receipts.title")}
        subtitle={t("sales.receipts.description")}
        actions={
          <>
            <ModuleImportButtons importType="CUSTOMER_RECEIPTS" onImported={load} />
            {canCreate && (
              <EnterpriseButton type="button" onClick={() => router.push("/sales/payments/new")}>
                <Plus />
                {t("sales.receipts.addNew")}
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
                <SelectValue placeholder={t("sales.receipts.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("sales.receipts.filters.allStatuses")}</SelectItem>
                {TRANSACTION_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(TRANSACTION_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <CustomerPicker
                value={customerFilter}
                onChange={(customer) => {
                  setCustomerFilter(customer);
                  setPage(1);
                }}
              />
              {customerFilter && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("sales.receipts.filters.allCustomers")}
                  onClick={() => {
                    setCustomerFilter(null);
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
        tableId="sales-receipts"
        printTitle={t("sales.receipts.title")}
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
            "customer-receipt-vouchers.csv",
          )
        }
        emptyTitle={t("sales.receipts.empty")}
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

export default function CustomerReceiptsPage() {
  return (
    <PermissionGate permission="sales.receipts.view">
      <CustomerReceiptsPageContent />
    </PermissionGate>
  );
}
