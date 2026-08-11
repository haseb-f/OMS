"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
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
import { StoreOrdersBulkActions } from "@/components/store-orders/store-orders-bulk-actions";
import { StoreOrderCreateDialog } from "@/components/store-orders/store-order-create-dialog";
import {
  storeOrdersService,
  type StoreOrderPaymentStatusValue,
  type StoreOrderRow,
  type StoreOrderShippingStageValue,
  type StoreOrderSourceValue,
} from "@/services/store-orders-service";
import {
  buildStoreOrderColumns,
  storeOrderExportColumns,
} from "@/config/store-orders/order-columns";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_VALUES,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_VALUES,
} from "@/config/store-orders/status";
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

function StoreOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList } = usePrintEngine();
  const canCreate = hasPermission("store-orders.create");

  const [items, setItems] = useState<StoreOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("orderDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>("");
  const [shippingStageFilter, setShippingStageFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // Cross-page selection cache (mirrors sales/orders/page.tsx) — `items`
  // only ever holds the current page, so a row selected earlier keeps its
  // real data available for bulk print/export after paging away.
  const [itemsCache, setItemsCache] = useState<Record<string, StoreOrderRow>>({});

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      paymentStatus: (paymentStatusFilter || undefined) as StoreOrderPaymentStatusValue | undefined,
      shippingStage: (shippingStageFilter || undefined) as StoreOrderShippingStageValue | undefined,
      source: (sourceFilter || undefined) as StoreOrderSourceValue | undefined,
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [search, paymentStatusFilter, shippingStageFilter, sourceFilter, dateRange],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await storeOrdersService.list({
        ...listParams(),
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
      setItemsCache((cache) => ({
        ...cache,
        ...Object.fromEntries(result.items.map((item) => [item.id, item])),
      }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load store orders.");
    } finally {
      setIsLoading(false);
    }
  }, [listParams, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toPrintRow = useCallback(
    (item: StoreOrderRow): Record<string, string> => ({
      internalOrderId: item.internalOrderId,
      externalOrderId: item.externalOrderId ?? "",
      customer: item.customer?.name ?? "",
      orderDate: formatDate(item.orderDate),
      paymentStatus: t(PAYMENT_STATUS_LABEL_KEY[item.paymentStatus]),
      shippingStage: t(SHIPPING_STAGE_LABEL_KEY[item.shippingStage]),
      total: item.total ?? "0",
    }),
    [t],
  );

  const columns = useMemo(
    () =>
      buildStoreOrderColumns({
        onView: (row) => router.push(`/store-orders/${row.id}`),
      }),
    [router],
  );

  const selectedIds = Object.keys(rowSelection);
  const selectedItems = selectedIds.map((id) => itemsCache[id]).filter((item) => !!item);

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("storeOrders.title"),
      company: {
        name: activeCompany?.name ?? siteConfig.fullName,
        logoUrl: activeCompany?.logoUrl ?? null,
      },
      printedByName: user?.fullName ?? null,
      columns: exportColumnsFromKeys(columns, storeOrderExportColumns, t),
      rows: selectedItems.map(toPrintRow),
    });
  };

  const handleBulkExport = () => {
    if (selectedItems.length === 0) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      storeOrderExportColumns,
      "store-orders-selected.csv",
    );
  };

  const handleSelectAllMatching = async () => {
    setIsSelectingAllMatching(true);
    try {
      const result = await storeOrdersService.listIds(listParams());
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to select all matching orders.",
      );
    } finally {
      setIsSelectingAllMatching(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("storeOrders.title")}
        subtitle={t("storeOrders.description")}
        actions={
          <>
            <ModuleImportButtons importType="STORE_ORDERS" onImported={load} />
            {canCreate && (
              <EnterpriseButton
                type="button"
                className="gap-1.5"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="size-3.5" />
                {t("storeOrders.createDialog.trigger")}
              </EnterpriseButton>
            )}
          </>
        }
        filters={
          <>
            <Select
              value={paymentStatusFilter || "__all__"}
              onValueChange={(v) => {
                setPaymentStatusFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("storeOrders.filters.paymentStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("storeOrders.filters.allPaymentStatuses")}
                </SelectItem>
                {PAYMENT_STATUS_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(PAYMENT_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={shippingStageFilter || "__all__"}
              onValueChange={(v) => {
                setShippingStageFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("storeOrders.filters.shippingStage")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("storeOrders.filters.allShippingStages")}
                </SelectItem>
                {SHIPPING_STAGE_VALUES.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {t(SHIPPING_STAGE_LABEL_KEY[stage])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sourceFilter || "__all__"}
              onValueChange={(v) => {
                setSourceFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder={t("storeOrders.filters.source")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("storeOrders.filters.allSources")}</SelectItem>
                <SelectItem value="MANUAL">{t("storeOrders.source.MANUAL")}</SelectItem>
                <SelectItem value="IMPORT">{t("storeOrders.source.IMPORT")}</SelectItem>
              </SelectContent>
            </Select>
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
        tableId="store-orders"
        printTitle={t("storeOrders.title")}
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
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={isSelectingAllMatching}
        bulkActions={
          <StoreOrdersBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            labels={{ print: t("table.print"), export: t("table.export") }}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, storeOrderExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "store-orders.csv",
          )
        }
        emptyTitle={t("storeOrders.empty")}
        getRowId={(row) => row.id}
      />

      <StoreOrderCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={() => void load()}
      />
    </div>
  );
}

export default function StoreOrdersPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrdersPageContent />
    </PermissionGate>
  );
}
