"use client";

import { useCallback, useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { EmptyState } from "@/components/shared/empty-state";
// The Store Orders import reuses the existing Import Center wizard shell —
// the `STORE_ORDERS` type runs in sales mode, never a second/bespoke wizard.
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { ImportHistoryTable } from "@/components/import-center/import-history-table";
import type { ImportTypeDefinition } from "@/services/import-types-service";
import type { ImportJobRow } from "@/services/import-jobs-service";
import { COMPANY_IMPORT_API } from "@/services/import-api";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";

const IMPORT_TYPE = "STORE_ORDERS";
const api = COMPANY_IMPORT_API;

/**
 * Store Orders import (R15, D15-16): any user holding `store-orders.import`
 * (or the `import-center.manage` catch-all) imports orders as their own,
 * with the manual-entry rules; "My imports" lists only the caller's jobs.
 */
function StoreOrdersImportContent() {
  const { t } = useLocale();
  const [typeDef, setTypeDef] = useState<ImportTypeDefinition | null>(null);
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardJobId, setWizardJobId] = useState<string | undefined>(undefined);
  const canImport = typeDef?.canImport !== false && Boolean(typeDef);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      setJobs(await api.jobs.list(IMPORT_TYPE));
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    api.types
      .list()
      .then((types) => setTypeDef(types.find((type) => type.type === IMPORT_TYPE) ?? null))
      .catch(() => setTypeDef(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs();
  }, [loadJobs]);

  const openJob = useCallback((job: ImportJobRow) => {
    setWizardJobId(job.id);
    setWizardOpen(true);
  }, []);

  return (
    <PageWorkspace
      dense
      title={t("nav.storeOrdersImport")}
      description={t("storeOrders.import.description")}
      actions={
        <HeaderActions
          primary={{
            key: "start-import",
            label: t("importCenter.startImport"),
            icon: UploadCloud,
            hidden: !typeDef,
            disabled: !canImport || !typeDef?.isAvailable,
            onSelect: () => {
              setWizardJobId(undefined);
              setWizardOpen(true);
            },
          }}
        />
      }
    >
      {!typeDef ? (
        <EmptyState icon={UploadCloud} title={t("storeOrders.import.typeUnavailable")} />
      ) : (
        <ImportHistoryTable
          tableId="store-orders-import-jobs"
          printTitle={t("nav.storeOrdersImport")}
          jobs={jobs}
          isLoading={isLoadingJobs}
          onRefresh={() => void loadJobs()}
          onOpen={openJob}
          cancelWith={canImport ? api.jobs : undefined}
        />
      )}

      {typeDef && (
        <ImportJobWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          typeDef={typeDef}
          initialJobId={wizardJobId}
          onDone={() => void loadJobs()}
          api={api}
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
