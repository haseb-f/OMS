"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Copy, Eye, Pencil, Plus, Printer, Send, Undo2, Archive } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
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
  journalEntriesService,
  type JournalEntryRow,
  type JournalEntryStatusValue,
} from "@/services/journal-entries-service";
import { usersService } from "@/services/users-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { JournalRow } from "@/config/master-data/entities";
import {
  JOURNAL_ENTRY_ARCHIVABLE_STATUSES,
  JOURNAL_ENTRY_FILTERABLE_STATUSES,
  JOURNAL_ENTRY_STATUS_LABEL_KEY,
  JOURNAL_ENTRY_STATUS_TONE,
} from "@/config/accounting/status";
import { buildJournalEntryPrintPayload } from "@/config/accounting/journal-entry-print";
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
const journalsService = createMasterDataService<JournalRow>("/journals");

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

/** Accounting Foundation (TASK-044 Part 6) — mirrors `purchasing/payments/page.tsx`'s list-page shape (no party column instead of Supplier/Customer). */
function JournalEntriesPageContent() {
  const { t } = useLocale();
  const router = useRouter();
  const { hasPermission, user } = useUserContext();
  const { activeCompany } = useCompany();
  const { printList, printDocument } = usePrintEngine();

  const [items, setItems] = useState<JournalEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [journalFilter, setJournalFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [usersById, setUsersById] = useState<Record<string, string>>({});
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [postTarget, setPostTarget] = useState<JournalEntryRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<JournalEntryRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<JournalEntryRow | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  useEffect(() => {
    usersService
      .list()
      .then((users) => setUsersById(Object.fromEntries(users.map((u) => [u.id, u.fullName]))))
      .catch(() => setUsersById({}));
    journalsService
      .list({ pageSize: 200 })
      .then((result) => setJournals(result.items))
      .catch(() => setJournals([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await journalEntriesService.list({
        search: search || undefined,
        status: (statusFilter || undefined) as JournalEntryStatusValue | undefined,
        journalId: journalFilter || undefined,
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
      toast.error(error instanceof ApiError ? error.message : "Failed to load journal entries.");
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, journalFilter, dateRange, page, pageSize, sortBy, sortOrder]);

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

  const handlePrintRow = async (row: JournalEntryRow) => {
    try {
      const full = await journalEntriesService.get(row.id);
      printDocument(
        buildJournalEntryPrintPayload(full, {
          companyName: activeCompany?.name ?? siteConfig.fullName,
          companyLogoUrl: activeCompany?.logoUrl ?? null,
          printedByName: user?.fullName ?? null,
          t,
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to print journal entry.");
    }
  };

  const handlePostConfirmed = async () => {
    if (!postTarget) return;
    try {
      await journalEntriesService.post(postTarget.id);
      toast.success(t("accounting.journalEntries.toasts.posted"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to post journal entry.");
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
      toast.error(error instanceof ApiError ? error.message : "Failed to reverse journal entry.");
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
      toast.error(error instanceof ApiError ? error.message : "Failed to duplicate journal entry.");
    }
  };

  const handleArchiveConfirmed = async () => {
    if (!archiveTarget) return;
    try {
      await journalEntriesService.archive(archiveTarget.id);
      toast.success(t("accounting.journalEntries.toasts.archived"));
      void load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to archive journal entry.");
    } finally {
      setArchiveTarget(null);
    }
  };

  const columns = useMemo<ColumnDef<JournalEntryRow, unknown>[]>(
    () => [
      {
        id: "entryNumber",
        meta: { titleKey: "accounting.journalEntries.fields.number" },
        accessorFn: (row) => row.entryNumber,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "description",
        meta: { titleKey: "accounting.journalEntries.fields.description" },
        accessorFn: (row) => row.description ?? "—",
        enableSorting: false,
      },
      {
        id: "journal",
        meta: { titleKey: "accounting.journalEntries.fields.journal" },
        enableSorting: false,
        accessorFn: (row) => row.journal?.name ?? "—",
      },
      {
        id: "totalDebit",
        meta: { titleKey: "accounting.journalEntries.fields.totalDebit" },
        accessorFn: (row) => row.totalDebit,
        cell: (info) => <MoneyCell value={info.getValue() as string} />,
      },
      {
        id: "totalCredit",
        meta: { titleKey: "accounting.journalEntries.fields.totalCredit" },
        accessorFn: (row) => row.totalCredit,
        cell: (info) => <MoneyCell value={info.getValue() as string} />,
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
        meta: { titleKey: "accounting.journalEntries.fields.entryDate" },
        accessorFn: (row) => formatDate(row.entryDate),
      },
      {
        id: "createdBy",
        meta: { titleKey: "accounting.journalEntries.fields.createdBy" },
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
              label: t("accounting.journalEntries.open"),
              icon: Eye,
              onSelect: () => router.push(`/finance/journal-entries/${item.id}`),
            },
            {
              key: "edit",
              label: t("common.edit"),
              icon: Pencil,
              hidden: !isDraft,
              onSelect: () => router.push(`/finance/journal-entries/${item.id}`),
            },
            {
              key: "print",
              label: t("table.print"),
              icon: Printer,
              onSelect: () => handlePrintRow(item),
            },
            {
              key: "duplicate",
              label: t("accounting.journalEntries.actions.duplicate"),
              icon: Copy,
              onSelect: () => handleDuplicate(item),
            },
            {
              key: "post",
              label: t("accounting.journalEntries.actions.post"),
              icon: Send,
              hidden: item.status !== "DRAFT",
              separatorBefore: true,
              onSelect: () => setPostTarget(item),
            },
            {
              key: "reverse",
              label: t("accounting.journalEntries.actions.reverse"),
              icon: Undo2,
              hidden: item.status !== "POSTED",
              destructive: true,
              onSelect: () => setReverseTarget(item),
            },
            {
              key: "archive",
              label: t("common.archive"),
              icon: Archive,
              hidden: !JOURNAL_ENTRY_ARCHIVABLE_STATUSES.includes(item.status),
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

  const selectedItems = items.filter((item) => rowSelection[item.id]);
  const selectedArchivable = selectedItems.filter((item) =>
    JOURNAL_ENTRY_ARCHIVABLE_STATUSES.includes(item.status),
  );

  const handleBulkPrint = () => {
    if (selectedItems.length === 0) return;
    printList({
      variant: "list",
      title: t("accounting.journalEntries.title"),
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
      "journal-entries-selected.csv",
    );
  };

  const handleBulkArchiveConfirmed = async () => {
    setBulkArchiveOpen(false);
    let failures = 0;
    for (const item of selectedArchivable) {
      try {
        await journalEntriesService.archive(item.id);
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      toast.success(
        t("accounting.journalEntries.toasts.bulkArchived", { count: selectedArchivable.length }),
      );
    } else {
      toast.error(t("accounting.journalEntries.toasts.bulkArchiveFailed", { count: failures }));
    }
    setRowSelection({});
    void load();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("accounting.journalEntries.title")}
        subtitle={t("accounting.journalEntries.description")}
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
                <SelectValue placeholder={t("accounting.journalEntries.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("accounting.journalEntries.filters.allStatuses")}
                </SelectItem>
                {JOURNAL_ENTRY_FILTERABLE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(JOURNAL_ENTRY_STATUS_LABEL_KEY[status])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={journalFilter || "__all__"}
              onValueChange={(v) => {
                setJournalFilter(v === "__all__" ? "" : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder={t("accounting.journalEntries.filters.journal")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t("accounting.journalEntries.filters.allJournals")}
                </SelectItem>
                {journals.map((journal) => (
                  <SelectItem key={journal.id} value={journal.id}>
                    {journal.code} — {journal.name}
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
        tableId="finance-journal-entries"
        printTitle={t("accounting.journalEntries.title")}
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
            "journal-entries.csv",
          )
        }
        emptyTitle={t("accounting.journalEntries.empty")}
        getRowId={(row) => row.id}
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
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        tone="destructive"
        title={t("accounting.journalEntries.bulk.archiveConfirmTitle", {
          count: selectedArchivable.length,
        })}
        description={t("accounting.journalEntries.confirmArchiveDescription")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.close")}
        onConfirm={handleBulkArchiveConfirmed}
      />
    </div>
  );
}

export default function JournalEntriesPage() {
  return (
    <PermissionGate permission="accounting.journal-entries.view">
      <JournalEntriesPageContent />
    </PermissionGate>
  );
}
