"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
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
import { createMasterDataService } from "@/services/master-data-service";
import type { ShippingMethodRow, CountryRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";

const shippingMethodsService = createMasterDataService<ShippingMethodRow>("/shipping-methods");
const countriesService = createMasterDataService<CountryRow>("/countries");

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function ShippingPageContent() {
  const { t } = useLocale();
  const router = useRouter();

  const [items, setItems] = useState<ShipmentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [companyFilter, setCompanyFilter] = useState<string>("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [companies, setCompanies] = useState<ShippingMethodRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingAllMatching, setIsSelectingAllMatching] = useState(false);
  const [manageTarget, setManageTarget] = useState<ShipmentListRow | null>(null);

  useEffect(() => {
    shippingMethodsService
      .list({ pageSize: 200 })
      .then((result) => setCompanies(result.items))
      .catch(() => setCompanies([]));
    countriesService
      .list({ pageSize: 300 })
      .then((result) => setCountries(result.items))
      .catch(() => setCountries([]));
  }, []);

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      status: (statusFilter || undefined) as ShipmentStatusValue | undefined,
      shippingCompanyId: companyFilter || undefined,
      countryId: countryFilter || undefined,
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [search, statusFilter, companyFilter, countryFilter, dateRange],
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("shipping.title")}
        subtitle={t("shipping.description")}
        actions={<ModuleImportButtons importType="SHIPPING_UPDATES" onImported={load} />}
        filters={
          <>
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) => {
                setStatusFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("shipping.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("shipping.filters.allStatuses")}</SelectItem>
                {SHIPMENT_STATUS_VALUES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(SHIPMENT_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={companyFilter || "__all__"}
              onValueChange={(v) => {
                setCompanyFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("shipping.filters.company")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("shipping.filters.allCompanies")}</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={countryFilter || "__all__"}
              onValueChange={(v) => {
                setCountryFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("shipping.filters.country")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("shipping.filters.allCountries")}</SelectItem>
                {countries.map((country) => (
                  <SelectItem key={country.id} value={country.id}>
                    {country.name}
                  </SelectItem>
                ))}
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
      />

      <ShipmentManageDialog
        shipment={manageTarget}
        open={!!manageTarget}
        onOpenChange={(open) => !open && setManageTarget(null)}
        onUpdated={load}
        shippingCompanies={companies}
      />
    </div>
  );
}

export default function ShippingPage() {
  return (
    <PermissionGate permission="shipping.view">
      <ShippingPageContent />
    </PermissionGate>
  );
}
