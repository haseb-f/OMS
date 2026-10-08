"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import type { ImportJobRow, ImportJobsApi } from "@/services/import-jobs-service";
import type { ImportTypeDefinition } from "@/services/import-types-service";
import { ImportHistoryTable } from "./import-history-table";

/**
 * R15 — "My imports" of one type, opened from a list page's import menu
 * (e.g. Leads): the caller's own jobs; choosing one reopens it in the wizard.
 */
export function ImportHistoryDialog({
  open,
  onOpenChange,
  jobs,
  typeDef,
  onOpenJob,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: ImportJobsApi;
  typeDef: ImportTypeDefinition;
  onOpenJob: (job: ImportJobRow) => void;
}) {
  const { t } = useLocale();
  const [rows, setRows] = useState<ImportJobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setRows(await jobs.list(typeDef.type));
    } catch (error) {
      reportApiError(error, "errors.loadFailed");
    } finally {
      setIsLoading(false);
    }
  }, [jobs, typeDef.type]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
  }, [open, load]);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      icon={History}
      title={`${t("salesImport.history.title")} — ${t(typeDef.labelKey as MessageKey)}`}
      description={t("salesImport.history.description")}
    >
      <ImportHistoryTable
        tableId={`import-history-${typeDef.type.toLowerCase()}`}
        printTitle={t("salesImport.history.title")}
        jobs={rows}
        isLoading={isLoading}
        onRefresh={() => void load()}
        onOpen={onOpenJob}
      />
    </EnterpriseModal>
  );
}
