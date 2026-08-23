"use client";

import { useMemo, useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { CloudCog, RefreshCw } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportRowsToCsv } from "@/components/master-data/enterprise-data-table";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  syncService,
  type ShippingSyncRowReport,
  type SyncPreviewResult,
  type SyncSource,
} from "@/services/sync-service";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { humanizeSyncIssue } from "./messages";
import { SyncBulkActions } from "./sync-bulk-actions";
import { SyncErrorDigest } from "./sync-error-digest";
import { SyncResultSummary } from "./sync-result-summary";
import { SyncReviewTable } from "./sync-review-table";
import { SyncSourceContext } from "./sync-source-context";
import { SyncSummary } from "./sync-summary";
import {
  defaultDecision,
  isImportable,
  type SyncReviewDecision,
  type SyncReviewStatusFilter,
} from "./types";

export interface SyncReviewSourcePreview {
  source: SyncSource;
  preview: SyncPreviewResult;
}

const REPORT_RESULT_LABEL_KEY: Record<ShippingSyncRowReport["result"], MessageKey> = {
  UPDATED: "importCenter.sync.report.resultUpdated",
  NO_CHANGE: "importCenter.sync.report.resultNoChange",
  REJECTED: "importCenter.sync.report.resultRejected",
  NOT_FOUND: "importCenter.sync.report.resultNotFound",
  NEEDS_REVIEW: "importCenter.sync.report.resultNeedsReview",
  FINAL: "importCenter.sync.report.resultFinal",
  SKIPPED_FINAL: "importCenter.sync.report.resultSkippedFinal",
};

function reportResultVariant(
  result: ShippingSyncRowReport["result"],
): "default" | "secondary" | "outline" | "destructive" {
  switch (result) {
    case "UPDATED":
    case "FINAL":
      return "default";
    case "NO_CHANGE":
    case "SKIPPED_FINAL":
      return "outline";
    case "NEEDS_REVIEW":
      return "secondary";
    case "REJECTED":
    case "NOT_FOUND":
      return "destructive";
  }
}

function decisionsFromPreview(preview: SyncPreviewResult): Record<string, SyncReviewDecision> {
  const next: Record<string, SyncReviewDecision> = {};
  for (const row of preview.rows ?? []) {
    next[row.id] = defaultDecision(row);
  }
  return next;
}

