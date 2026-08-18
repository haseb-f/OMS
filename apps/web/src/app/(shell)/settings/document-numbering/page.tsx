"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Hash, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { SemanticValue } from "@/components/shared/semantic-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { ModalSection, ModalFieldFullWidth } from "@/components/shared/modal-section";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseDataTable,
  exportRowsToCsv,
} from "@/components/master-data/enterprise-data-table";
import {
  numberSeriesService,
  type NumberSeriesInput,
  type NumberSeriesRow,
} from "@/services/number-series-service";
import { renderNumberTemplatePreview, NUMBER_TEMPLATE_PLACEHOLDERS } from "@/lib/number-template";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const seriesSchema = z.object({
  documentType: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]*$/, "UPPER_SNAKE_CASE only, e.g. SALES_ORDER"),
  label: z.string().min(1),
  docCode: z.string().min(1),
  template: z.string().min(1),
  padding: z.number().int().min(1).max(12),
  separator: z.string().optional(),
  nextNumber: z.number().int().min(1),
  yearReset: z.boolean(),
  monthReset: z.boolean(),
  dayReset: z.boolean(),
  active: z.boolean(),
});
type SeriesFormValues = z.infer<typeof seriesSchema>;

const defaultValues: SeriesFormValues = {
  documentType: "",
  label: "",
  docCode: "",
  template: "{DOC}-{YEAR}-{SEQ}",
  padding: 6,
  separator: "-",
  nextNumber: 1,
  yearReset: true,
  monthReset: false,
  dayReset: false,
  active: true,
};

function resetRuleTone(row: NumberSeriesRow): "day" | "month" | "year" | "none" {
  if (row.dayReset) return "day";
  if (row.monthReset) return "month";
  if (row.yearReset) return "year";
  return "none";
}

