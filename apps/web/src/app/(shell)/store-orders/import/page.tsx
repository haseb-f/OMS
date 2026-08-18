"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { UploadCloud } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
// The Store Orders import reuses the existing Import Center wizard shell
// unmodified — only a new `STORE_ORDERS` type key (registered server-side)
// is threaded through it, never a second/bespoke wizard implementation.
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { importTypesService, type ImportTypeDefinition } from "@/services/import-types-service";
import { importJobsService, type ImportJobRow } from "@/services/import-jobs-service";
import { IMPORT_JOB_STATUS_LABEL_KEY, IMPORT_JOB_STATUS_TONE } from "@/config/import-center/status";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDateTime } from "@/lib/date";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const IMPORT_TYPE = "STORE_ORDERS";

function StoreOrdersImportContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canImport = hasPermission("import-center.manage");

  const [typeDef, setTypeDef] = useState<ImportTypeDefinition | null>(null);
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardJobId, setWizardJobId] = useState<string | undefined>(undefined);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      setJobs(await importJobsService.list(IMPORT_TYPE));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load import jobs.");
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    importTypesService
      .list()
      .then((types) => setTypeDef(types.find((type) => type.type === IMPORT_TYPE) ?? null))
      .catch(() => setTypeDef(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs();
  }, [loadJobs]);

  const columns = useMemo<ColumnDef<ImportJobRow, unknown>[]>(
    () => [
      {
        id: "status",
        header: t("importCenter.table.status"),
        meta: { titleKey: "importCenter.table.status" },
        cell: (info) => {
          const status = info.row.original.status;
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
      },
      {
        id: "totalRows",
        header: t("importCenter.table.totalRows"),
        meta: { titleKey: "importCenter.table.totalRows" },
        accessorFn: (row) => row.totalRows,
      },
      {
        id: "successCount",
        header: t("importCenter.table.successCount"),
        meta: { titleKey: "importCenter.table.successCount" },
        accessorFn: (row) => row.successCount,
      },
      {
        id: "errorCount",
        header: t("importCenter.table.errorCount"),
        meta: { titleKey: "importCenter.table.errorCount" },
        accessorFn: (row) => row.errorCount,
      },
      {
        id: "createdAt",
        header: t("importCenter.table.createdAt"),
        meta: { titleKey: "importCenter.table.createdAt" },
        accessorFn: (row) => formatDateTime(row.createdAt),
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
            onClick={() => {
              setWizardJobId(info.row.original.id);
              setWizardOpen(true);
            }}
          >
            {t("importCenter.viewJob")}
          </EnterpriseButton>
        ),
      },
    ],
    [t],
  );

  return (
    <PageWorkspace
      title={t("nav.storeOrdersImport")}
      description={t("storeOrders.import.description")}
      actions={
        typeDef ? (
          <EnterpriseButton
            type="button"
            disabled={!canImport || !typeDef.isAvailable}
            onClick={() => {
              setWizardJobId(undefined);
              setWizardOpen(true);
            }}
          >
            <UploadCloud />
            {t("importCenter.startImport")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {!typeDef ? (
        <EmptyState icon={UploadCloud} title={t("storeOrders.import.typeUnavailable")} />
      ) : (
        <EnterpriseDataTable
          tableId="store-orders-import-jobs"
          printTitle={t("nav.storeOrdersImport")}
          columns={columns}
          data={jobs}
          isLoading={isLoadingJobs}
          getRowId={(row) => row.id}
          emptyTitle={t("importCenter.noJobs")}
          onRefresh={loadJobs}
        />
      )}

      {typeDef && (
        <ImportJobWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          typeDef={typeDef}
          initialJobId={wizardJobId}
          onDone={loadJobs}
        />
      )}
    </PageWorkspace>
  );
}

export default function StoreOrdersImportPage() {
  return (
    <PermissionGate permission="store-orders.view">
      <StoreOrdersImportContent />
    </PermissionGate>
  );
}
