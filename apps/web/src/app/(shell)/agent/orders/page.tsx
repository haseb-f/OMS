"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { SelectFilter } from "@/components/shared/data-table";
import { PortalOrderGridCard } from "@/components/store-orders/store-order-grid-card";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  PORTAL_ORDER_EXPORT_COLUMNS,
  buildPortalOrderColumns,
  portalOrderExportRow,
} from "@/config/agent-portal/order-columns";
import {
  DECLARED_STATUSES,
  FINANCE_STATUSES,
  FULFILLMENT_STATUS_CODES,
} from "@/config/agent-portal/labels";
import {
  agentPortalService,
  type DeclaredPaymentStatus,
  type FinancePaymentStatus,
  type FulfillmentMethod,
  type PortalOrderRow,
} from "@/services/agent-portal-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError } from "@/lib/toast";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { toISODate } from "@/lib/date";

const EMPTY_RANGE: DateRangeValue = { from: null, to: null };

/** Agent portal orders (server mode; export/print load every matching row, 200 per request). */
export default function AgentOrdersPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const [items, setItems] = useState<PortalOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [declared, setDeclared] = usePathRestorableState<string>("declared", "");
  const [finance, setFinance] = usePathRestorableState<string>("finance", "");
  const [fulfillment, setFulfillment] = usePathRestorableState<string>("fulfillment", "");
  const [method, setMethod] = usePathRestorableState<string>("method", "");
  const [range, setRange] = usePathRestorableState<DateRangeValue>("range", EMPTY_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      declaredPaymentStatus: (declared || undefined) as DeclaredPaymentStatus | undefined,
      paymentStatus: (finance || undefined) as FinancePaymentStatus | undefined,
      fulfillmentStatusCode: fulfillment || undefined,
      fulfillmentMethod: (method || undefined) as FulfillmentMethod | undefined,
      from: range.from ? toISODate(new Date(range.from)) : undefined,
      to: range.to ? toISODate(new Date(range.to)) : undefined,
    }),
    [search, declared, finance, fulfillment, method, range],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentPortalService.orders.list({ ...filters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "agentPortal.common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        agentPortalService.orders.list({
          ...filters,
          page: nextPage,
          pageSize: Math.min(nextPageSize, 200),
        }),
      ),
    [filters],
  );

  const columns = useMemo(() => buildPortalOrderColumns(), []);
  const resetPage = () => setPage(1);
  const activeFilters =
    (declared ? 1 : 0) +
    (finance ? 1 : 0) +
    (fulfillment ? 1 : 0) +
    (method ? 1 : 0) +
    (range.from || range.to ? 1 : 0);

  return (
    <PageWorkspace
      dense
      title={t("agentPortal.orders.title")}
      description={t("agentPortal.orders.description")}
      actions={
        <HeaderActions
          primary={{
            key: "create",
            label: t("agentPortal.orders.new"),
            icon: Plus,
            hidden: !hasPermission("agent.orders.create"),
            onSelect: () => router.push("/agent/orders/new"),
          }}
        />
      }
    >
      <EnterpriseDataTable
        tableId="agent-portal-orders"
        printTitle={t("agentPortal.orders.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          resetPage();
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          resetPage();
        }}
        searchPlaceholder={t("agentPortal.orders.searchPlaceholder")}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        fetchAllRows={fetchAllRows}
        filterBar={
          <>
            <SelectFilter
              label={t("agentPortal.orders.filters.declared")}
              value={declared}
              onChange={(value) => {
                setDeclared(value);
                resetPage();
              }}
              options={DECLARED_STATUSES.map((value) => ({
                value,
                label: t(`agentPortal.status.declared.${value}`),
              }))}
            />
            <SelectFilter
              label={t("agentPortal.orders.filters.finance")}
              value={finance}
              onChange={(value) => {
                setFinance(value);
                resetPage();
              }}
              options={FINANCE_STATUSES.map((value) => ({
                value,
                label: t(`agentPortal.status.finance.${value}`),
              }))}
            />
            <SelectFilter
              label={t("agentPortal.orders.filters.fulfillment")}
              value={fulfillment}
              onChange={(value) => {
                setFulfillment(value);
                resetPage();
              }}
              options={FULFILLMENT_STATUS_CODES.map((value) => ({
                value,
                label: t(`agentPortal.status.fulfillmentCodes.${value}`),
              }))}
            />
            <SelectFilter
              label={t("agentPortal.orders.filters.method")}
              value={method}
              onChange={(value) => {
                setMethod(value);
                resetPage();
              }}
              options={(["SHIPPING", "PICKUP"] as const).map((value) => ({
                value,
                label: t(`agentPortal.status.method.${value}`),
              }))}
            />
            <EnterpriseDateRangePicker
              value={range}
              onChange={(next) => {
                setRange(next);
                resetPage();
              }}
            />
          </>
        }
        activeFilterCount={activeFilters}
        onClearFilters={() => {
          setDeclared("");
          setFinance("");
          setFulfillment("");
          setMethod("");
          setRange(EMPTY_RANGE);
          resetPage();
        }}
        exportColumns={exportColumnsFromKeys(columns, PORTAL_ORDER_EXPORT_COLUMNS, t)}
        onExport={(keys, labels) =>
          void fetchAllRows()
            .then(({ rows }) =>
              exportRowsToCsv(
                rows.map((row) => portalOrderExportRow(row, t, locale)),
                keys,
                "agent-orders.csv",
                labels,
              ),
            )
            .catch((error) => reportApiError(error, "agentPortal.common.loadFailed"))
        }
        emptyTitle={t("agentPortal.orders.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/agent/orders/${row.id}`}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <PortalOrderGridCard
            order={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={`/agent/orders/${row.id}`}
            canDeclarePayment={hasPermission("agent.payments.declare")}
            actions={[
              {
                key: "view",
                label: t("common.view"),
                icon: Eye,
                onSelect: () => router.push(`/agent/orders/${row.id}`),
              },
            ]}
          />
        )}
      />
    </PageWorkspace>
  );
}
