"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusCircle, UploadCloud } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { formatDateTime } from "@/lib/date";
import { reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import {
  paymentReconciliationService,
  type StatementImportRow,
  type StatementLine,
} from "@/services/payment-reconciliation-service";
import { StatementImportDialog } from "./statement-import-dialog";
import { ManualLineDialog } from "./manual-line-dialog";
import { SheetSourceCard } from "./sheet-source-card";
import { StatementLinesTable } from "./statement-lines-table";

/** Statement tab: file import wizard, Google Sheet sync, manual entry, import history and the lines table. */
export function StatementTab({
  methodId,
  canImport,
  canMatch,
  canCorrect,
  refreshKey,
  onChanged,
  onMatchLine,
}: {
  methodId: string;
  canImport: boolean;
  canMatch: boolean;
  canCorrect: boolean;
  refreshKey: unknown;
  onChanged: () => void;
  onMatchLine: (line: StatementLine) => void;
}) {
  const { t } = useLocale();
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [history, setHistory] = useState<StatementImportRow[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await paymentReconciliationService.listImports(methodId));
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    }
  }, [methodId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      {canImport ? (
        <div className="flex flex-wrap gap-2">
          <EnterpriseButton type="button" onClick={() => setImportOpen(true)}>
            <UploadCloud />
            {t("paymentReconciliation.statement.importFile")}
          </EnterpriseButton>
          <EnterpriseButton type="button" variant="outline" onClick={() => setManualOpen(true)}>
            <PlusCircle />
            {t("paymentReconciliation.statement.manualEntry")}
          </EnterpriseButton>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SheetSourceCard methodId={methodId} canImport={canImport} onSynced={onChanged} />
        <EnterpriseCard>
          <EnterpriseCardHeader>
            <EnterpriseCardTitle>
              {t("paymentReconciliation.statement.history")}
            </EnterpriseCardTitle>
          </EnterpriseCardHeader>
          <EnterpriseCardContent className="max-h-64 overflow-y-auto">
            <CompactDetailTable<StatementImportRow>
              rows={history.slice(0, 10)}
              rowKey={(row) => row.id}
              empty={t("paymentReconciliation.statement.historyEmpty")}
              columns={[
                {
                  id: "source",
                  header: t("paymentReconciliation.fields.source"),
                  cell: (row) => (
                    <div className="flex min-w-0 flex-col">
                      <span>{t(`paymentReconciliation.source.${row.sourceType}`)}</span>
                      <span className="truncate text-caption text-muted-foreground" dir="auto">
                        {row.fileName ?? row.sheetName ?? ""} · {formatDateTime(row.createdAt)}
                      </span>
                    </div>
                  ),
                },
                {
                  id: "result",
                  header: t("paymentReconciliation.fields.status"),
                  cell: (row) => (
                    <span className="text-caption">
                      {t("paymentReconciliation.statement.historyLine", {
                        total: String(row.totalRows),
                        created: String(row.createdRows),
                        duplicate: String(row.duplicateRows),
                        exception: String(row.exceptionRows),
                        error: String(row.errorRows),
                      })}
                    </span>
                  ),
                },
              ]}
            />
          </EnterpriseCardContent>
        </EnterpriseCard>
      </div>

      <StatementLinesTable
        methodId={methodId}
        tableId={`payment-reconciliation-lines`}
        refreshKey={refreshKey}
        canMatch={canMatch}
        canCorrect={canCorrect}
        onMatchLine={onMatchLine}
        onChanged={onChanged}
        emptyTitle={t("paymentReconciliation.statement.empty")}
      />

      <StatementImportDialog
        methodId={methodId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={onChanged}
      />
      <ManualLineDialog
        methodId={methodId}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onSaved={onChanged}
      />
    </div>
  );
}
