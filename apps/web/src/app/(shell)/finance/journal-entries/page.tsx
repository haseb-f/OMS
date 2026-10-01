"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Copy, Eye, Pencil, Plus, Printer, Send, Undo2, Archive } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import {
  SalesDocumentRowActionsMenu,
  SalesListBulkActions,
  type SalesDocumentRowAction,
} from "@/components/sales";
import {
  EnterpriseDataTable,
  exportColumnsFromKeys,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  MultiSelectFilter,
  useMatchingSelection,
  useSelectedRecords,
} from "@/components/shared/data-table";
import {
  journalEntriesService,
  type JournalEntryRow,
  type JournalEntryStatusValue,
} from "@/services/journal-entries-service";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import { createMasterDataService } from "@/services/master-data-service";
import type { JournalRow } from "@/config/master-data/entities";
import {
  JOURNAL_ENTRY_ARCHIVABLE_STATUSES,
  JOURNAL_ENTRY_FILTERABLE_STATUSES,
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { buildJournalEntryPrintPayload } from "@/config/accounting/journal-entry-print";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { usePrintCompany } from "@/components/print/print-brand";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { bulkOutcomeFromIds, reportBulkOutcome } from "@/lib/bulk-run";
import { formatDate, toISODate } from "@/lib/date";
import { PermissionGate } from "@/components/shared/permission-gate";

const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };
const journalsService = createMasterDataService<JournalRow>("/journals");

