"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, UploadCloud } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseBadge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { ImportJobWizard } from "./import-job-wizard";
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { importJobsService, type ImportJobRow } from "@/services/import-jobs-service";
import { useUsersList } from "@/hooks/use-reference-data";
import { IMPORT_JOB_STATUS_LABEL_KEY, IMPORT_JOB_STATUS_TONE } from "@/config/import-center/status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";
import { downloadBlob } from "@/lib/download";
import { ApiError } from "@/services/api-client";
import type { MessageKey } from "@/i18n/translate";
import { PermissionGate } from "@/components/shared/permission-gate";

/**
 * Import Center dashboard (TASK-056 Part 1) — the single future entry point
 * for importing operational and accounting data. Type cards drive the
 * Mapping Engine's field schema from `ImportTypeRegistryService` (the same
 * plug-in registry pattern as the Posting Engine's providers); the history
 * table is every `ImportJob` ever run.
 */
function ImportCenterPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("import-center.manage");

  const [types, setTypes] = useState<ImportTypeDefinition[]>([]);
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const users = useUsersList();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTypeDef, setWizardTypeDef] = useState<ImportTypeDefinition | null>(null);
  const [wizardJobId, setWizardJobId] = useState<string | undefined>(undefined);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const items = await importJobsService.list();
      setJobs(items);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load import jobs.");
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    importTypesService
      .list()
      .then(setTypes)
      .catch(() => setTypes([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs();
  }, [loadJobs]);

  const typeByKey = useMemo(() => new Map(types.map((type) => [type.type, type])), [types]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user.fullName])), [users]);

  const startImport = (typeDef: ImportTypeDefinition) => {
    setWizardTypeDef(typeDef);
    setWizardJobId(undefined);
    setWizardOpen(true);
  };

  const viewJob = (job: ImportJobRow) => {
    const typeDef = typeByKey.get(job.importType);
    if (!typeDef) return;
    setWizardTypeDef(typeDef);
    setWizardJobId(job.id);
    setWizardOpen(true);
  };

  const downloadTemplate = async (typeDef: ImportTypeDefinition) => {
    try {
      const blob = await importTypesService.downloadTemplate(typeDef.type);
      downloadBlob(blob, `${typeDef.type.toLowerCase().replace(/_/g, "-")}-import-template.xlsx`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to download template.");
    }
  };

  const columns = useMemo<ColumnDef<ImportJobRow, unknown>[]>(
    () => [
      {
        id: "importType",
        header: t("importCenter.table.importType"),
        meta: { titleKey: "importCenter.table.importType" },
        accessorFn: (row) => {
          const typeDef = typeByKey.get(row.importType);
          return typeDef ? t(typeDef.labelKey as MessageKey) : row.importType;
        },
        cell: (info) => info.getValue() as string,
      },
      {
        id: "status",
        header: t("importCenter.table.status"),
        meta: { titleKey: "importCenter.table.status" },
        accessorFn: (row) => row.status,
        cell: (info) => {
          const status = info.getValue() as ImportJobRow["status"];
          return (
            <StatusBadge
              label={t(IMPORT_JOB_STATUS_LABEL_KEY[status])}
              tone={IMPORT_JOB_STATUS_TONE[status]}
            />
          );
        },
      },
      {
        id: "fileName",
        header: t("importCenter.table.fileName"),
        meta: { titleKey: "importCenter.table.fileName" },
        accessorFn: (row) => row.fileName || "—",
        cell: (info) => (
          <span dir="ltr" className="text-caption text-muted-foreground">
            {info.getValue() as string}
          </span>
        ),
      },
      {
        id: "source",
        header: t("importCenter.table.source"),
        meta: { titleKey: "importCenter.table.source" },
        accessorFn: (row) =>
          row.sourceConnector === "google-sheets"
            ? t("importCenter.table.sourceGoogleSheets")
            : t("importCenter.table.sourceFile"),
        cell: (info) => <span className="text-caption">{info.getValue() as string}</span>,
      },
      {
        id: "user",
        header: t("importCenter.table.user"),
        meta: { titleKey: "importCenter.table.user" },
        accessorFn: (row) => (row.createdBy ? (userById.get(row.createdBy) ?? "—") : "—"),
        cell: (info) => info.getValue() as string,
      },
      {
        id: "totalRows",
        header: t("importCenter.table.totalRows"),
        meta: { titleKey: "importCenter.table.totalRows" },
        accessorFn: (row) => row.totalRows,
        cell: (info) => info.getValue() as number,
      },
      {
        id: "successCount",
        header: t("importCenter.table.successCount"),
        meta: { titleKey: "importCenter.table.successCount" },
        accessorFn: (row) => row.successCount,
        cell: (info) => <span className="text-success">{info.getValue() as number}</span>,
      },
      {
        id: "errorCount",
        header: t("importCenter.table.errorCount"),
        meta: { titleKey: "importCenter.table.errorCount" },
        accessorFn: (row) => row.errorCount,
        cell: (info) => {
          const value = info.getValue() as number;
          return <span className={value > 0 ? "text-destructive" : ""}>{value}</span>;
        },
      },
      {
        id: "duration",
        header: t("importCenter.table.duration"),
        meta: { titleKey: "importCenter.table.duration" },
        accessorFn: (row) => row.durationMs ?? "",
        cell: (info) => {
          const value = info.getValue() as number | "";
          return value === "" ? "—" : `${(value / 1000).toFixed(1)}s`;
        },
      },
      {
        id: "lastSynced",
        header: t("importCenter.table.lastSynced"),
        meta: { titleKey: "importCenter.table.lastSynced" },
        accessorFn: (row) =>
          row.sourceConnector === "google-sheets"
            ? row.lastSyncedAt
              ? formatDateTime(row.lastSyncedAt)
              : "—"
            : "",
        cell: (info) => {
          const row = info.row.original;
          if (row.sourceConnector !== "google-sheets") return "—";
          return (
            <span className={row.isSyncing ? "text-warning" : undefined}>
              {row.isSyncing
                ? t("importCenter.wizard.googleSheets.refreshing")
                : (info.getValue() as string)}
            </span>
          );
        },
      },
      {
        id: "createdAt",
        header: t("importCenter.table.createdAt"),
        meta: { titleKey: "importCenter.table.createdAt" },
        accessorFn: (row) => formatDateTime(row.createdAt),
        cell: (info) => info.getValue() as string,
      },
      {
        id: "actions",
        header: t("common.actions"),
        meta: { titleKey: "common.actions" },
        enableSorting: false,
        accessorFn: () => "",
        cell: (info) => (
          <EnterpriseButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => viewJob(info.row.original)}
          >
            {t("importCenter.viewJob")}
          </EnterpriseButton>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, typeByKey, userById],
  );

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{t("nav.dataManagement")}</BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("nav.dataManagementImportCenter")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader title={t("importCenter.title")} subtitle={t("importCenter.description")} />

      <div className="flex flex-col gap-3">
        <h2 className="text-card-title font-semibold">{t("importCenter.availableTypes")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {types.map((typeDef) => {
            const requiredCount = typeDef.fields.filter((field) => field.required).length;
            return (
              <EnterpriseCard
                key={typeDef.type}
                className={!typeDef.isAvailable ? "opacity-70" : undefined}
              >
                <EnterpriseCardContent className="flex flex-col gap-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <UploadCloud className="size-4.5" />
                    </div>
                    {!typeDef.isAvailable && (
                      <EnterpriseBadge variant="outline" className="shrink-0">
                        {t("importCenter.notAvailable")}
                      </EnterpriseBadge>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-body font-semibold">{t(typeDef.labelKey as MessageKey)}</h3>
                    <p className="text-caption text-muted-foreground">
                      {t(typeDef.descriptionKey as MessageKey)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("importCenter.fieldsCount", { count: typeDef.fields.length })} ·{" "}
                    {t("importCenter.requiredFieldsCount", { count: requiredCount })}
                  </p>
                  {!typeDef.isAvailable && (
                    <p className="text-xs text-muted-foreground">
                      {t("importCenter.notAvailableHint")}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2">
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadTemplate(typeDef)}
                    >
                      <Download />
                      {t("importCenter.downloadTemplate")}
                    </EnterpriseButton>
                    <EnterpriseButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canManage || !typeDef.isAvailable}
                      onClick={() => startImport(typeDef)}
                    >
                      {t("importCenter.startImport")}
                    </EnterpriseButton>
                  </div>
                </EnterpriseCardContent>
              </EnterpriseCard>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-card-title font-semibold">{t("importCenter.history")}</h2>
        <EnterpriseDataTable
          tableId="import-center-jobs"
          printTitle={t("importCenter.history")}
          columns={columns}
          data={jobs}
          isLoading={isLoadingJobs}
          getRowId={(row) => row.id}
          emptyTitle={t("importCenter.noJobs")}
          onRefresh={loadJobs}
        />
      </div>

      {wizardTypeDef && (
        <ImportJobWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          typeDef={wizardTypeDef}
          initialJobId={wizardJobId}
          onDone={loadJobs}
        />
      )}
    </div>
  );
}

export default function ImportCenterPage() {
  return (
    <PermissionGate permission="import-center.view">
      <ImportCenterPageContent />
    </PermissionGate>
  );
}
