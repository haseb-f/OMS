"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Eye, Plus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
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
  getColumnDisplayValue,
  MultiEntityFilter,
  RowActionsMenu,
  SelectFilter,
  type RowAction,
} from "@/components/shared/data-table";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import { AssemblyCreateDialog } from "@/components/inventory/assembly-create-dialog";
import {
  ASSEMBLY_PERMISSIONS,
  ASSEMBLY_STATUSES,
  ASSEMBLY_STATUS_TONE,
  assemblyHref,
  canViewAssemblyCost,
} from "@/config/inventory/assembly";
import { AssemblyOrderGridCard } from "@/config/inventory/inventory-grid-cards";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { cachedLookup } from "@/lib/lookup-cache";
import { formatDateTime, toISODate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import {
  assemblyService,
  type AssemblyListParams,
  type AssemblyOrder,
  type AssemblyStatus,
} from "@/services/assembly-service";
import { productsService, type ProductRow } from "@/services/products-service";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

/** Cost columns: withheld by the API (`null`) for a caller without cost visibility. */
const COST_COLUMN_IDS: ReadonlySet<string> = new Set(["unitCost", "totalCost"]);

function AssemblyListPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission(ASSEMBLY_PERMISSIONS.create);
  const canViewCost = canViewAssemblyCost(hasPermission);

  const [items, setItems] = useState<AssemblyOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [statusFilter, setStatusFilter] = usePathRestorableState("status", "");
  const [productFilter, setProductFilter] = useState<ProductRow[]>([]);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [createOpen, setCreateOpen] = useState(false);

  const filters = useMemo<AssemblyListParams>(
    () => ({
      productId: productFilter[0]?.id,
      status: (statusFilter || undefined) as AssemblyStatus | undefined,
      from: dateRange.from ? toISODate(dateRange.from) : undefined,
      to: dateRange.to ? toISODate(dateRange.to) : undefined,
    }),
    [productFilter, statusFilter, dateRange],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await assemblyService.list({ ...filters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Print: every order matching the filters, not only the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        assemblyService.list({ ...filters, page: nextPage, pageSize: nextPageSize }),
      ),
    [filters],
  );

  const rowActions = useCallback(
    (row: AssemblyOrder): RowAction[] => [
      {
        key: "view",
        label: t("common.view"),
        icon: Eye,
        onSelect: () => router.push(assemblyHref(row.id)),
      },
    ],
    [router, t],
  );

  const allColumns = useMemo<ColumnDef<AssemblyOrder, unknown>[]>(
    () => [
      {
        id: "assemblyNumber",
        header: t("assembly.fields.number"),
        meta: { titleKey: "assembly.fields.number", stacked: true },
        accessorFn: (row) => row.assemblyNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.assemblyNumber}</SemanticValue>}
            secondary={formatDateTime(row.original.createdAt)}
          />
        ),
      },
      {
        id: "product",
        header: t("assembly.fields.product"),
        meta: { titleKey: "assembly.fields.product", stacked: true, type: "name" },
        accessorFn: (row) => row.product.name,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.product.name}
            secondary={<SemanticValue kind="id">{row.original.product.sku}</SemanticValue>}
          />
        ),
      },
      {
        id: "warehouse",
        header: t("assembly.fields.warehouse"),
        meta: { titleKey: "assembly.fields.warehouse" },
        accessorFn: (row) => `${row.warehouse.code} — ${row.warehouse.name}`,
      },
      {
        id: "quantity",
        header: t("assembly.fields.quantity"),
        meta: { titleKey: "assembly.fields.quantity", type: "quantity" },
        accessorFn: (row) => row.quantity,
      },
      {
        id: "unitCost",
        header: t("assembly.fields.unitCost"),
        meta: { titleKey: "assembly.fields.unitCost", type: "money" },
        accessorFn: (row) =>
          row.unitCost === null ? "—" : formatAmount(row.unitCost, { decimals: 4 }),
        cell: ({ row }) =>
          row.original.unitCost === null ? (
            "—"
          ) : (
            <span dir="ltr" className="num">
              {formatAmount(row.original.unitCost, { decimals: 4 })}
            </span>
          ),
      },
      {
        id: "totalCost",
        header: t("assembly.fields.totalCost"),
        meta: { titleKey: "assembly.fields.totalCost", type: "money" },
        accessorFn: (row) => (row.totalCost === null ? "—" : formatAmount(row.totalCost)),
        cell: ({ row }) =>
          row.original.totalCost === null ? "—" : <MoneyValue value={row.original.totalCost} />,
      },
      {
        id: "status",
        header: t("assembly.fields.status"),
        meta: {
          titleKey: "assembly.fields.status",
          displayValue: (row, tr) => tr(`assembly.status.${row.status}`),
        },
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
          <StatusBadge
            tone={ASSEMBLY_STATUS_TONE[row.original.status]}
            label={t(`assembly.status.${row.original.status}`)}
          />
        ),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActionsMenu label={t("common.actions")} actions={rowActions(row.original)} />
        ),
      },
    ],
    [t, rowActions],
  );

  // Cost columns exist only for a caller who may see them — never a column of dashes.
  const columns = useMemo(
    () =>
      canViewCost
        ? allColumns
        : allColumns.filter((column) => !(column.id && COST_COLUMN_IDS.has(column.id))),
    [allColumns, canViewCost],
  );
  const exportKeys = columns.map((column) => column.id!).filter((id) => id !== "__actions");

  const hasFilters =
    productFilter.length > 0 || !!statusFilter || !!dateRange.from || !!dateRange.to;

  return (
    <PageWorkspace
      dense
      title={t("assembly.title")}
      description={t("assembly.description")}
      actions={
        <HeaderActions
          primary={{
            key: "new-assembly",
            label: t("assembly.newAssembly"),
            icon: Plus,
            hidden: !canCreate,
            onSelect: () => setCreateOpen(true),
          }}
        />
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiEntityFilter
              label={t("assembly.fields.product")}
              values={productFilter}
              // The API filters on one product: the latest choice replaces the previous one.
              onChange={(values) => {
                setProductFilter(values.slice(-1));
                setPage(1);
              }}
              onSearch={async (search) => {
                const params = {
                  search: search || undefined,
                  pageSize: 20,
                  isInventoryItem: true,
                  supplyMethod: "ASSEMBLED" as const,
                };
                const result = await cachedLookup(`products:${JSON.stringify(params)}`, () =>
                  productsService.catalog(params),
                );
                return result.items.filter((product) => product.supplyMethod === "ASSEMBLED");
              }}
              getId={(product) => product.id}
              getTitle={(product) => product.displayName || product.name}
              getSubtitle={(product) => product.sku}
              subtitleDir="ltr"
            />
            <SelectFilter
              label={t("assembly.fields.status")}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              options={ASSEMBLY_STATUSES.map((status) => ({
                value: status,
                label: t(`assembly.status.${status}`),
              }))}
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(value) => {
                setDateRange(value);
                setPage(1);
              }}
            />
          </>
        }
        activeFilterCount={
          (productFilter.length > 0 ? 1 : 0) +
          (statusFilter ? 1 : 0) +
          (dateRange.from || dateRange.to ? 1 : 0)
        }
        onClearFilters={
          hasFilters
            ? () => {
                setProductFilter([]);
                setStatusFilter("");
                setDateRange(EMPTY_DATE_RANGE);
                setPage(1);
              }
            : undefined
        }
        tableId="inventory-assembly"
        printTitle={t("assembly.title")}
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
        fetchAllRows={fetchAllRows}
        isLoading={isLoading}
        emptyTitle={t("assembly.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => assemblyHref(row.id)}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        selectionResetKey={filters}
        onRefresh={() => void load()}
        renderGridCard={({ row, selected, onToggleSelected }) => (
          <AssemblyOrderGridCard
            row={row}
            selected={selected}
            onToggleSelected={onToggleSelected}
            actions={rowActions(row)}
          />
        )}
        exportColumns={exportColumnsFromKeys(columns, exportKeys, t)}
        onExport={(keys, labels) =>
          exportRowsToCsv(
            items.map((row) =>
              Object.fromEntries(columns.map((c) => [c.id!, getColumnDisplayValue(c, row, t)])),
            ),
            keys,
            "assembly-orders.csv",
            labels,
          )
        }
      />

      <AssemblyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void load()}
      />
    </PageWorkspace>
  );
}

export default function AssemblyListPage() {
  return (
    <PermissionGate permission={ASSEMBLY_PERMISSIONS.view}>
      <AssemblyListPageContent />
    </PermissionGate>
  );
}