/** Accounting Foundation (TASK-044 Part 6) — mirrors `purchasing/payments/page.tsx`'s list-page shape (no party column instead of Supplier/Customer). */
function JournalEntriesPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const printCompany = usePrintCompany();
  const { runPrint } = usePrintEngine();

  const [items, setItems] = useState<JournalEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", "createdAt");
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">("sortOrder", "desc");
  const [statusFilter, setStatusFilter] = usePathRestorableState<string[]>("status", []);
  const [journalFilter, setJournalFilter] = usePathRestorableState<string[]>("journal", []);
  const [dateRange, setDateRange] = usePathRestorableState<DateRangeValue>(
    "dateRange",
    EMPTY_DATE_RANGE,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const usersById = useUsersLookup();
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [postTarget, setPostTarget] = useState<JournalEntryRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<JournalEntryRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<JournalEntryRow | null>(null);
  const [bulkArchive, setBulkArchive] = useState<{
    targets: JournalEntryRow[];
    skipped: number;
  } | null>(null);

  useEffect(() => {
    journalsService
      .list({ pageSize: 200 })
      .then((result) => setJournals(result.items))
      .catch(() => setJournals([]));
  }, []);

  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter as JournalEntryStatusValue[],
      journalId: journalFilter,
      dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
      dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
      sortBy,
      sortOrder,
    }),
    [search, statusFilter, journalFilter, dateRange, sortBy, sortOrder],
  );
  const matching = useMatchingSelection(listFilters);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await journalEntriesService.list({ ...listFilters, page, pageSize });
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
        journalEntriesService.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [listFilters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const canCreate = hasPermission("accounting.journal-entries.create");

  const toPrintRow = useCallback(
    (item: JournalEntryRow): Record<string, string> => ({
      entryNumber: item.entryNumber,
      description: item.description ?? "",
      journal: item.journal?.name ?? "",
      totalDebit: item.totalDebit,
      totalCredit: item.totalCredit,
      status: t(JOURNAL_ENTRY_STATUS_LABEL_KEY[item.status]),
      entryDate: formatDate(item.entryDate),
      createdBy: item.createdBy ? (usersById[item.createdBy] ?? "") : "",
    }),
    [t, usersById],
  );

  // The preview tab opens inside the click; runPrint closes it and shows
  // the reason if the record cannot be loaded.
  const handlePrintRow = (row: JournalEntryRow) =>
    void runPrint(
      "document",
      async () => {
        const full = await journalEntriesService.get(row.id);
        return buildJournalEntryPrintPayload(full, {
          companyName: printCompany.name,
          companyLogoUrl: printCompany.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        });
      },
      "errors.printFailed",
    );

  const handlePostConfirmed = async () => {
    if (!postTarget) return;
    try {
      await journalEntriesService.post(postTarget.id);
      toast.success(t("accounting.journalEntries.toasts.posted"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.actionFailed");
    } finally {
      setPostTarget(null);
    }
  };

  const handleReverseConfirmed = async () => {
    if (!reverseTarget) return;
    try {
      const reversed = await journalEntriesService.reverse(reverseTarget.id);
      toast.success(t("accounting.journalEntries.toasts.reversed"));
      void load();
      router.push(`/finance/journal-entries/${reversed.id}`);
    } catch (error) {
      reportApiError(error, "errors.actionFailed");
    } finally {
      setReverseTarget(null);
    }
  };

  const handleDuplicate = async (item: JournalEntryRow) => {
    try {
      const duplicated = await journalEntriesService.duplicate(item.id);
      toast.success(t("accounting.journalEntries.toasts.duplicated"));
      router.push(`/finance/journal-entries/${duplicated.id}`);
    } catch (error) {
      reportApiError(error, "errors.duplicateFailed");
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await journalEntriesService.archive(archiveTarget.id);
      toast.success(t("accounting.journalEntries.toasts.archived"));
      void load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setArchiveTarget(null);
    }
  };

  const columns = useMemo<ColumnDef<JournalEntryRow, unknown>[]>(
    () => [
      {
        id: "entryNumber",
        meta: { titleKey: "accounting.journalEntries.fields.number", identity: true },
        accessorFn: (row) => row.entryNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.entryNumber}</SemanticValue>}
            secondary={
              <SemanticValue kind="date">{formatDate(row.original.entryDate)}</SemanticValue>
            }
          />
        ),
      },
      {
        id: "description",
        meta: { titleKey: "accounting.journalEntries.fields.description" },
        accessorFn: (row) => row.description ?? "—",
        enableSorting: false,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.description ?? "—"}
            secondary={row.original.journal?.name ?? undefined}
          />
        ),
      },
      {
        id: "journal",
        meta: { titleKey: "accounting.journalEntries.fields.journal", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => row.journal?.name ?? "—",
      },
      {
        id: "totalDebit",
        meta: { titleKey: "accounting.journalEntries.fields.totalDebit" },
        accessorFn: (row) => row.totalDebit,
        cell: (info) => <MoneyValue value={info.getValue() as string} />,
      },
      {
        id: "totalCredit",
        meta: { titleKey: "accounting.journalEntries.fields.totalCredit" },
        accessorFn: (row) => row.totalCredit,
        cell: (info) => <MoneyValue value={info.getValue() as string} />,
      },
      {
        id: "status",
        meta: { titleKey: "accounting.journalEntries.fields.status" },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            label={t(JOURNAL_ENTRY_STATUS_LABEL_KEY[row.original.status])}
            tone={JOURNAL_ENTRY_STATUS_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "entryDate",
        meta: { titleKey: "accounting.journalEntries.fields.entryDate", defaultHidden: true },
        accessorFn: (row) => formatDate(row.entryDate),
      },
      {
        id: "createdBy",
        meta: { titleKey: "accounting.journalEntries.fields.createdBy", defaultHidden: true },
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
          const canView = hasPermission("accounting.journal-entries.view");
          const canEdit = hasPermission("accounting.journal-entries.edit");
          const canCreate = hasPermission("accounting.journal-entries.create");
          const canPost = hasPermission("accounting.journal-entries.post");
          const canReverse = hasPermission("accounting.journal-entries.reverse");
          const canArchive = hasPermission("accounting.journal-entries.archive");
          const actions: SalesDocumentRowAction[] = [
            {
              key: "view",
              label: t("common.view"),
              icon: Eye,
              hidden: !canView,
              onSelect: () => router.push(`/finance/journal-entries/${item.id}`),
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !isDraft || !canEdit,
              onSelect: () => router.push(`/finance/journal-entries/${item.id}`),
            },
            {
              key: "print",
              label: t("table.print"),
              icon: Printer,
              hidden: !canView,
              onSelect: () => handlePrintRow(item),
            },
            {
              key: "duplicate",
              label: t("accounting.journalEntries.actions.duplicate"),
              icon: Copy,
              hidden: !canCreate,
              onSelect: () => handleDuplicate(item),
            },
            {
              key: "post",
              label: t("accounting.journalEntries.actions.post"),
              icon: Send,
              hidden: item.status !== "DRAFT" || !canPost,
              separatorBefore: true,
              onSelect: () => setPostTarget(item),
            },
            {
              key: "reverse",
              label: t("accounting.journalEntries.actions.reverse"),
              icon: Undo2,
              hidden: item.status !== "POSTED" || !canReverse,
              destructive: true,
              onSelect: () => setReverseTarget(item),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !JOURNAL_ENTRY_ARCHIVABLE_STATUSES.includes(item.status) || !canArchive,
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
    "entryNumber",
    "description",
    "journal",
    "totalDebit",
    "totalCredit",
    "status",
    "entryDate",
    "createdBy",
  ];

  const { selectedIds, selectedRecords, resolve } = useSelectedRecords({
    items,
    rowSelection,
    fetchAllRows,
    query: matching.queryKey,
  });
  const isArchivable = (item: JournalEntryRow) =>
    JOURNAL_ENTRY_ARCHIVABLE_STATUSES.includes(item.status);
  // Every selected record known -> disable when none is archivable; otherwise
  // the selection reaches past loaded pages and is resolved on click.
  const archiveDisabled =
    selectedRecords.length === selectedIds.length && !selectedRecords.some(isArchivable);

  const handleBulkArchiveRequested = async () => {
    const records = await resolve();
    if (!records) return;
    const targets = records.filter(isArchivable);
    if (targets.length === 0) {
      toast.info(t("table.bulkNoneEligible"));
      return;
    }
    setBulkArchive({ targets, skipped: records.length - targets.length });
  };

  // Shared select-all rules (tables-selection.md): stale results dropped,
  // "All N matching" only for a complete result of the current query.
  const handleSelectAllMatching = () =>
    matching.selectAllMatching(
      () =>
        journalEntriesService.listIds({
          search: search || undefined,
          status: statusFilter as JournalEntryStatusValue[],
          journalId: journalFilter,
          dateFrom: dateRange.from ? toISODate(dateRange.from) : undefined,
          dateTo: dateRange.to ? toISODate(dateRange.to) : undefined,
        }),
      setRowSelection,
    );

  const handleBulkArchiveConfirmed = async () => {
    if (!bulkArchive) return;
    const { targets } = bulkArchive;
    setBulkArchive(null);
    const result = await journalEntriesService.bulkArchive(targets.map((item) => item.id));
    const numberOf = new Map(targets.map((item) => [item.id, item.entryNumber]));
    reportBulkOutcome(
      bulkOutcomeFromIds(result, (id) => numberOf.get(id)),
      (count) => t("accounting.journalEntries.toasts.bulkArchived", { count }),
    );
    setRowSelection({});
    void load();
  };

  return (
    <PageWorkspace
      dense
      title={t("accounting.journalEntries.title")}
      description={t("accounting.journalEntries.description")}
      actions={
        <>
          <ModuleImportButtons importType="MANUAL_JOURNAL_ENTRIES" onImported={load} />
          {canCreate && (
            <EnterpriseButton
              type="button"
              onClick={() => router.push("/finance/journal-entries/new")}
            >
              <Plus />
              {t("accounting.journalEntries.addNew")}
            </EnterpriseButton>
          )}
        </>
      }
    >
      <EnterpriseDataTable
        filterBar={
          <>
            <MultiSelectFilter
              label={t("accounting.journalEntries.filters.status")}
              values={statusFilter}
              onChange={(values) => {
                setStatusFilter(values);
                setPage(1);
              }}
              options={JOURNAL_ENTRY_FILTERABLE_STATUSES.map((status) => ({
                value: status,
                label: t(JOURNAL_ENTRY_STATUS_LABEL_KEY[status]),
              }))}
            />
            <MultiSelectFilter
              label={t("accounting.journalEntries.filters.journal")}
              values={journalFilter}
              onChange={(values) => {
                setJournalFilter(values);
                setPage(1);
              }}
              options={journals.map((journal) => ({
                value: journal.id,
                label: `${journal.code} — ${journal.name}`,
                searchText: `${journal.code} ${journal.name}`,
              }))}
            />
            <EnterpriseDateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
            {(statusFilter.length > 0 ||
              journalFilter.length > 0 ||
              dateRange.from ||
              dateRange.to) && (
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter([]);
                  setJournalFilter([]);
                  setDateRange(EMPTY_DATE_RANGE);
                  setPage(1);
                }}
              >
                {t("table.clearFilters")}
              </EnterpriseButton>
            )}
          </>
        }

        tableId="finance-journal-entries"
        printTitle={t("accounting.journalEntries.title")}
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
          <SalesListBulkActions
            onArchive={() => void handleBulkArchiveRequested()}
            archiveDisabled={archiveDisabled}
            labels={{
              archive: t("common.archive"),
            }}
          />
        }
        onRefresh={load}
        exportColumns={exportColumnsFromKeys(columns, exportColumnKeys, t)}
        onExport={(selectedKeys, labels) =>
          exportRowsToCsv(
            items.map((item) => toPrintRow(item)) as unknown as Record<string, unknown>[],
            selectedKeys,
            "journal-entries.csv",
            labels,
          )
        }
        emptyTitle={t("accounting.journalEntries.empty")}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/finance/journal-entries/${row.id}`}
      />

      <ConfirmationDialog
        open={!!postTarget}
        onOpenChange={(open) => !open && setPostTarget(null)}
        title={t("accounting.journalEntries.confirmPostTitle")}
        description={t("accounting.journalEntries.confirmPostDescription")}
        confirmLabel={t("accounting.journalEntries.actions.post")}
        cancelLabel={t("common.close")}
        onConfirm={handlePostConfirmed}
      />

      <ConfirmationDialog
        open={!!reverseTarget}
        onOpenChange={(open) => !open && setReverseTarget(null)}
        tone="destructive"
        title={t("accounting.journalEntries.confirmReverseTitle")}
        description={t("accounting.journalEntries.confirmReverseDescription")}
        confirmLabel={t("accounting.journalEntries.actions.reverse")}
        cancelLabel={t("common.close")}
        onConfirm={handleReverseConfirmed}
      />

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        tone="destructive"
        title={t("accounting.journalEntries.confirmArchiveTitle")}
        description={t("accounting.journalEntries.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleArchiveConfirmed}
      />

      <ConfirmationDialog
        open={!!bulkArchive}
        onOpenChange={(open) => !open && setBulkArchive(null)}
        tone="destructive"
        title={t("accounting.journalEntries.bulk.archiveConfirmTitle", {
          count: bulkArchive?.targets.length ?? 0,
        })}
        description={
          bulkArchive?.skipped
            ? `${t("accounting.journalEntries.confirmArchiveDescription")} ${t("table.bulkIneligibleSkipped", { count: bulkArchive.skipped })}`
            : t("accounting.journalEntries.confirmArchiveDescription")
        }
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </PageWorkspace>
  );
}

export default function JournalEntriesPage() {
  return (
    <PermissionGate permission="accounting.journal-entries.view">
      <JournalEntriesPageContent />
    </PermissionGate>
  );
}
