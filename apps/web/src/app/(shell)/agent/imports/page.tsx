"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { ImportHistoryTable } from "@/components/import-center/import-history-table";
import { ImportJobWizard } from "@/app/(shell)/data-management/import-center/import-job-wizard";
import { AGENT_IMPORT_API } from "@/services/import-api";
import type { ImportJobRow } from "@/services/import-jobs-service";
import type { ImportTypeDefinition } from "@/services/import-types-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";

const api = AGENT_IMPORT_API;
const IMPORT_TYPES = ["LEADS", "STORE_ORDERS"];

/**
 * R15 (D15-16, spec §8) — agent portal imports: an agent user holding
 * `agent.leads.import` / `agent.orders.import` imports leads / orders into
 * their own agent from Excel or a private Google Sheet, through the same
 * wizard as the company (agent endpoints: the agent comes from the login,
 * products from the agent's catalogue, the agent order rules apply). The
 * table lists the user's own imports only.
 */
export default function AgentImportsPage() {
  const { t } = useLocale();
  const [types, setTypes] = useState<ImportTypeDefinition[]>([]);
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openJob, setOpenJob] = useState<ImportJobRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setJobs(await api.jobs.list());
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    api.types
      .list()
      .then(setTypes)
      .catch(() => setTypes([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const typeLabelKeys = useMemo(
    () => Object.fromEntries(types.map((type) => [type.type, type.labelKey])),
    [types],
  );
  const openTypeDef = openJob ? types.find((type) => type.type === openJob.importType) : null;

  return (
    <PageWorkspace
      dense
      title={t("salesImport.agentPage.title")}
      description={t("salesImport.agentPage.description")}
      actions={
        <ModuleImportButtons importType={IMPORT_TYPES} api={api} onImported={() => void load()} />
      }
    >
      <ImportHistoryTable
        tableId="agent-imports"
        printTitle={t("salesImport.history.title")}
        jobs={jobs}
        isLoading={isLoading}
        onRefresh={() => void load()}
        onOpen={setOpenJob}
        cancelWith={api.jobs}
        typeLabelKeys={typeLabelKeys}
      />
      {openJob && openTypeDef ? (
        <ImportJobWizard
          open
          onOpenChange={(open) => {
            if (!open) setOpenJob(null);
          }}
          typeDef={openTypeDef}
          initialJobId={openJob.id}
          onDone={() => void load()}
          api={api}
        />
      ) : null}
    </PageWorkspace>
  );
}
