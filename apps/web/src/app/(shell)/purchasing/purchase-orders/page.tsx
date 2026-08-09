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
  purchaseOrdersService,
  type PurchaseOrderStatusValue,
  type PurchaseOrderRow,
} from "@/services/purchase-orders-service";
import type { SupplierRow } from "@/services/suppliers-service";
import { usersService } from "@/services/users-service";
import { buildOrderColumns, orderExportColumns } from "@/config/purchasing/order-columns";
import {
  ORDER_ARCHIVABLE_STATUSES,
  ORDER_FILTERABLE_STATUSES,
  ORDER_STATUS_LABEL_KEY,
} from "@/config/purchasing/order-status";
import { buildOrderPrintPayload } from "@/config/purchasing/order-print";
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

/** Mirrors `sales/quotations/page.tsx` exactly (TASK-042 — brought to full list parity with Quotation/Invoice/Return: server pagination, date range, archive). */
function PurchaseOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<PurchaseOrderRow[]>([]);
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
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrderRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PurchaseOrderRow | null>(null);
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
      const result = await purchaseOrdersService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as PurchaseOrderStatusValue | undefined,
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load purchase orders.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, supplierFilter, dateRange, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("purchasing.orders.create");

  const toPrintRow = useCallback(
    (item: PurchaseOrderRow): Record<string, string> => ({
      poNumber: item.poNumber,
      supplier: item.supplier?.name ?? "",
      referenceNumber: item.referenceNumber ?? "",
      grandTotal: item.items.reduce((sum, i) => sum + Number(i.subtotal), 0).toFixed(2),
      status: t(ORDER_STATUS_LABEL_KEY[item.status]),
      createdAt: formatDate(item.createdAt),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  const handleDuplicate = async (row: PurchaseOrderRow) => {
    try {
      const created = await purchaseOrdersService.create({
        supplierId: row.supplierId,
        purchaseType: row.purchaseType,
        referenceNumber: row.referenceNumber ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        supplierNotes: row.supplierNotes ?? undefined,
        items: row.items.map((item) => ({
          productId: item.productId,
          description: item.description ?? undefined,
          unitId: item.unitId ?? undefined,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discountPercent: Number(item.discountPercent),
          discountValue: Number(item.discountValue),
          subtotal: Number(item.subtotal),
          taxId: item.taxId ?? undefined,
          notes: item.notes ?? undefined,
        })),
      });
      toast.success(t("purchasing.orders.toasts.duplicated"));
      router.push(`/purchasing/purchase-orders/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to duplicate purchase order.",
      );
    }
  };

  const handlePrintRow = async (row: PurchaseOrderRow) => {
    try {
      const full = await purchaseOrdersService.get(row.id);
      printDocument(
        buildOrderPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print purchase order.");
    }
  };

  const handleCancelConfirmed = async () => {
    if (!cancelTarget) return;
    try {
      await purchaseOrdersService.cancel(cancelTarget.id);
      toast.success(t("purchasing.orders.toasts.cancelled"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to cancel purchase order.");
    } finally {
      setCancelTarget(null);
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await purchaseOrdersService.archive(archiveTarget.id);
      toast.success(t("purchasing.orders.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive purchase order.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const orderColumns = useMemo(
    () =>
      buildOrderColumns({
        usersById,
        onView: (row) => router.push(`/purchasing/purchase-orders/${row.id}`),
        onDuplicate: handleDuplicate,
        onPrint: handlePrintRow,
        onCancel: setCancelTarget,
        onArchive: setArchiveTarget,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usersById, router, activeCompany, user],
  );

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    ORDER_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("purchasing.orders.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(orderColumns, orderExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      orderExportColumns,
      "purchase-orders-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await purchaseOrdersService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("purchasing.orders.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("purchasing.orders.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("purchasing.orders.title")}
        subtitle={t("purchasing.orders.description")}
        actions={
          <>
            <ModuleImportButtons importType="PURCHASE_ORDERS" onImported={load} />
            {canCreate && (
              <EnterpriseButton
                type="button"
                onClick={() => router.push("/purchasing/purchase-orders/new")}
              >
                <Plus />
                {t("purchasing.orders.addNew")}
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
                <SelectValue placeholder={t("purchasing.orders.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("purchasing.orders.filters.allStatuses")}
                </SelectItem>
                {ORDER_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(ORDER_STATUS_LABEL_KEY[status])}
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
                  aria-label={t("purchasing.orders.filters.allSuppliers")}
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
        tableId="purchasing-orders"
        printTitle={t("purchasing.orders.title")}
        columns={orderColumns}
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
        exportColumns={exportColumnsFromKeys(orderColumns, orderExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "purchase-orders.csv",
          )
        }
        emptyTitle={t("purchasing.orders.empty")}
        getRowId={(row) => row.id}
      />

      <ConfirmationDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        tone="destructive"
        title={t("purchasing.orders.confirmCancelTitle")}
        description={t("purchasing.orders.confirmCancelDescription")}
        confirmLabel={t("purchasing.orders.actions.cancel")}
        cancelLabel={t("common.close")}
        onConfirm={handleCancelConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("purchasing.orders.confirmArchiveTitle")}
        description={t("purchasing.orders.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("purchasing.orders.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("purchasing.orders.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <PermissionGate permission="purchasing.orders.view">
      <PurchaseOrdersPageContent />
    </PermissionGate>
  );
}
