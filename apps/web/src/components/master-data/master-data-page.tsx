"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Copy, Eye, History, Pencil, Archive as ArchiveIcon, RotateCcw, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodType } from "zod";
import { EnterpriseButton } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions, type ActionSpec } from "@/components/shared/header-actions";
import { EnterpriseModal, type EnterpriseModalSize } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { KpiCard } from "@/components/shared/kpi-card";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import {
  EnterpriseDataTable,
  exportRowsToCsv,
  exportColumnsFromKeys,
  type MobileRowRenderArgs,
} from "./enterprise-data-table";
import {
  MasterDataForm,
  type MasterDataFormField,
  type MasterDataFormSection,
} from "./master-data-form";
import type { PhoneCountryOption } from "@/components/shared/phone-country-selector";
import {
  getColumnDisplayValue,
  RowActionsMenu,
  toRowSelection,
  useMatchingSelection,
  type RowAction,
  type SelectCustomCountCopy,
} from "@/components/shared/data-table";
import type { MasterDataActivityEntry, MasterDataListParams } from "@/services/master-data-service";
import { usePathRestorableState } from "@/hooks/use-restorable-state";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, toast, reportApiError, reportSuccess } from "@/lib/toast";
import { bulkOutcomeFromIds, reportBulkOutcome } from "@/lib/bulk-run";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  formErrorsFromRhf,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { formatDateTime } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import { fetchAllPages } from "@/lib/fetch-all-pages";

export interface MasterDataEntity {
  id: string;
  deletedAt?: string | null;
}

interface MasterDataService<TEntity> {
  list: (
    params: MasterDataListParams,
  ) => Promise<{ items: TEntity[]; total: number; page: number; pageSize: number }>;
  /** "Select all matching filters" (Part 8) — opt in via `supportsSelectAllMatching`; only wired up once the backend route exists for this entity. */
  listIds?: (params: MasterDataListParams) => Promise<{ ids: string[]; total: number }>;
  create: (dto: Record<string, unknown>) => Promise<TEntity>;
  update: (id: string, dto: Record<string, unknown>) => Promise<TEntity>;
  archive: (id: string) => Promise<TEntity>;
  /** Single-call bulk archive — opt in via `supportsSelectAllMatching`; falls back to N sequential `archive()` calls otherwise. */
  bulkArchive?: (
    ids: string[],
  ) => Promise<{ succeeded: string[]; failed: { id: string; message: string }[] }>;
  restore: (id: string) => Promise<TEntity>;
  activity: (id: string) => Promise<MasterDataActivityEntry[]>;
  get?: (id: string) => Promise<TEntity>;
}

/** Picks the modal size automatically from how many fields the form has — never a tiny dialog, never an oversized one for a 2-field form. */
function pickModalSize(fieldCount: number): EnterpriseModalSize {
  if (fieldCount > 12) return "xl";
  if (fieldCount > 6) return "lg";
  return "md";
}

/**
 * The one page template every Master Data entity renders through (Companies,
 * Branches, Warehouses, ...): PageHeader, EnterpriseDataTable wired to a
 * MasterDataService, a Create/Edit EnterpriseModal (per the Enterprise Modal
 * System — never a dedicated page for a normal CRUD form) built from
 * MasterDataForm, and an Activity Log panel — all config-driven, so an
 * entity page is just this component plus its own columns/fields/schema.
 */
