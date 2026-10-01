"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
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
import {
  MultiSelectFilter,
  useBulkLimitGuard,
  useMatchingSelection,
} from "@/components/shared/data-table";
import { BULK_LIMITS } from "@/lib/bulk-limits";
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
  type ShippingStatusCatalogEntry,
} from "@/services/shipping-service";
import {
  shippingCompaniesService,
  type ShippingCompanyOption,
} from "@/services/shipping-companies-service";
import {
  STORE_ORDER_SOURCE_VALUES,
  type StoreOrderSourceValue,
} from "@/services/store-orders-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgentFilter } from "@/components/agents/agent-options";
import { useCountries } from "@/hooks/use-reference-data";
import { fetchAllPages } from "@/lib/fetch-all-pages";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function ShippingPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canQuickEdit = hasPermission("shipping.edit");

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
  // Agents milestone — shipments of one owner agent.
  const [agentFilter, setAgentFilter] = usePathRestorableState<string>("agentId", "");
  const [trackingFilter, setTrackingFilter] = usePathRestorableState<string[]>("hasTracking", []);
  const [attachmentFilter, setAttachmentFilter] = usePathRestorableState<string[]>(
    "hasAttachment",
    [],
  );
  const [companies, setCompanies] = useState<ShippingCompanyOption[]>([]);
  const [statuses, setStatuses] = useState<ShippingStatusCatalogEntry[]>([]);
  const countries = useCountries();
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [manageTarget, setManageTarget] = useState<ShipmentListRow | null>(null);

  // R6 SHIP — deep link from an order ("Open in Shipping queue"): the URL
  // search wins over a remembered one and clears the other filters.
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get("search");
    if (!linked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(linked);
    setStatusFilter([]);
    setCompanyFilter([]);
    setCountryFilter([]);
    setSourceFilter([]);
    setAgentFilter("");
    setTrackingFilter([]);
    setAttachmentFilter([]);
    setDateRange(EMPTY_DATE_RANGE);
    setPage(1);
    // Runs once per visit; the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    shippingCompaniesService
      .listOptions()
      .then(setCompanies)
      .catch(() => setCompanies([]));
    shippingService
      .statuses()
      .then(setStatuses)
      .catch(() => setStatuses([]));
  }, []);

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      status: statusFilter as ShipmentStatusValue[],
      shippingCompanyId: companyFilter,
      countryId: countryFilter,
      source: sourceFilter as StoreOrderSourceValue[],
      agentId: agentFilter || undefined,
      hasTracking: trackingFilter[0] as "true" | "false" | undefined,
      hasAttachment: attachmentFilter[0] as "true" | "false" | undefined,
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [
      search,
      statusFilter,
      companyFilter,
      countryFilter,
      sourceFilter,
      agentFilter,
      trackingFilter,
      attachmentFilter,
      dateRange,
    ],
  );

  const handleRowPatched = useCallback((shipmentId: string, patch: Partial<ShipmentListRow>) => {
    setItems((current) =>
      current.map((item) => (item.id === shipmentId ? { ...item, ...patch } : item)),
    );
  }, []);

  const listFilters = useMemo(
    () => ({
      ...listParams(),
      sortBy,
      sortOrder,
    }),
    [listParams, sortBy, sortOrder],
  );
  const matching = useMatchingSelection(listFilters);
  const withinBulkLimit = useBulkLimitGuard();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await shippingService.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [listFilters, page, pageSize]);

  // Print: every row matching the current filters/sort, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        shippingService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(
    () =>
      buildShipmentColumns({
        onView: (row) => router.push(`/store-orders/${row.storeOrderId}`),
        onManage: (row) => setManageTarget(row),
        quickEdit: {
          canEdit: canQuickEdit,
          statuses,
          companies,
          onPatched: handleRowPatched,
        },
      }),
    [router, canQuickEdit, statuses, companies, handleRowPatched],
  );

  const toPrintRow = useCallback(
    (item: ShipmentListRow): Record<string, string> => ({
      internalOrderId: item.storeOrder.internalOrderId,
      externalOrderId: item.storeOrder.externalOrderId ?? "",
      customer: item.storeOrder.partner?.name ?? "",
      agent: item.storeOrder.agent
        ? `${item.storeOrder.agent.name} (${item.storeOrder.agent.agentNumber})`
        : "",
      shippingCompany: item.shippingCompany?.name ?? "",
      trackingNumber: item.trackingNumber ?? "",
      status: t(SHIPMENT_STATUS_LABEL_KEY[item.status]),
      shippedAt: item.shippedAt ? formatDate(item.shippedAt) : "",
    }),
    [t],
  );

  const selectedIds = Object.keys(rowSelection);

  // Shared select-all rules (tables-selection.md): stale results dropped,
  // "All N matching" only for a complete result of the current query.
  const handleSelectAllMatching = () =>
    matching.selectAllMatching(() => shippingService.listIds(listParams()), setRowSelection);

  const handleBulkStatusUpdate = async (status: ShipmentStatusValue) => {
    if (selectedIds.length === 0) return;
    if (!withinBulkLimit(selectedIds.length, BULK_LIMITS.shipmentBulkUpdateMax)) return;
    try {
      const result = await shippingService.bulkUpdate(selectedIds, status);
      if (result.failed.length === 0) {
        toast.success(t("shipping.bulk.success", { count: result.succeeded.length }));
      } else {
        toast.error(t("shipping.bulk.partialFailure", { count: result.failed.length }));
      }
      setRowSelection({});
      void load();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  return (
    <PageWorkspace
      dense
      title={t("shipping.title")}
      description={t("shipping.description")}
      actions={
        <HeaderActions
          inline={
            <>
              <ModuleImportButtons importType="SHIPPING_UPDATES" onImported={load} />
              <SyncButton sourceType="SHIPPING_UPDATES" onSynced={load} />
            </>
          }
        />
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
              options={STORE_ORDER_SOURCE_VALUES.map((source) => ({
                value: source,
                label: t(`storeOrders.source.${source}`),
              }))}
            />
            <AgentFilter
              value={agentFilter}
              onChange={(value) => {
                setAgentFilter(value);
                setPage(1);
              }}
            />
            <MultiSelectFilter
              label={t("shipping.filters.tracking")}
              values={trackingFilter}
              onChange={(values) => {
                setTrackingFilter(values.slice(-1));
                setPage(1);
              }}
              options={[
                { value: "true", label: t("shipping.filters.trackingHas") },
                { value: "false", label: t("shipping.filters.trackingMissing") },
              ]}
            />
            <MultiSelectFilter
              label={t("shipping.filters.attachment")}
              values={attachmentFilter}
              onChange={(values) => {
                setAttachmentFilter(values.slice(-1));
                setPage(1);
              }}
              options={[
                { value: "true", label: t("shipping.filters.attachmentHas") },
                { value: "false", label: t("shipping.filters.attachmentMissing") },
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
              trackingFilter.length > 0 ||
              attachmentFilter.length > 0 ||
              sourceFilter.length > 0 ||
              agentFilter ||
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
                  setAgentFilter("");
                  setTrackingFilter([]);
                  setAttachmentFilter([]);
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
        fetchAllRows={fetchAllRows}
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
        selectionResetKey={matching.queryKey}
        matchingSelection={matching.matchingSelection}
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={matching.isSelectingAllMatching}
        bulkActions={
          <ShippingBulkActions
            selectedCount={selectedIds.length}
            onApply={handleBulkStatusUpdate}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, shipmentExportColumns, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "shipping.csv",
            labels,
          )
        }
        emptyTitle={t("shipping.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/store-orders/${row.storeOrderId}`}
        identityOnlyNavigation
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
