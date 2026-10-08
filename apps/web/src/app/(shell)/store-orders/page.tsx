"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RowSelectionState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { EnterpriseButton } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SyncButton } from "@/components/shared/sync-button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import {
  MultiSelectFilter,
  toRowSelection,
  useBulkLimitGuard,
  useMatchingSelection,
} from "@/components/shared/data-table";
import { BULK_LIMITS } from "@/lib/bulk-limits";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import {
  STORE_ORDER_STOCK_STATUSES,
  type StoreOrderStockStatus,
} from "@/components/store-orders/stock/stock-api";
import {
  DECLARED_STATUS_VALUES,
  declaredStatusLabelKey,
} from "@/components/payments/declaration/declaration-status";
import {
  EnterpriseDataTable,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import { StoreOrdersBulkActions } from "@/components/store-orders/store-orders-bulk-actions";
import { BulkShippingStatusDialog } from "@/components/store-orders/bulk-shipping-status-dialog";
import { StoreOrderCreateDialog } from "@/components/store-orders/store-order-create-dialog";
// R7 hook (workstream B): self-contained, permission-gated button — the only line this page needs.
import {
  AdvancedCustomerLookupButton,
  AdvancedLookupFallback,
} from "@/components/store-orders/advanced-customer-lookup-dialog";
import { DuplicateReviewDialog } from "@/components/store-orders/duplicate-review-dialog";
import { LegacyPhoneDuplicatesDialog } from "@/components/store-orders/legacy-phone-duplicates-dialog";
import { buildStoreOrderDetailRegions } from "@/components/store-orders/store-order-expanded-detail";
import { StoreOrderGridCard } from "@/components/store-orders/store-order-grid-card";
import type { CompanyOrderPermissions } from "@/config/store-orders/order-list-next-action";
import { StoreOrderMobileCard } from "@/components/store-orders/store-order-mobile-card";
import {
  storeOrdersService,
  type StoreOrderDeclaredPaymentStatusValue,
  type StoreOrderPaymentStatusValue,
  type StoreOrderRow,
  type StoreOrderShippingStageValue,
  type StoreOrderSourceValue,
  type CostState,
} from "@/services/store-orders-service";
import { shippingService } from "@/services/shipping-service";
import {
  buildStoreOrderColumns,
  storeOrderExportColumnList,
  storeOrderExportColumns,
  storeOrderPrintRow,
  storeOrderRowActions,
} from "@/config/store-orders/order-columns";
import {
  PAYMENT_STATUS_LABEL_KEY,
  PAYMENT_STATUS_VALUES,
  SHIPPING_STAGE_LABEL_KEY,
  SHIPPING_STAGE_VALUES,
} from "@/config/store-orders/status";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { toISODate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgentFilter } from "@/components/agents/agent-options";
import { fetchAllPages } from "@/lib/fetch-all-pages";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

function StoreOrdersPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUserContext();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();
  const canCreate = hasPermission("store-orders.create");
  const canBulkShipping = hasPermission("shipping.manage");
  const canViewProfitability = hasPermission("orders.profitability.view");
  const canReviewDuplicates = hasPermission("store-orders.duplicate_review");
  const [legacyDuplicatesOpen, setLegacyDuplicatesOpen] = useState(false);

  const [items, setItems] = useState<StoreOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [paymentStatusFilter, setPaymentStatusFilter] = usePathRestorableState<string[]>(
    "paymentStatus",
    [],
  );
  const [shippingStageFilter, setShippingStageFilter] = usePathRestorableState<string[]>(
    "shippingStage",
    [],
  );
  // What Sales declared — separate from the Finance-verified payment status.
  const [declaredStatusFilter, setDeclaredStatusFilter] = usePathRestorableState<string>(
    "declaredPaymentStatus",
    "",
  );
  const [sourceFilter, setSourceFilter] = usePathRestorableState<string[]>("source", []);
  // R15 — physical stock state (reserved / short / in transit / …).
  const [stockStatusFilter, setStockStatusFilter] = usePathRestorableState<string[]>(
    "stockStatus",
    [],
  );
  // Agents milestone — orders of one owner agent.
  const [agentFilter, setAgentFilter] = usePathRestorableState<string>("agentId", "");
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [costStateFilter, setCostStateFilter] = usePathRestorableState<string[]>("costState", []);
  const [lossMakingFilter, setLossMakingFilter] = usePathRestorableState("lossMaking", false);
  // Round 5 Spec 1B — the duplicate review queue (reviewers see every scope).
  const [duplicateReviewFilter, setDuplicateReviewFilter] = usePathRestorableState(
    "duplicateReview",
    false,
  );
  const [reviewTarget, setReviewTarget] = useState<StoreOrderRow | null>(null);
  const [profitabilityFilterCapped, setProfitabilityFilterCapped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingCustomCount, setIsSelectingCustomCount] = useState(false);
  const [bulkShippingDialogOpen, setBulkShippingDialogOpen] = useState(false);
  const [isBulkUpdatingShipping, setIsBulkUpdatingShipping] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogSession, setCreateDialogSession] = useState(0);
  const [archiveTarget, setArchiveTarget] = useState<StoreOrderRow | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  // Cross-page selection cache (mirrors sales/orders/page.tsx) — `items`
  // only ever holds the current page, so a row selected earlier keeps its
  // real data available for bulk print/export after paging away.
  const [itemsCache, setItemsCache] = useState<Record<string, StoreOrderRow>>({});

  const listParams = useCallback(
    () => ({
      search: search || undefined,
      paymentStatus: paymentStatusFilter as StoreOrderPaymentStatusValue[],
      declaredPaymentStatus: declaredStatusFilter
        ? (declaredStatusFilter as StoreOrderDeclaredPaymentStatusValue)
        : undefined,
      shippingStage: shippingStageFilter as StoreOrderShippingStageValue[],
      stockStatus: stockStatusFilter as StoreOrderStockStatus[],
      source: sourceFilter as StoreOrderSourceValue[],
      agentId: agentFilter || undefined,
      ...(canReviewDuplicates && duplicateReviewFilter
        ? { duplicateReviewStatus: "PENDING" as const }
        : {}),
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      ...(canViewProfitability
        ? {
            includeProfitability: true,
            costState: costStateFilter as CostState[],
            lossMaking: lossMakingFilter || undefined,
          }
        : {}),
    }),
    [
      search,
      paymentStatusFilter,
      declaredStatusFilter,
      shippingStageFilter,
      stockStatusFilter,
      sourceFilter,
      agentFilter,
      canReviewDuplicates,
      duplicateReviewFilter,
      dateRange,
      canViewProfitability,
      costStateFilter,
      lossMakingFilter,
    ],
  );

  const listFilters = useMemo(
    () => ({
      ...listParams(),
      sortBy,
      sortOrder,
    }),
    [listParams, sortBy, sortOrder],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await storeOrdersService.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
      setProfitabilityFilterCapped(!!result.profitabilityFilterCapped);
      setItemsCache((cache) => ({
        ...cache,
        ...Object.fromEntries(result.items.map((item) => [item.id, item])),
      }));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t("table.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [listFilters, page, pageSize, t]);

  // Print: every row matching the current filters/sort, not just the loaded page.
  // The profitability filter is evaluated server-side over a bounded window;
  // when any page reports that cap, the printout states it too.
  const fetchAllRows = useCallback(async () => {
    let filterCapped = false;
    const result = await fetchAllPages(async (nextPage, nextPageSize) => {
      const pageResult = await storeOrdersService.list({
        ...listFilters,
        page: nextPage,
        pageSize: nextPageSize,
      });
      filterCapped ||= !!pageResult.profitabilityFilterCapped;
      return pageResult;
    });
    return filterCapped
      ? { ...result, notes: [t("storeOrders.profitability.filterCappedNotice")] }
      : result;
  }, [listFilters, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Selection Snapshot Safety (tables-selection.md) — a selection belongs to
  // the query it was made under: the table clears ANY selection when the
  // filters, search or sort change (`selectionResetKey`), in-flight
  // "select all"/"first N" results for an old query are dropped, and "All N
  // matching" is claimed only for a complete result of the current query.
  const matching = useMatchingSelection(listFilters);
  const withinBulkLimit = useBulkLimitGuard();

  const toPrintRow = useCallback(
    (item: StoreOrderRow): Record<string, string> => storeOrderPrintRow(item, t),
    [t],
  );

  // One set of row handlers for the table's actions cell and the Grid card menu.
  const rowHandlers = useMemo(
    () => ({
      onView: (row: StoreOrderRow) => router.push(`/store-orders/${row.id}`),
      onEdit: (row: StoreOrderRow) => router.push(`/store-orders/${row.id}`),
      onArchive: (row: StoreOrderRow) => setArchiveTarget(row),
      onResolveDuplicate: (row: StoreOrderRow) => setReviewTarget(row),
    }),
    [router],
  );
  const columns = useMemo(
    () => buildStoreOrderColumns({ ...rowHandlers, includeProfitability: canViewProfitability }),
    [rowHandlers, canViewProfitability],
  );
  // The Grid card's next step uses the same permissions as the detail header.
  const canEditOrders = hasPermission("store-orders.edit");
  const nextActionPermissions = useMemo<CompanyOrderPermissions>(
    () => ({
      reviewDuplicates: canReviewDuplicates,
      confirmCustomerTotal: hasPermission("agents.edit"),
      setAmounts: canEditOrders,
      declarePayment: canEditOrders || hasPermission("sales.receipts.create"),
      manageShipping: canEditOrders || hasPermission("shipping.edit"),
      recordPickup: canEditOrders || hasPermission("shipping.edit"),
      generateInvoice: hasPermission("store-orders.generate_invoice") || canEditOrders,
    }),
    [canReviewDuplicates, canEditOrders, hasPermission],
  );

  const selectedIds = Object.keys(rowSelection);
  const selectedItems = selectedIds.map((id) => itemsCache[id]).filter((item) => !!item);

  // Bulk print/export must cover EVERY selected id, not only rows this
  // browser has loaded — an "all matching" / "first N" selection holds ids
  // from pages never visited. Missing rows are fetched with the current
  // query; if some still can't be resolved (row cap, or the query moved on),
  // the job stops with a reason instead of printing fewer rows than stated.
  const resolveSelectedItems = async (): Promise<StoreOrderRow[] | null> => {
    if (selectedIds.length === 0) return null;
    if (selectedItems.length === selectedIds.length) return selectedItems;
    try {
      const selected = new Set(selectedIds);
      const { rows } = await fetchAllPages(async (nextPage, nextPageSize) =>
        storeOrdersService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      );
      const matched = rows.filter((row) => selected.has(row.id));
      setItemsCache((cache) => ({
        ...cache,
        ...Object.fromEntries(matched.map((item) => [item.id, item])),
      }));
      if (matched.length !== selectedIds.length) {
        toast.error(t("table.bulkRowsUnavailable"), {
          description: t("table.bulkRowsUnavailableDetail", {
            resolved: matched.length,
            selected: selectedIds.length,
          }),
        });
        return null;
      }
      return matched;
    } catch (error) {
      reportApiError(error, "table.loadFailed");
      return null;
    }
  };

  // `runPrint` opens the preview tab inside the click, before the await.
  const handleBulkPrint = () => {
    if (selectedIds.length === 0) return;
    void runPrint("list", async () => {
      const selectedItems = await resolveSelectedItems();
      if (!selectedItems) return null;
      return {
        variant: "list" as const,
        title: t("storeOrders.title"),
        company: {
          name: printCompany.name,
          logoUrl: printCompany.logoUrl ?? null,
        },
        printedByName: user?.fullName ?? null,
        columns: storeOrderExportColumnList(t),
        rows: selectedItems.map(toPrintRow),
      };
    });
  };

  const handleBulkExport = async () => {
    const selectedItems = await resolveSelectedItems();
    if (!selectedItems) return;
    exportRowsToCsv(
      selectedItems.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
      storeOrderExportColumns,
      "store-orders-selected.csv",
    );
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      await storeOrdersService.archive(archiveTarget.id);
      toast.success(t("storeOrders.toasts.archived"));
      setArchiveTarget(null);
      void load();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsArchiving(false);
    }
  };

  // Same filters as the list — including Cost State / Loss-Making, which the
  // server applies to `/ids` exactly as it does to the list.
  const handleSelectAllMatching = () =>
    matching.selectAllMatching(() => storeOrdersService.listIds(listFilters), setRowSelection);

  /** "Select a specific number" — the first `count` orders by the current filter AND current sort (never an arbitrary subset). Reports when fewer than requested were available. */
  const handleSelectCustomCount = async (count: number) => {
    setIsSelectingCustomCount(true);
    try {
      const result = await matching.fetchForCurrentQuery(() =>
        storeOrdersService.listIds({ ...listFilters, limit: count }),
      );
      if (!result) return;
      setRowSelection(toRowSelection(result.ids));
      if (result.ids.length < count) {
        toast.info(t("storeOrders.bulkSelection.customCountPartial", { count: result.ids.length }));
      }
    } catch (error) {
      reportApiError(error, "errors.selectFailed");
    } finally {
      setIsSelectingCustomCount(false);
    }
  };

  /**
   * Bulk "Change Shipping Status" — server enforces `shipping.manage`
   * (same guard `BulkShippingStatusDialog`'s button hides behind); this
   * only reports what actually happened, including partial failures. Named
   * order numbers for a handful of failures give the user something
   * actionable instead of a bare count.
   */
  const handleBulkShippingStatusChange = async (shippingStatusId: string) => {
    if (!withinBulkLimit(selectedIds.length, BULK_LIMITS.storeOrderShippingStatusMax)) return;
    setIsBulkUpdatingShipping(true);
    try {
      const results = await shippingService.bulkSetStatus(selectedIds, shippingStatusId);
      const succeeded = results.filter((row) => row.success).length;
      const failed = results.filter((row) => !row.success);
      if (failed.length === 0) {
        toast.success(t("storeOrders.bulkShipping.successMessage", { count: succeeded }));
      } else {
        const MAX_LISTED = 5;
        const labels = failed
          .slice(0, MAX_LISTED)
          .map((row) => itemsCache[row.id]?.internalOrderId ?? row.id);
        const remaining = failed.length - labels.length;
        const failedDetail =
          remaining > 0 ? `${labels.join("، ")} +${remaining}` : labels.join("، ");
        const failureText = `${t("storeOrders.bulkShipping.failureMessage", { count: failed.length })}: ${failedDetail}`;
        if (succeeded === 0) {
          toast.error(failureText);
        } else {
          toast.success(t("storeOrders.bulkShipping.successMessage", { count: succeeded }), {
            description: failureText,
          });
        }
      }
      setRowSelection({});
      void load();
    } catch (error) {
      reportApiError(error, "errors.updateFailed");
    } finally {
      setIsBulkUpdatingShipping(false);
    }
  };

  return (
    <PageWorkspace
      dense
      title={t("storeOrders.title")}
      description={t("storeOrders.description")}
      actions={
        <HeaderActions
          inline={
            <>
              <SyncButton sourceType="STORE_ORDERS" onSynced={load} />
              {/* R15 (D15-16) — shown only to holders of store-orders.import (or import-center.manage). */}
              <ModuleImportButtons importType="STORE_ORDERS" onImported={load} />
            </>
          }
          primary={{
            key: "create",
            label: t("storeOrders.createDialog.trigger"),
            icon: Plus,
            hidden: !canCreate,
            onSelect: () => {
              setCreateDialogSession((session) => session + 1);
              setCreateDialogOpen(true);
            },
          }}
        />
      }
    >
      {profitabilityFilterCapped && (
        <p className="text-caption text-muted-foreground">
          {t("storeOrders.profitability.filterCappedNotice")}
        </p>
      )}
      <EnterpriseDataTable
        // Own bulk Print/Export (store-order print rows, cross-page resolve).
        builtInSelectionActions={false}
        tableId="store-orders"
        printTitle={t("storeOrders.title")}
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
        searchPlaceholder={t("storeOrders.searchPlaceholder")}
        isLoading={isLoading}
        error={loadError}
        onRetry={load}
        renderExpandedRegions={(row) =>
          buildStoreOrderDetailRegions(row, t, () => router.push(`/store-orders/${row.id}`))
        }
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <StoreOrderGridCard
            order={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            href={`/store-orders/${row.id}`}
            permissions={nextActionPermissions}
            actions={storeOrderRowActions(row, rowHandlers, hasPermission, t)}
          />
        )}
        renderMobileRow={({ row, selected, onToggleSelected, expanded, onToggleExpanded }) => (
          <StoreOrderMobileCard
            order={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            onView={(order) => router.push(`/store-orders/${order.id}`)}
            onEdit={(order) => router.push(`/store-orders/${order.id}`)}
            onArchive={(order) => setArchiveTarget(order)}
          />
        )}
        filterBar={
          <>
            <MultiSelectFilter
              label={t("storeOrders.filters.paymentStatus")}
              values={paymentStatusFilter}
              onChange={(values) => {
                setPaymentStatusFilter(values);
                setPage(1);
              }}
              options={PAYMENT_STATUS_VALUES.map((status) => ({
                value: status,
                label: t(PAYMENT_STATUS_LABEL_KEY[status]),
              }))}
            />
            <SelectFilter
              label={t("paymentDeclaration.filter.declaredStatus")}
              value={declaredStatusFilter}
              onChange={(value) => {
                setDeclaredStatusFilter(value);
                setPage(1);
              }}
              options={DECLARED_STATUS_VALUES.map((status) => ({
                value: status,
                label: t(declaredStatusLabelKey(status)),
              }))}
            />
            <MultiSelectFilter
              label={t("storeOrders.filters.shippingStage")}
              values={shippingStageFilter}
              onChange={(values) => {
                setShippingStageFilter(values);
                setPage(1);
              }}
              options={SHIPPING_STAGE_VALUES.map((stage) => ({
                value: stage,
                label: t(SHIPPING_STAGE_LABEL_KEY[stage]),
              }))}
            />
            <MultiSelectFilter
              label={t("storeOrderStock.statusLabel")}
              values={stockStatusFilter}
              onChange={(values) => {
                setStockStatusFilter(values);
                setPage(1);
              }}
              options={STORE_ORDER_STOCK_STATUSES.map((status) => ({
                value: status,
                label: t(`storeOrderStock.status.${status}`),
              }))}
            />
            <MultiSelectFilter
              label={t("storeOrders.filters.source")}
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
            <AgentFilter
              value={agentFilter}
              onChange={(value) => {
                setAgentFilter(value);
                setPage(1);
              }}
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            {canViewProfitability && (
              <>
                <MultiSelectFilter
                  label={t("storeOrders.profitability.costState")}
                  values={costStateFilter}
                  onChange={(values) => {
                    setCostStateFilter(values);
                    setPage(1);
                  }}
                  options={(["COMPLETE", "PARTIAL", "UNKNOWN"] as CostState[]).map((state) => ({
                    value: state,
                    label: t(`storeOrders.profitability.costStateValues.${state}`),
                  }))}
                />
                <Toggle
                  size="default"
                  pressed={lossMakingFilter}
                  onPressedChange={(pressed) => {
                    setLossMakingFilter(pressed);
                    setPage(1);
                  }}
                >
                  {t("storeOrders.profitability.lossMakingFilter")}
                </Toggle>
              </>
            )}
            {canReviewDuplicates && (
              <EnterpriseButton
                type="button"
                variant={duplicateReviewFilter ? "secondary" : "outline"}
                size="sm"
                aria-pressed={duplicateReviewFilter}
                onClick={() => {
                  setDuplicateReviewFilter(!duplicateReviewFilter);
                  setPage(1);
                }}
              >
                {t("orderDuplicates.review.filter")}
              </EnterpriseButton>
            )}
            {canReviewDuplicates && (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLegacyDuplicatesOpen(true)}
              >
                {t("orderDuplicates.review.legacy.action")}
              </EnterpriseButton>
            )}
            {(paymentStatusFilter.length > 0 ||
              declaredStatusFilter ||
              shippingStageFilter.length > 0 ||
              stockStatusFilter.length > 0 ||
              sourceFilter.length > 0 ||
              agentFilter ||
              costStateFilter.length > 0 ||
              lossMakingFilter ||
              duplicateReviewFilter ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPaymentStatusFilter([]);
                  setDeclaredStatusFilter("");
                  setShippingStageFilter([]);
                  setStockStatusFilter([]);
                  setSourceFilter([]);
                  setAgentFilter("");
                  setCostStateFilter([]);
                  setLossMakingFilter(false);
                  setDuplicateReviewFilter(false);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
            <AdvancedCustomerLookupButton />
          </>
        }
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        selectionResetKey={matching.queryKey}
        matchingSelection={matching.matchingSelection}
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAllMatching={matching.isSelectingAllMatching}
        selectCustomCount={{
          onSelect: handleSelectCustomCount,
          isSelecting: isSelectingCustomCount,
          copy: {
            title: t("storeOrders.bulkSelection.customCountTitle"),
            countLabel: t("storeOrders.bulkSelection.customCountLabel"),
            hint: (count) => t("storeOrders.bulkSelection.customCountHint", { count }),
            confirmLabel: t("storeOrders.bulkSelection.customCountConfirm"),
            invalidMessage: t("storeOrders.bulkSelection.customCountInvalid"),
          },
        }}
        bulkActions={
          <StoreOrdersBulkActions
            onPrint={handleBulkPrint}
            onExport={handleBulkExport}
            onChangeShippingStatus={() => {
              if (withinBulkLimit(selectedIds.length, BULK_LIMITS.storeOrderShippingStatusMax)) {
                setBulkShippingDialogOpen(true);
              }
            }}
            canChangeShippingStatus={canBulkShipping}
            labels={{
              print: t("table.print"),
              export: t("table.export"),
              changeShippingStatus: t("storeOrders.bulkShipping.button"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={storeOrderExportColumnList(t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "store-orders.csv",
            labels,
          )
        }
        emptyTitle={t("storeOrders.empty")}
        searchEmptyExtra={(term) => <AdvancedLookupFallback term={term} />}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/store-orders/${row.id}`}
      />

      <StoreOrderCreateDialog
        key={createDialogSession}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={() => void load()}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        tone="destructive"
        title={t("common.confirmArchiveTitle")}
        description={t("common.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        isConfirming={isArchiving}
        onConfirm={() => void handleArchive()}
      />

      {canReviewDuplicates && (
        <LegacyPhoneDuplicatesDialog
          open={legacyDuplicatesOpen}
          onOpenChange={setLegacyDuplicatesOpen}
        />
      )}

      {canReviewDuplicates && (
        <DuplicateReviewDialog
          orderId={reviewTarget?.id ?? null}
          open={!!reviewTarget}
          onOpenChange={(open) => {
            if (!open) setReviewTarget(null);
          }}
          onResolved={() => void load()}
        />
      )}

      <BulkShippingStatusDialog
        open={bulkShippingDialogOpen}
        onOpenChange={setBulkShippingDialogOpen}
        selectedCount={selectedIds.length}
        isSubmitting={isBulkUpdatingShipping}
        onConfirm={handleBulkShippingStatusChange}
      />
    </PageWorkspace>
  );
}

export default function StoreOrdersPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrdersPageContent />
    </PermissionGate>
  );
}