export function MasterDataPage<TEntity extends MasterDataEntity>({
  titleKey,
  descriptionKey,
  tableId,
  icon,
  service,
  columns,
  exportColumnKeys,
  formFields,
  formSections,
  phoneCountries,
  schema,
  defaultValues,
  toFormValues,
  permissionPrefix,
  extraListParams,
  rowLabel,
  stats,
  extraRowActions,
  extraFilters,
  extraFilterCount = 0,
  onClearExtraFilters,
  extraActions,
  headerSecondary,
  headerMore,
  headerMeta,
  primaryAction,
  extraBulkActions,
  defaultSortBy = "name",
  defaultSortOrder = "asc",
  disableArchiveRestore = false,
  supportsSelectAllMatching = false,
  selectCustomCountCopy,
  hideCreateButton = false,
  getRowHref,
  renderGridCard,
  isRowProtected,
  onRecordsChanged,
}: {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  tableId: string;
  icon?: LucideIcon;
  service: MasterDataService<TEntity>;
  columns: ColumnDef<TEntity, unknown>[];
  exportColumnKeys: string[];
  /** Flat single-section field list — used by every plain Master Data entity. Omit in favor of `formSections` for a richer, multi-section dialog (e.g. Customer, TASK-038). */
  formFields?: MasterDataFormField[];
  formSections?: MasterDataFormSection[];
  /** Required whenever `formFields`/`formSections` includes a `"country"`/`"phone"` field — the one shared country list both draw from. */
  phoneCountries?: PhoneCountryOption[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: ZodType<any, any, any>;
  defaultValues: Record<string, unknown>;
  toFormValues?: (entity: TEntity) => Record<string, unknown>;
  permissionPrefix: string;
  extraListParams?: Record<string, string | number | boolean | string[] | undefined>;
  rowLabel: (entity: TEntity) => string;
  /** Opt-in KPI strip above the table — no entity computes these yet, so it only renders when a caller supplies values. */
  stats?: { icon: LucideIcon; label: string; value?: string | number }[];
  /** Opt-in extra row action(s) merged into the row's overflow menu, before the standard Quick Preview/Activity/Edit/Duplicate/Archive set — e.g. a "View Profile" link to a richer detail page most entities don't have. */
  extraRowActions?: (entity: TEntity) => RowAction[];
  /** Opt-in extra filter control(s) rendered next to the "Show Archived" toggle. */
  extraFilters?: ReactNode;
  /** How many of `extraFilters` are engaged — drives the collapsed "Filters" button badge on narrow screens. */
  extraFilterCount?: number;
  /** Resets every `extraFilters` control — the narrow-screen filter sheet's Clear action. */
  onClearExtraFilters?: () => void;
  /** Opt-in extra toolbar action(s) rendered before the internal "+ New" button — e.g. `<ModuleImportButtons />` (TASK-060B Part 5). */
  extraActions?: ReactNode;
  /** Header secondary actions (outline, max 2 inline; collapse into «المزيد» on phones). */
  headerSecondary?: ActionSpec[];
  /** Header overflow («المزيد») actions. */
  headerMore?: ActionSpec[];
  /** Quiet labeled chips in the page header (status counters). */
  headerMeta?: ReactNode;
  /** Replaces the internal "+ New" as the page's ONE primary action (e.g. Leads' own create dialog). */
  primaryAction?: ActionSpec;
  extraBulkActions?: (selectedIds: string[]) => ReactNode;
  /** Initial sort field — defaults to "name" (every existing Master Data entity has one); override for an entity that doesn't (e.g. Leads, sorted by "createdAt"). */
  defaultSortBy?: string;
  /** Initial sort direction — Leads/Orders default newest-first. */
  defaultSortOrder?: "asc" | "desc";
  /**
   * Hides the generic Archive/Restore row actions and the bulk-archive bar
   * — for an entity whose "Archive" is a business-status transition (e.g.
   * Lead's `POST :id/archive` -> `status: ARCHIVED`), not this page's usual
   * soft-delete/`deletedAt` semantics, and which offers its own Archive
   * action instead (via `extraRowActions`) so the two concepts never get
   * shown as if they were the same toggle.
   */
  disableArchiveRestore?: boolean;
  /** Opt-in — only set once the backend's `GET :entity/ids` and `POST :entity/bulk-archive` routes actually exist for this entity (Customers first; see `MasterDataService.listIds`/`bulkArchive`). */
  supportsSelectAllMatching?: boolean;
  /**
   * "Select a specific number" (Smart Selection) — opt-in alongside
   * `supportsSelectAllMatching`; supply this entity's own noun/grammar
   * (e.g. "N leads") and the menu item appears. Omit to keep just
   * "select all matching" (or neither, if `supportsSelectAllMatching` is
   * also false).
   */
  selectCustomCountCopy?: SelectCustomCountCopy;
  /** Suppresses the internal "+ New" button — for a page that renders its own create trigger/dialog instead (e.g. Leads' dual-mode Lead/Order create dialog) while still using this component for list/edit/archive. */
  hideCreateButton?: boolean;
  /** Opt-in detail route for a row — only for an entity that has a real detail page (Customers, Suppliers, Leads); forwarded to the table, where it turns the `meta.identity` column into a link. */
  getRowHref?: (row: TEntity) => string | null | undefined;
  /**
   * Grid-view card template (R7/R9): forwarded to the table, which draws each row with it in Grid
   * view. `actionsNode` is this page's own row-actions menu for that row, so the card and the
   * table's Actions cell share one permission model — pass it to the card's `actionsNode`.
   */
  renderGridCard?: (args: MobileRowRenderArgs<TEntity> & { actionsNode: ReactNode }) => ReactNode;
  /**
   * Business-rule protection (e.g. the default shipping status) — hides
   * Archive only. Uses the existing RowActionsMenu; does not change menu geometry.
   */
  isRowProtected?: (entity: TEntity) => boolean;
  /** Called after create/update/archive/restore so reference-data caches can refresh selectors. */
  onRecordsChanged?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const canCreate = hasPermission(`${permissionPrefix}.create`);
  const canEdit = hasPermission(`${permissionPrefix}.edit`);
  const canView = hasPermission(`${permissionPrefix}.view`);
  const canArchive = !disableArchiveRestore && hasPermission(`${permissionPrefix}.archive`);

  const [items, setItems] = useState<TEntity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = usePathRestorableState("page", 1);
  const [pageSize, setPageSize] = usePathRestorableState("pageSize", 20);
  const [search, setSearch] = usePathRestorableState("search", "");
  const [sortBy, setSortBy] = usePathRestorableState("sortBy", defaultSortBy);
  const [sortOrder, setSortOrder] = usePathRestorableState<"asc" | "desc">(
    "sortOrder",
    defaultSortOrder,
  );
  const [includeArchived, setIncludeArchived] = usePathRestorableState("includeArchived", false);
  const [isLoading, setIsLoading] = useState(true);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isSelectingCustomCount, setIsSelectingCustomCount] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<TEntity | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<TEntity | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TEntity | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<TEntity | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const [activityEntity, setActivityEntity] = useState<TEntity | null>(null);
  const [activityEntries, setActivityEntries] = useState<MasterDataActivityEntry[] | null>(null);
  const [previewEntity, setPreviewEntity] = useState<TEntity | null>(null);

  const extraKey = JSON.stringify(extraListParams ?? {});

  // The modal owns one `useForm()` instance for its whole lifetime — the
  // footer's Save/Save & New buttons (siblings of the field grid inside the
  // modal chrome) submit this same form, so form state is lifted here
  // instead of living inside `MasterDataForm`.
  const form = useForm<Record<string, unknown>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues,
  });

  // Submit feedback (design-system §11.4): inline field errors + a persistent
  // FormErrorSummary at the top of the modal body after a failed submit.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverFormErrors, setServerFormErrors] = useState<FormErrorItem[]>([]);
  const formBodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(formBodyRef);
  const formFieldList = useMemo(
    () => (formSections ? formSections.flatMap((section) => section.fields) : (formFields ?? [])),
    [formSections, formFields],
  );
  const fieldNames = useMemo(() => formFieldList.map((field) => field.name), [formFieldList]);
  const labelFor = useCallback(
    (name: string) => {
      const field = formFieldList.find((candidate) => candidate.name === name);
      return field ? t(field.label) : undefined;
    },
    [formFieldList, t],
  );
  const formErrorItems: FormErrorItem[] = submitAttempted
    ? [
        ...formErrorsFromRhf(form.formState.errors, { labelFor, order: fieldNames }),
        ...serverFormErrors,
      ]
    : [];

  useEffect(() => {
    if (!modalOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitAttempted(false);
    setServerFormErrors([]);
    const source = editingEntity ?? duplicateSource;
    const values = source
      ? toFormValues
        ? toFormValues(source)
        : (source as unknown as Record<string, unknown>)
      : defaultValues;
    form.reset(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editingEntity, duplicateSource]);

  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // `extraKey` stands in for `extraListParams` (a fresh object each render).
  const listFilters = useMemo(
    () => ({
      search: search || undefined,
      sortBy,
      sortOrder,
      includeArchived,
      ...extraListParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, sortBy, sortOrder, includeArchived, extraKey],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await service.list({ ...listFilters, page, pageSize });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilters, page, pageSize]);

  // Print: every row matching the current filters/sort, not just the loaded page.
  const fetchAllRows = useCallback(
    () =>
      fetchAllPages((nextPage, nextPageSize) =>
        service.list({ ...listFilters, page: nextPage, pageSize: nextPageSize }),
      ),
    [service, listFilters],
  );

  useEffect(() => {
    // Fetch-on-dependency-change: the standard data-fetching effect pattern
    // (same as this codebase's own auth-provider.tsx) — setState happens
    // inside `load`'s async body, not synchronously in the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Smart Selection Safety (tables-selection.md) — a selection belongs to the
  // query it was made under: the table clears ANY selection when the
  // filters, search or sort change (`selectionResetKey`), "select all"/
  // "first N" ids that arrive after the query changed are dropped, and "All N
  // matching" is claimed only for a complete result of the current query.
  const matching = useMatchingSelection(listFilters);

  useEffect(() => {
    if (!activityEntity) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivityEntries(null);
      return;
    }
    service
      .activity(activityEntity.id)
      .then(setActivityEntries)
      .catch(() => setActivityEntries([]));
  }, [activityEntity, service]);

  const openCreate = () => {
    setEditingEntity(null);
    setDuplicateSource(null);
    setModalOpen(true);
  };
  const openEdit = useCallback((entity: TEntity) => {
    setEditingEntity(entity);
    setDuplicateSource(null);
    setModalOpen(true);
  }, []);
  const openDuplicate = useCallback((entity: TEntity) => {
    setEditingEntity(null);
    setDuplicateSource(entity);
    setModalOpen(true);
  }, []);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const consumedEditId = useRef<string | null>(null);

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId || !canEdit || consumedEditId.current === editId) return;

    const openFromEntity = (entity: TEntity) => {
      consumedEditId.current = editId;
      openEdit(entity);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("edit");
      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    };

    const fromList = items.find((item) => item.id === editId);
    if (fromList) {
      openFromEntity(fromList);
      return;
    }
    if (!service.get) return;
    void service
      .get(editId)
      .then(openFromEntity)
      .catch(() => undefined);
  }, [searchParams, items, canEdit, service, openEdit, router, pathname]);

  const closeModal = (open: boolean) => {
    setModalOpen(open);
    if (!open) setDuplicateSource(null);
  };

  const submit = (andNew: boolean) => {
    setSubmitAttempted(true);
    setServerFormErrors([]);
    return form.handleSubmit(
      async (values) => {
        setIsSubmitting(true);
        try {
          const saved = editingEntity
            ? await service.update(editingEntity.id, values)
            : await service.create(values);
          // Only after the request resolved — never optimistic. A new record
          // gets a link that reopens it (the page honours `?edit=<id>`).
          setSubmitAttempted(false);
          reportSuccess(t("common.saved"), {
            href: !editingEntity && saved?.id ? `${pathname}?edit=${saved.id}` : undefined,
            navigate: (href) => router.push(href, { scroll: false }),
          });
          onRecordsChanged?.();
          await load();
          form.reset(defaultValues);
          if (!andNew) setModalOpen(false);
        } catch (error) {
          // Field-level server problems go beside their fields; the rest
          // stays in the modal's summary (no toast — the summary is the
          // persistent, in-context explanation).
          setServerFormErrors(
            applyServerFieldErrors(error, form.setError, { knownFields: fieldNames, labelFor }),
          );
          focusFirstInvalid();
        } finally {
          setIsSubmitting(false);
        }
      },
      () => focusFirstInvalid(),
    )();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setIsMutating(true);
    try {
      await service.archive(archiveTarget.id);
      toast.success(t("common.archive"));
      setArchiveTarget(null);
      onRecordsChanged?.();
      await load();
    } catch (error) {
      reportApiError(error, "errors.archiveFailed");
    } finally {
      setIsMutating(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    setIsMutating(true);
    try {
      await service.restore(restoreTarget.id);
      toast.success(t("common.restore"));
      setRestoreTarget(null);
      onRecordsChanged?.();
      await load();
    } catch (error) {
      reportApiError(error, "errors.restoreFailed");
    } finally {
      setIsMutating(false);
    }
  };

  /** A failed record is named by its own code / number / name in the bulk summary. */
  const recordLabel = (id: string): string | null => {
    const record = items.find((item) => item.id === id) as Record<string, unknown> | undefined;
    const label = record?.code ?? record?.partnerNumber ?? record?.name;
    return typeof label === "string" && label ? label : null;
  };

  const bulkArchiveSelected = async () => {
    const ids = Object.keys(rowSelection);
    setIsMutating(true);
    try {
      // One controlled server-side call when the entity supports it (never
      // fan out hundreds/thousands of concurrent requests for a large
      // cross-page or select-all-matching selection); otherwise fall back to
      // the original per-row loop, which every entity already supports.
      if (supportsSelectAllMatching && service.bulkArchive) {
        const result = await service.bulkArchive(ids);
        reportBulkOutcome(bulkOutcomeFromIds(result, recordLabel), () => t("common.archive"));
      } else {
        // Success only for what the server confirmed — a swallowed rejection
        // must never turn into a green toast (usability-financial-reports §5).
        const results = await Promise.allSettled(ids.map((id) => service.archive(id)));
        reportBulkOutcome(
          {
            succeeded: results.filter((result) => result.status === "fulfilled").length,
            failed: results.flatMap((result, index) =>
              result.status === "rejected"
                ? [
                    {
                      label: recordLabel(ids[index]) ?? ids[index],
                      message: apiErrorMessage(result.reason),
                    },
                  ]
                : [],
            ),
          },
          () => t("common.archive"),
        );
      }
      setRowSelection({});
      onRecordsChanged?.();
      await load();
    } finally {
      setIsMutating(false);
    }
  };

  /** "Select all matching filters" (Part 8) — fetches just the IDs matching the current search/filters (never full records) and merges them into the cross-page selection. */
  const handleSelectAllMatching = async () => {
    const listIds = service.listIds;
    if (!listIds) return;
    await matching.selectAllMatching(() => listIds(listFilters), setRowSelection);
  };

  /** "Select a specific number" (Smart Selection) — the first `count` rows by the current filter AND current sort, never an arbitrary subset. Reports when fewer than requested were available. */
  const handleSelectCustomCount = async (count: number) => {
    if (!service.listIds) return;
    setIsSelectingCustomCount(true);
    try {
      const listIds = service.listIds;
      const result = await matching.fetchForCurrentQuery(() =>
        // `limit`: the first `count` ids in the list's own sort (id tie-break).
        listIds({ ...listFilters, limit: count }),
      );
      if (!result) return;
      setRowSelection(toRowSelection(result.ids));
      if (result.ids.length < count) {
        toast.info(t("masterData.bulkSelection.customCountPartial", { count: result.ids.length }));
      }
    } catch (error) {
      reportApiError(error, "errors.selectFailed");
    } finally {
      setIsSelectingCustomCount(false);
    }
  };

  // The row's actions menu — the one control behind both the table's Actions cell and the Grid card.
  const renderRowActions = useCallback(
    (entity: TEntity) => {
      const isArchived = !!entity.deletedAt;
      const extras = extraRowActions?.(entity) ?? [];
      const isViewAction = (action: RowAction) =>
        action.key === "view" || action.key === "view-profile";
      const isDestructiveAction = (action: RowAction) =>
        Boolean(action.destructive) ||
        action.key === "archive" ||
        action.key === "delete" ||
        action.key === "restore";
      const hasExternalView = extras.some(isViewAction);
      const viewExtras = extras.filter(isViewAction);
      const otherExtras = extras.filter(
        (action) => !isViewAction(action) && !isDestructiveAction(action),
      );
      const destructiveExtras = extras.filter(
        (action) => !isViewAction(action) && isDestructiveAction(action),
      );
      const actions: RowAction[] = [
        ...viewExtras,
        {
          key: "quick-preview",
          label: t("common.view"),
          icon: Eye,
          hidden: !canView || hasExternalView,
          onSelect: () => setPreviewEntity(entity),
        },
        {
          key: "edit",
          label: t("common.edit"),
          icon: Pencil,
          onSelect: () => openEdit(entity),
          hidden: !canEdit || isArchived,
        },
        {
          key: "duplicate",
          label: t("table.duplicate"),
          icon: Copy,
          onSelect: () => openDuplicate(entity),
          hidden: !canCreate || isArchived,
        },
        ...otherExtras,
        {
          key: "view-activity",
          label: t("masterData.actions.viewActivity"),
          icon: History,
          onSelect: () => setActivityEntity(entity),
        },
        ...destructiveExtras.map((action, index) => ({
          ...action,
          separatorBefore: index === 0 || action.separatorBefore,
        })),
        {
          key: "archive",
          label: t("common.archive"),
          icon: ArchiveIcon,
          onSelect: () => setArchiveTarget(entity),
          hidden: !canArchive || isArchived || Boolean(isRowProtected?.(entity)),
          destructive: true,
          separatorBefore: destructiveExtras.length === 0,
        },
        {
          key: "restore",
          label: t("common.restore"),
          icon: RotateCcw,
          onSelect: () => setRestoreTarget(entity),
          hidden: !canArchive || !isArchived,
          separatorBefore: true,
        },
      ];
      return <RowActionsMenu actions={actions} label={t("common.actions")} />;
    },
    [
      canEdit,
      canArchive,
      canCreate,
      canView,
      t,
      openEdit,
      openDuplicate,
      extraRowActions,
      isRowProtected,
    ],
  );

  const actionsColumn = useMemo<ColumnDef<TEntity, unknown>>(
    () => ({
      id: "__actions",
      meta: { titleKey: "common.actions" },
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => renderRowActions(row.original),
    }),
    [renderRowActions],
  );

  const tableColumns = useMemo(() => [...columns, actionsColumn], [columns, actionsColumn]);

  const activityTimelineEntries: TimelineEntry[] = (activityEntries ?? []).map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
    status: entry.type === "ARCHIVED" ? "rejected" : entry.type === "CREATED" ? "done" : "pending",
  }));

  const totalFieldCount = formSections
    ? formSections.reduce((sum, section) => sum + section.fields.length, 0)
    : (formFields?.length ?? 0);
  const modalSize = pickModalSize(totalFieldCount);

  return (
    <PageWorkspace
      title={t(titleKey)}
      description={t(descriptionKey)}
      dense
      meta={headerMeta}
      actions={
        <HeaderActions
          inline={extraActions}
          secondary={headerSecondary}
          more={headerMore}
          primary={
            primaryAction ?? {
              key: "add-new",
              label: t("masterData.actions.addNew"),
              icon: Plus,
              hidden: !canCreate || hideCreateButton,
              onSelect: openCreate,
            }
          }
        />
      }
    >
      {stats && stats.length > 0 && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <KpiCard key={stat.label} icon={stat.icon} label={stat.label} value={stat.value} />
          ))}
        </div>
      )}

      {/* Flex column so the table can take the viewport-fill height on lg+. */}
      <div className="relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
        {isMutating && <LoadingOverlay />}
        <EnterpriseDataTable
          activeFilterCount={extraFilterCount + (includeArchived ? 1 : 0)}
          onClearFilters={() => {
            onClearExtraFilters?.();
            setIncludeArchived(false);
          }}
          filterBar={
            <>
              {extraFilters}
              <Toggle size="default" pressed={includeArchived} onPressedChange={setIncludeArchived}>
                {t("common.showArchived")}
              </Toggle>
            </>
          }
          tableId={tableId}
          printTitle={t(titleKey)}
          columns={tableColumns}
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
          onSelectAllMatching={
            supportsSelectAllMatching && service.listIds ? handleSelectAllMatching : undefined
          }
          isSelectingAllMatching={matching.isSelectingAllMatching}
          selectCustomCount={
            supportsSelectAllMatching && service.listIds && selectCustomCountCopy
              ? {
                  onSelect: handleSelectCustomCount,
                  isSelecting: isSelectingCustomCount,
                  copy: selectCustomCountCopy,
                }
              : undefined
          }
          bulkActions={
            <>
              {extraBulkActions?.(Object.keys(rowSelection))}
              {canArchive && (
                <EnterpriseButton
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={bulkArchiveSelected}
                >
                  {t("common.archive")}
                </EnterpriseButton>
              )}
            </>
          }
          onRefresh={load}
          getRowHref={getRowHref}
          renderGridCard={
            renderGridCard
              ? (args) => renderGridCard({ ...args, actionsNode: renderRowActions(args.row) })
              : undefined
          }
          exportColumns={exportColumnsFromKeys(columns, exportColumnKeys, t)}
          onExport={(selectedKeys, labels) =>
            exportRowsToCsv(
              items as unknown as Record<string, unknown>[],
              selectedKeys,
              `${tableId}.csv`,
              labels,
            )
          }
        />
      </div>

      <EnterpriseModal
        open={modalOpen}
        onOpenChange={closeModal}
        size={modalSize}
        icon={icon}
        title={
          editingEntity
            ? t("common.edit")
            : duplicateSource
              ? t("table.duplicate")
              : t("masterData.actions.addNew")
        }
        description={t(descriptionKey)}
        isDirty={isDirty}
        errorSummary={<FormErrorSummary errors={formErrorItems} />}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              onClick={requestClose}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            {!editingEntity && (
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={() => submit(true)}
                disabled={isSubmitting}
              >
                {t("masterData.actions.saveAndNew")}
              </EnterpriseButton>
            )}
            <EnterpriseButton type="button" onClick={() => submit(false)} disabled={isSubmitting}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div ref={formBodyRef}>
          {formSections ? (
            <MasterDataForm form={form} sections={formSections} countries={phoneCountries} />
          ) : (
            <MasterDataForm
              form={form}
              fields={formFields ?? []}
              sectionTitle={t("common.generalInformation")}
              columns={modalSize === "xl" ? 3 : 2}
              countries={phoneCountries}
            />
          )}
        </div>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.confirmArchiveTitle")}
        description={
          archiveTarget && `${rowLabel(archiveTarget)} — ${t("common.confirmArchiveDescription")}`
        }
        onConfirm={confirmArchive}
        confirmLabel={t("common.archive")}
      />

      <ConfirmationDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={t("common.confirmRestoreTitle")}
        description={
          restoreTarget && `${rowLabel(restoreTarget)} — ${t("common.confirmRestoreDescription")}`
        }
        onConfirm={confirmRestore}
        confirmLabel={t("common.restore")}
      />

      <Sheet open={!!previewEntity} onOpenChange={(open) => !open && setPreviewEntity(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{previewEntity && rowLabel(previewEntity)}</SheetTitle>
            <SheetDescription>{t("masterData.actions.quickPreview")}</SheetDescription>
          </SheetHeader>
          {previewEntity && (
            <dl className="flex flex-col gap-3 overflow-y-auto px-4 pb-4">
              {columns.map((column) => (
                <div
                  key={column.id}
                  className="flex items-center justify-between gap-4 border-b border-border pb-2"
                >
                  <dt className="text-caption text-muted-foreground">
                    {column.meta?.titleKey ? t(column.meta.titleKey) : (column.id ?? "")}
                  </dt>
                  <dd className="text-sm font-medium">
                    {getColumnDisplayValue(column, previewEntity, t)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!activityEntity} onOpenChange={(open) => !open && setActivityEntity(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("common.activityLog")}</SheetTitle>
            <SheetDescription>{activityEntity && rowLabel(activityEntity)}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {activityEntries === null ? (
              <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
            ) : activityTimelineEntries.length === 0 ? (
              <p className="text-caption text-muted-foreground">{t("common.noActivity")}</p>
            ) : (
              <AuditTimeline entries={activityTimelineEntries} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </PageWorkspace>
  );
}