export function SyncReviewDialog({
  open,
  onOpenChange,
  items,
  committing,
  report,
  onConfirm,
  onRevalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SyncReviewSourcePreview[] | null;
  committing: boolean;
  report: ShippingSyncRowReport[] | null;
  onConfirm: (
    commits: Array<{ sourceId: string; jobId: string; acceptRowNumbers: number[] }>,
  ) => Promise<void> | void;
  onRevalidate: (options?: {
    retryRowNumbers?: number[];
    retryAllFailed?: boolean;
  }) => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState<"review" | "confirm">("review");
  const [activeSourceId, setActiveSourceId] = useState<string | null>(
    items?.[0]?.source.id ?? null,
  );
  const [decisionsBySource, setDecisionsBySource] = useState<
    Record<string, Record<string, SyncReviewDecision>>
  >(() => {
    const decisions: Record<string, Record<string, SyncReviewDecision>> = {};
    for (const item of items ?? []) {
      decisions[item.source.id] = decisionsFromPreview(item.preview);
    }
    return decisions;
  });
  const [selectionBySource, setSelectionBySource] = useState<Record<string, RowSelectionState>>({});
  const [statusFilter, setStatusFilter] = useState<SyncReviewStatusFilter>("ALL");
  const [revalidating, setRevalidating] = useState(false);
  const [clearOrphanOpen, setClearOrphanOpen] = useState(false);
  const [clearingOrphans, setClearingOrphans] = useState(false);
  // Final-Shipment Sync Rules — skipped-final rows are folded into one
  // concise count instead of flooding the report; this reveals them again
  // for audit ("عرض الشحنات المنتهية").
  const [showSkippedFinal, setShowSkippedFinal] = useState(false);

  const active = items?.find((item) => item.source.id === activeSourceId) ?? items?.[0] ?? null;
  const rows = active?.preview.rows ?? [];
  const decisions = decisionsBySource[active?.source.id ?? ""] ?? {};
  const rowSelection = selectionBySource[active?.source.id ?? ""] ?? {};
  const filteredRows =
    statusFilter === "ALL"
      ? rows
      : statusFilter === "RETRY"
        ? rows.filter((row) => row.lifecycle === "RETRY")
        : statusFilter === "NEW"
          ? rows.filter((row) => row.lifecycle === "NEW")
          : rows.filter((row) => row.status === statusFilter);

  const selectedIds = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  const orphanSelected = selectedRows.filter((row) => row.lifecycle === "ORPHAN_LINK");
  const importableSelected = selectedRows.filter((row) => isImportable(row.status, row.lifecycle));

  const allRows = items?.flatMap((item) => item.preview.rows ?? []) ?? [];
  const allDecisions = useMemo(() => {
    const merged: Record<string, SyncReviewDecision> = {};
    for (const item of items ?? []) {
      Object.assign(merged, decisionsBySource[item.source.id] ?? {});
    }
    return merged;
  }, [items, decisionsBySource]);

  const isDirty = Object.values(decisionsBySource).some((map) =>
    Object.entries(map).some(([id, decision]) => {
      const row = allRows.find((item) => item.id === id);
      return row ? decision !== defaultDecision(row) : false;
    }),
  );

  const setActiveSelection = (next: RowSelectionState) => {
    if (!active) return;
    setSelectionBySource((current) => ({ ...current, [active.source.id]: next }));
  };

  const setDecision = (rowIds: string[], decision: SyncReviewDecision) => {
    if (!active) return;
    setDecisionsBySource((current) => {
      const sourceDecisions = { ...(current[active.source.id] ?? {}) };
      for (const id of rowIds) {
        const row = rows.find((item) => item.id === id);
        if (decision === "ACCEPT" && row && !isImportable(row.status, row.lifecycle)) continue;
        sourceDecisions[id] = decision;
      }
      return { ...current, [active.source.id]: sourceDecisions };
    });
  };

  const downloadErrors = () => {
    const errorRows = rows.filter((row) => row.status === "ERROR" || row.status === "DUPLICATE");
    const exportRows = errorRows.flatMap((row) => {
      const issues =
        row.issues.length > 0 ? row.issues : [{ field: null, code: "GENERIC", message: "" }];
      return issues.map((issue) => ({
        sourceRowNumber: row.rowNumbers.join(", "),
        ...row.sourceRow,
        status: row.status,
        errorField: issue.field ?? "",
        errorReason: humanizeSyncIssue(issue, t),
        originalValue: issue.originalValue ?? row.originalPhone ?? "",
        normalizedValue: issue.normalizedValue ?? row.normalizedPhone ?? "",
        suggestedCorrection: issue.normalizedValue ?? "",
        existingRecordId: row.existingRecordId ?? "",
      }));
    });
    if (exportRows.length === 0) return;
    const keys = [...new Set(exportRows.flatMap((row) => Object.keys(row)))];
    exportRowsToCsv(exportRows, keys, t("importCenter.sync.review.downloadFileName"));
  };

  const handleRetry = async (options?: {
    retryRowNumbers?: number[];
    retryAllFailed?: boolean;
  }) => {
    setRevalidating(true);
    try {
      await onRevalidate(options);
    } finally {
      setRevalidating(false);
    }
  };

  const handleClearOrphanResults = async () => {
    if (!active || orphanSelected.length === 0) return;
    setClearingOrphans(true);
    try {
      const rowNumbers = [...new Set(orphanSelected.flatMap((row) => row.rowNumbers))];
      await syncService.clearStoreOrderResultColumns(active.source.id, rowNumbers);
      toast.success(t("importCenter.sync.review.clearOrphanSuccess", { count: rowNumbers.length }));
      setClearOrphanOpen(false);
      setActiveSelection({});
      await onRevalidate({ retryRowNumbers: rowNumbers });
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("importCenter.sync.review.clearOrphanFailed"),
      );
    } finally {
      setClearingOrphans(false);
    }
  };

  const handleComplete = async () => {
    if (!items) return;
    const commits = items.map((item) => {
      const sourceDecisions =
        decisionsBySource[item.source.id] ?? decisionsFromPreview(item.preview);
      const acceptRowNumbers = (item.preview.rows ?? []).flatMap((row) => {
        const decision = sourceDecisions[row.id] ?? defaultDecision(row);
        if (decision !== "ACCEPT" || !isImportable(row.status, row.lifecycle)) return [];
        return row.rowNumbers;
      });
      return { sourceId: item.source.id, jobId: item.preview.jobId, acceptRowNumbers };
    });
    await onConfirm(commits);
  };

  const title = report
    ? t("importCenter.sync.report.title")
    : step === "confirm"
      ? t("importCenter.sync.review.confirmTitle")
      : t("importCenter.sync.review.title", {
          label: items?.map((item) => item.source.label).join(", ") ?? "",
        });

  return (
    <>
      <EnterpriseModal
        open={open}
        onOpenChange={(next) => {
          if (committing) return;
          onOpenChange(next);
        }}
        size="xl"
        icon={CloudCog}
        title={title}
        description={
          report || step === "confirm" ? undefined : t("importCenter.sync.review.description")
        }
        isDirty={isDirty && !report}
        footer={(requestClose) =>
          report ? (
            <EnterpriseButton type="button" onClick={() => onOpenChange(false)}>
              {t("importCenter.sync.report.close")}
            </EnterpriseButton>
          ) : step === "confirm" ? (
            <>
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={() => setStep("review")}
                disabled={committing}
              >
                {t("importCenter.sync.cancel")}
              </EnterpriseButton>
              <EnterpriseButton type="button" onClick={handleComplete} disabled={committing}>
                <RefreshCw className={committing ? "animate-spin" : undefined} />
                {committing
                  ? t("importCenter.sync.confirming")
                  : t("importCenter.sync.review.confirmPrimary")}
              </EnterpriseButton>
            </>
          ) : (
            <>
              <EnterpriseButton
                type="button"
                variant="outline"
                onClick={requestClose}
                disabled={committing}
              >
                {t("importCenter.sync.cancel")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="outline"
                disabled={revalidating || committing}
                onClick={async () => {
                  setRevalidating(true);
                  try {
                    await onRevalidate();
                  } finally {
                    setRevalidating(false);
                  }
                }}
              >
                <RefreshCw className={revalidating ? "animate-spin" : undefined} />
                {t("importCenter.sync.review.revalidate")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                disabled={committing}
                onClick={() => setStep("confirm")}
              >
                {t("importCenter.sync.review.completeSync")}
              </EnterpriseButton>
            </>
          )
        }
      >
        {report ? (
          <div className="flex flex-col gap-2">
            {(() => {
              const skippedFinalCount = report.filter(
                (row) => row.result === "SKIPPED_FINAL",
              ).length;
              if (skippedFinalCount === 0) return null;
              return (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-caption">
                  <span className="text-muted-foreground">
                    {t("importCenter.sync.report.skippedFinalSummary").replace(
                      "{count}",
                      String(skippedFinalCount),
                    )}
                  </span>
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSkippedFinal((value) => !value)}
                  >
                    {showSkippedFinal
                      ? t("importCenter.sync.report.hideSkippedFinal")
                      : t("importCenter.sync.report.showSkippedFinal")}
                  </EnterpriseButton>
                </div>
              );
            })()}
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start font-medium">
                      {t("importCenter.sync.report.externalOrderId")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("importCenter.sync.report.result")}
                    </th>
                    <th className="p-2 text-start font-medium">
                      {t("importCenter.sync.report.message")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report
                    .filter((row) => showSkippedFinal || row.result !== "SKIPPED_FINAL")
                    .map((row, idx) => (
                      <tr key={`${row.externalOrderId}-${idx}`} className="border-t border-border">
                        <td className="p-2 font-medium">{row.externalOrderId}</td>
                        <td className="p-2">
                          <EnterpriseBadge variant={reportResultVariant(row.result)}>
                            {t(REPORT_RESULT_LABEL_KEY[row.result])}
                          </EnterpriseBadge>
                        </td>
                        <td className="p-2 text-muted-foreground">{row.message}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : step === "confirm" ? (
          <SyncResultSummary rows={allRows} decisions={allDecisions} />
        ) : (
          <div className="flex flex-col gap-4">
            {items && items.length > 1 ? (
              <Tabs
                value={active?.source.id}
                onValueChange={(value) => {
                  setActiveSourceId(value);
                  setStatusFilter("ALL");
                }}
              >
                <TabsList variant="line" className="max-w-full overflow-x-auto">
                  {items.map((item) => (
                    <TabsTrigger key={item.source.id} value={item.source.id}>
                      {item.source.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}

            {active ? (
              <>
                <SyncSourceContext
                  source={active.preview.source}
                  previewedAt={active.preview.previewedAt}
                  rowsReceived={active.preview.totalRows}
                  rows={rows}
                  decisions={decisions}
                />
                {active.preview.writebackError ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-caption text-destructive">
                    {active.preview.writebackError}
                  </p>
                ) : null}
                <SyncSummary
                  rows={rows}
                  filter={statusFilter}
                  onFilterChange={setStatusFilter}
                  incremental={active.preview.incremental}
                />
                <SyncErrorDigest rows={rows} onShowErrors={() => setStatusFilter("ERROR")} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <SyncBulkActions
                    selectedCount={selectedRows.length}
                    importableSelectedCount={importableSelected.length}
                    errorCount={rows.filter((row) => row.status === "ERROR").length}
                    retryableSelectedCount={selectedRows.filter((row) => row.retryable).length}
                    retryableCount={rows.filter((row) => row.retryable).length}
                    filter={statusFilter}
                    onAcceptSelected={() =>
                      setDecision(
                        importableSelected.map((row) => row.id),
                        "ACCEPT",
                      )
                    }
                    onAcceptReady={() =>
                      setDecision(
                        rows.filter((row) => row.status === "READY").map((row) => row.id),
                        "ACCEPT",
                      )
                    }
                    onRejectSelected={() => setDecision(selectedIds, "REJECT")}
                    onDownloadErrors={downloadErrors}
                    onRetrySelected={() => {
                      const numbers = selectedRows
                        .filter((row) => row.retryable)
                        .flatMap((row) => row.rowNumbers);
                      if (numbers.length === 0) return;
                      void handleRetry({ retryRowNumbers: numbers });
                    }}
                    onRetryEligible={() => {
                      void handleRetry({ retryAllFailed: true });
                    }}
                    onSelectCurrentStatus={() => {
                      const next: RowSelectionState = {};
                      for (const row of filteredRows) next[row.id] = true;
                      setActiveSelection(next);
                    }}
                    orphanSelectedCount={orphanSelected.length}
                    onClearOrphanResults={() => setClearOrphanOpen(true)}
                  />
                </div>
                <SyncReviewTable
                  rows={filteredRows}
                  decisions={decisions}
                  rowSelection={rowSelection}
                  onRowSelectionChange={setActiveSelection}
                  onDecision={setDecision}
                  onRetry={(rowNumbers) => {
                    void handleRetry({ retryRowNumbers: rowNumbers });
                  }}
                />
                {active.preview.incremental?.nothingToSync ? (
                  <p className="text-center text-body text-muted-foreground">
                    {t("importCenter.sync.review.nothingToSync")}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </EnterpriseModal>
      <ConfirmationDialog
        open={clearOrphanOpen}
        onOpenChange={setClearOrphanOpen}
        title={t("importCenter.sync.review.clearOrphanTitle")}
        description={t("importCenter.sync.review.clearOrphanDescription", {
          count: orphanSelected.length,
        })}
        confirmLabel={t("importCenter.sync.review.clearOrphanConfirm")}
        tone="warning"
        isConfirming={clearingOrphans}
        onConfirm={() => void handleClearOrphanResults()}
      />
    </>
  );
}