export default function SettingsDocumentNumberingPage() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("numbering.manage");

  const [items, setItems] = useState<NumberSeriesRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("label");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<NumberSeriesRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetTarget, setResetTarget] = useState<NumberSeriesRow | null>(null);
  const [disableTarget, setDisableTarget] = useState<NumberSeriesRow | null>(null);

  const load = () => {
    setIsLoading(true);
    numberSeriesService
      .list()
      .then(setItems)
      .catch((error) =>
        toast.error(error instanceof ApiError ? error.message : t("common.noResults")),
      )
      .finally(() => setIsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const form = useForm<SeriesFormValues>({
    resolver: zodResolver(seriesSchema),
    defaultValues,
  });

  useEffect(() => {
    if (!modalOpen) return;
    form.reset(
      editingRow
        ? {
            documentType: editingRow.documentType,
            label: editingRow.label,
            docCode: editingRow.docCode,
            template: editingRow.template,
            padding: editingRow.padding,
            separator: editingRow.separator,
            nextNumber: editingRow.nextNumber,
            yearReset: editingRow.yearReset,
            monthReset: editingRow.monthReset,
            dayReset: editingRow.dayReset,
            active: editingRow.active,
          }
        : defaultValues,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, editingRow]);

  const isDirty = form.formState.isDirty;
  const watched = form.watch();
  const livePreview = renderNumberTemplatePreview(watched.template || "", {
    docCode: watched.docCode || "",
    seq: watched.nextNumber || 1,
    padding: watched.padding || 1,
  });

  const setResetRule = (rule: "yearReset" | "monthReset" | "dayReset", checked: boolean) => {
    form.setValue("yearReset", rule === "yearReset" && checked, { shouldDirty: true });
    form.setValue("monthReset", rule === "monthReset" && checked, { shouldDirty: true });
    form.setValue("dayReset", rule === "dayReset" && checked, { shouldDirty: true });
  };

  const insertPlaceholder = (token: string) => {
    form.setValue("template", `${form.getValues("template") || ""}${token}`, { shouldDirty: true });
  };

  const openCreate = () => {
    setEditingRow(null);
    setModalOpen(true);
  };
  const openEdit = (row: NumberSeriesRow) => {
    setEditingRow(row);
    setModalOpen(true);
  };

  const submit = form.handleSubmit(async (values) => {
    setIsSubmitting(true);
    try {
      if (editingRow) {
        const { documentType: _documentType, ...updatePayload } = values;
        void _documentType;
        await numberSeriesService.update(editingRow.id, updatePayload);
      } else {
        const payload: NumberSeriesInput = values;
        await numberSeriesService.create(payload);
      }
      toast.success(t("common.save"));
      setModalOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  });

  const toggleActive = async (row: NumberSeriesRow) => {
    if (row.active) {
      setDisableTarget(row);
      return;
    }
    try {
      await numberSeriesService.update(row.id, { active: true });
      toast.success(t("settings.documentNumbering.toggleSuccess"));
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  const confirmDisable = async () => {
    if (!disableTarget) return;
    try {
      await numberSeriesService.update(disableTarget.id, { active: false });
      toast.success(t("settings.documentNumbering.toggleSuccess"));
      setDisableTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  const confirmReset = async () => {
    if (!resetTarget) return;
    try {
      await numberSeriesService.update(resetTarget.id, { nextNumber: 1 });
      toast.success(t("settings.documentNumbering.resetSuccess"));
      setResetTarget(null);
      load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  const filteredSorted = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? items.filter((row) =>
          [row.label, row.documentType, row.docCode, row.template]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : items;
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sortBy as keyof NumberSeriesRow];
      const bv = b[sortBy as keyof NumberSeriesRow];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [items, search, sortBy, sortOrder]);

  const paged = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  const columns = useMemo<ColumnDef<NumberSeriesRow, unknown>[]>(
    () => [
      {
        id: "label",
        meta: { titleKey: "settings.documentNumbering.table.label" },
        accessorFn: (row) => row.label,
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.label}
            secondary={<SemanticValue kind="id">{row.original.documentType}</SemanticValue>}
          />
        ),
      },
      {
        id: "documentType",
        meta: { titleKey: "settings.documentNumbering.table.documentType", defaultHidden: true },
        accessorFn: (row) => row.documentType,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "template",
        meta: { titleKey: "settings.documentNumbering.table.template" },
        accessorFn: (row) => row.template,
        cell: (info) => (
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {info.getValue() as string}
          </code>
        ),
      },
      {
        id: "preview",
        meta: { titleKey: "settings.documentNumbering.table.preview" },
        enableSorting: false,
        cell: ({ row }) => (
          <span dir="ltr">
            {renderNumberTemplatePreview(row.original.template, {
              docCode: row.original.docCode,
              seq: row.original.nextNumber,
              padding: row.original.padding,
            })}
          </span>
        ),
      },
      {
        id: "padding",
        meta: { titleKey: "settings.documentNumbering.table.padding", defaultHidden: true },
        accessorFn: (row) => row.padding,
      },
      {
        id: "reset",
        meta: { titleKey: "settings.documentNumbering.table.reset", defaultHidden: true },
        enableSorting: false,
        cell: ({ row }) => {
          const rule = resetRuleTone(row.original);
          return (
            <StatusBadge
              tone={rule === "none" ? "neutral" : "info"}
              label={t(`settings.documentNumbering.resetRule.${rule}`)}
            />
          );
        },
      },
      {
        id: "active",
        meta: { titleKey: "settings.documentNumbering.table.status" },
        accessorFn: (row) => row.active,
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.active ? "success" : "neutral"}
            label={t(
              row.original.active
                ? "settings.documentNumbering.status.active"
                : "settings.documentNumbering.status.disabled",
            )}
          />
        ),
      },
      {
        id: "__actions",
        meta: { titleKey: "common.actions" },
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canManage ? (
            <div className="flex items-center gap-1">
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openEdit(row.original)}
              >
                {t("common.edit")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleActive(row.original)}
              >
                {t(
                  row.original.active
                    ? "settings.documentNumbering.actions.disable"
                    : "settings.documentNumbering.actions.enable",
                )}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setResetTarget(row.original)}
              >
                {t("settings.documentNumbering.actions.resetNext")}
              </EnterpriseButton>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, t],
  );

  return (
    <PageWorkspace
      title={t("settings.documentNumbering.title")}
      description={t("settings.documentNumbering.description")}
      actions={
        canManage && (
          <EnterpriseButton type="button" onClick={openCreate}>
            <Plus />
            {t("settings.documentNumbering.addNew")}
          </EnterpriseButton>
        )
      }
    >
      {!canManage && (
        <p className="text-caption text-muted-foreground">
          {t("settings.documentNumbering.readOnlyNotice")}
        </p>
      )}

      <EnterpriseDataTable
        tableId="settings-document-numbering"
        columns={columns}
        data={paged}
        totalCount={filteredSorted.length}
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
        rowSelection={{}}
        onRowSelectionChange={() => undefined}
        onRefresh={load}
        exportColumns={[
          { key: "label", label: t("settings.documentNumbering.table.label") },
          { key: "documentType", label: t("settings.documentNumbering.table.documentType") },
          { key: "docCode", label: t("settings.documentNumbering.fields.docCode") },
          { key: "template", label: t("settings.documentNumbering.table.template") },
          { key: "nextNumber", label: t("settings.documentNumbering.fields.nextNumber") },
          { key: "padding", label: t("settings.documentNumbering.table.padding") },
          { key: "active", label: t("settings.documentNumbering.table.status") },
        ]}
        onExport={(selectedKeys) =>
          exportRowsToCsv(
            filteredSorted as unknown as Record<string, unknown>[],
            selectedKeys,
            "number-series.csv",
          )
        }
      />

      <EnterpriseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        size="lg"
        icon={Hash}
        title={
          editingRow
            ? t("settings.documentNumbering.editTitle")
            : t("settings.documentNumbering.addTitle")
        }
        description={t("settings.documentNumbering.description")}
        isDirty={isDirty}
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
            <EnterpriseButton type="button" onClick={() => submit()} disabled={isSubmitting}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <Form {...form}>
          <div className="flex flex-col gap-5">
            <ModalSection title={t("common.generalInformation")} columns={2}>
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.documentType")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        dir="ltr"
                        disabled={!!editingRow}
                        onChange={(e) =>
                          field.onChange(e.target.value.toUpperCase().replace(/\s+/g, "_"))
                        }
                        placeholder="SALES_ORDER"
                      />
                    </FormControl>
                    <p className="text-caption text-muted-foreground">
                      {t("settings.documentNumbering.fields.documentTypeHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.label")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Sales Order" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="docCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.docCode")}</FormLabel>
                    <FormControl>
                      <Input {...field} dir="ltr" placeholder="SO" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="padding"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.padding")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="separator"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.separator")}</FormLabel>
                    <FormControl>
                      <Input {...field} dir="ltr" value={field.value ?? ""} placeholder="-" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nextNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.documentNumbering.fields.nextNumber")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </ModalSection>

            <ModalSection title={t("settings.documentNumbering.fields.resetRules")} columns={3}>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={watched.yearReset}
                  onCheckedChange={(checked) => setResetRule("yearReset", checked === true)}
                />
                <span className="text-body">
                  {t("settings.documentNumbering.fields.yearReset")}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={watched.monthReset}
                  onCheckedChange={(checked) => setResetRule("monthReset", checked === true)}
                />
                <span className="text-body">
                  {t("settings.documentNumbering.fields.monthReset")}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={watched.dayReset}
                  onCheckedChange={(checked) => setResetRule("dayReset", checked === true)}
                />
                <span className="text-body">{t("settings.documentNumbering.fields.dayReset")}</span>
              </label>
            </ModalSection>

            <ModalSection title={t("settings.documentNumbering.fields.template")} columns={2}>
              <ModalFieldFullWidth>
                <FormField
                  control={form.control}
                  name="template"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.documentNumbering.fields.template")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          dir="ltr"
                          className="font-mono"
                          placeholder="{DOC}-{YEAR}-{SEQ}"
                        />
                      </FormControl>
                      <p className="text-caption text-muted-foreground">
                        {t("settings.documentNumbering.fields.templateHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </ModalFieldFullWidth>
              <ModalFieldFullWidth>
                <div dir="ltr" className="flex flex-wrap gap-1.5">
                  {NUMBER_TEMPLATE_PLACEHOLDERS.map((token) => (
                    <EnterpriseButton
                      key={token}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-mono"
                      onClick={() => insertPlaceholder(token)}
                    >
                      {token}
                    </EnterpriseButton>
                  ))}
                </div>
              </ModalFieldFullWidth>
              <ModalFieldFullWidth>
                <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-muted/40 p-3">
                  <span className="text-caption text-muted-foreground">
                    {t("settings.documentNumbering.fields.livePreview")}
                  </span>
                  <span dir="ltr" className="font-mono text-card-title font-semibold">
                    {livePreview || "—"}
                  </span>
                </div>
              </ModalFieldFullWidth>
            </ModalSection>
          </div>
        </Form>
      </EnterpriseModal>

      <ConfirmationDialog
        open={!!disableTarget}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        title={t("settings.documentNumbering.confirmDisableTitle")}
        description={
          disableTarget &&
          `${disableTarget.label} — ${t("settings.documentNumbering.confirmDisableDescription")}`
        }
        onConfirm={confirmDisable}
        confirmLabel={t("settings.documentNumbering.actions.disable")}
        destructive
      />

      <ConfirmationDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title={t("settings.documentNumbering.confirmResetTitle")}
        description={
          resetTarget &&
          `${resetTarget.label} — ${t("settings.documentNumbering.confirmResetDescription")}`
        }
        onConfirm={confirmReset}
        confirmLabel={t("settings.documentNumbering.actions.resetNext")}
        destructive
      />
    </PageWorkspace>
  );
}
