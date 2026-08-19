"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { SyncButton } from "@/components/shared/sync-button";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { MultiSelectFilter } from "@/components/shared/data-table";
import { ShippingBulkActions } from "@/components/shipping/shipping-bulk-actions";
import { ShipmentManageDialog } from "@/components/shipping/shipment-manage-dialog";
import { buildShipmentColumns, shipmentExportColumns } from "@/config/shipping/shipment-columns";
import {
  SHIPMENT_STATUS_LABEL_KEY,
  SHIPMENT_STATUS_VALUES,
} from "@/config/shipping/shipment-status";
import {
  shippingService,
  type ShipmentListRow,
  type ShipmentStatusValue,
} from "@/services/shipping-service";
import {
  shippingCompaniesService,
  type ShippingCompanyOption,
} from "@/services/shipping-companies-service";
import type { StoreOrderSourceValue } from "@/services/store-orders-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useCountries } from "@/hooks/use-reference-data";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function ShippingPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const [items, setItems] = useState<ShipmentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [companyFilter, setCompanyFilter] = usePathRestorableState<string[]>("company", []);
  const [countryFilter, setCountryFilter] = usePathRestorableState<string[]>("country", []);
  const [sourceFilter, setSourceFilter] = usePathRestorableState<string[]>("source", []);
  const [companies, setCompanies] = useState<ShippingCompanyOption[]>([]);
  const countries = useCountries();
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
  const [manageTarget, setManageTarget] = useState<ShipmentListRow | null>(null);

  useEffect(() => {
    shippingCompaniesService
      .listOptions()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      status: statusFilter as ShipmentStatusValue[],
      shippingCompanyId: companyFilter,
      countryId: countryFilter,
      source: sourceFilter as StoreOrderSourceValue[],
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [search, statusFilter, companyFilter, countryFilter, sourceFilter, dateRange],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await shippingService.list({
        ...listParams(),
        page,
        pageSize,
        sortBy,
        sortOrder,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load shipments.");
    } finally {
      setIsLoading(false);
    }
  }, [listParams, page, pageSize, sortBy, sortOrder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(
    () =>
      buildShipmentColumns({
        onView: (row) => router.push(`/store-orders/${row.storeOrderId}`),
        onManage: (row) => setManageTarget(row),
      }),
    [router],
  );

  const toPrintRow = useCallback(
    (item: ShipmentListRow): Record<string, string> => ({
      internalOrderId: item.storeOrder.internalOrderId,
      externalOrderId: item.storeOrder.externalOrderId ?? "",
      customer: item.storeOrder.customer?.name ?? "",
      shippingCompany: item.shippingCompany?.name ?? "",
      trackingNumber: item.trackingNumber ?? "",
      status: t(SHIPMENT_STATUS_LABEL_KEY[item.status]),
      shippedAt: item.shippedAt ? formatDate(item.shippedAt) : "",
    }),
    [t],
  );

  const selectedIds = Object.keys(rowSelection);

  const handleSelectAllMatching = async () => {
    setIsSelectingAllMatching(true);
    try {
      const result = await shippingService.listIds(listParams());
      setRowSelection(Object.fromEntries(result.ids.map((id) => [id, true])));
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to select all matching shipments.",
      );
    } finally {
      setIsSelectingAllMatching(false);
    }
  };

  const handleBulkStatusUpdate = async (status: ShipmentStatusValue) => {
    if (selectedIds.length === 0) return;
    const result = await shippingService.bulkUpdate(selectedIds, status);
    if (result.failed.length === 0) {
      toast.success(t("shipping.bulk.success", { count: result.succeeded.length }));
    } else {
      toast.error(t("shipping.bulk.partialFailure", { count: result.failed.length }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      title={t("shipping.title")}
      description={t("shipping.description")}
      actions={
        <>
          <ModuleImportButtons importType="SHIPPING_UPDATES" onImported={load} />
          <SyncButton sourceType="SHIPPING_UPDATES" onSynced={load} />
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("shipping.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={SHIPMENT_STATUS_VALUES.map((status) => ({
                value: status,
                label: t(SHIPMENT_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiSelectFilter
              label={t("shipping.filters.company")}
              values={companyFilter}
              onChange={(values) => {
                setCompanyFilter(values);
                setPage(1);
              }}
              options={companies.map((company) => ({
                value: company.id,
                label: company.name,
              }))}
            />
            <MultiSelectFilter
              label={t("shipping.filters.country")}
              values={countryFilter}
              onChange={(values) => {
                setCountryFilter(values);
                setPage(1);
              }}
              options={countries.map((country) => ({
                value: country.id,
                label: country.name,
              }))}
            />
            <MultiSelectFilter
              label={t("shipping.filters.source")}
              values={sourceFilter}
              onChange={(values) => {
                setSourceFilter(values);
                setPage(1);
              }}
              options={[
                { value: "MANUAL", label: t("storeOrders.source.MANUAL") },
                { value: "IMPORT", label: t("storeOrders.source.IMPORT") },
              ]}
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            {(statusFilter.length > 0 ||
              companyFilter.length > 0 ||
              countryFilter.length > 0 ||
              sourceFilter.length > 0 ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter([]);
                  setCompanyFilter([]);
                  setCountryFilter([]);
                  setSourceFilter([]);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }

        tableId="shipping"
        printTitle={t("shipping.title")}
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
          <ShippingBulkActions
            selectedCount={selectedIds.length}
            onApply={handleBulkStatusUpdate}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, shipmentExportColumns, t)}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "shipping.csv",
          )
        }
        emptyTitle={t("shipping.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/store-orders/${row.storeOrderId}`}
      />

      <ShipmentManageDialog
        shipment={manageTarget}
        open={!!manageTarget}
        onOpenChange={(open) => !open && setManageTarget(null)}
        onUpdated={load}
        shippingCompanies={companies}
      />
    </PageWorkspace>
  );
}

export default function ShippingPage() {
  return (
    <PermissionGate permission="shipping.view">
      <ShippingPageContent />
    </PermissionGate>
  );
}
