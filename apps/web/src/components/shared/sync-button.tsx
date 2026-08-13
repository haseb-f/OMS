"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, CloudCog, AlertTriangle, Clock, User as UserIcon, Mail } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  syncService,
  type SyncSourceType,
  type SyncSource,
  type SyncPreviewResult,
  type ShippingSyncRowReport,
} from "@/services/sync-service";

interface SourcePreview {
  source: SyncSource;
  preview: SyncPreviewResult;
}

/**
 * "مزامنة البيانات" — the one privileged Sync action, reused identically on
 * Import Center, Leads, Store Orders, and Cash Flow (which passes
 * `sourceType="CASH_FLOW"` and may resolve to several enabled sources, one
 * per provider worksheet — every one of them is previewed/committed here).
 * Rendered as a compact "Sync Action Card" (secondary/blue brand accent,
 * per ADR-0017) rather than a plain toolbar button — deliberately more
 * visually prominent than a normal page action since it's a system-level
 * operation, never a one-click silent commit (preview-then-confirm dialog
 * unchanged below). Hovering it shows the real last-sync info from
 * `SyncSourceConfig` — never fabricated or hardcoded.
 */
export function SyncButton({
  sourceType,
  onSynced,
}: {
  sourceType: SyncSourceType;
  onSynced?: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canSync = hasPermission("import-center.sync");

  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [items, setItems] = useState<SourcePreview[] | null>(null);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ShippingSyncRowReport[] | null>(null);
  // Last-sync info for the hover card only — independent of the
  // preview/confirm flow below, which still does its own fresh
  // `listSources()` call right before previewing.
  const [sources, setSources] = useState<SyncSource[] | null>(null);

  const loadSources = useCallback(() => {
    if (!canSync) return;
    syncService
      .listSources(sourceType)
      .then(setSources)
      .catch(() => setSources(null));
  }, [sourceType, canSync]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const lastSyncSource = useMemo(() => {
    if (!sources || sources.length === 0) return null;
    return [...sources].sort((a, b) => {
      if (!a.lastSyncedAt) return 1;
      if (!b.lastSyncedAt) return -1;
      return new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime();
    })[0];
  }, [sources]);

  if (!canSync) return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      const fresh = await syncService.listSources(sourceType);
      setSources(fresh);
      const enabled = fresh.filter((s) => s.enabled);
      if (enabled.length === 0) {
        toast.error(t("importCenter.sync.noSource"), {
          description: t("importCenter.sync.configureHint"),
        });
        return;
      }
      const previews = await Promise.all(
        enabled.map(async (source) => ({ source, preview: await syncService.preview(source.id) })),
      );
      setItems(previews);
      setReport(null);
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sync preview failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!items) return;
    setCommitting(true);
    try {
      const results = await Promise.all(
        items.map(({ source, preview }) => syncService.commit(source.id, preview.jobId)),
      );
      const totals = results.reduce(
        (acc, r) => ({
          total: acc.total + r.totalRows,
          imported: acc.imported + r.importedCount,
          errors: acc.errors + r.errorCount,
        }),
        { total: 0, imported: 0, errors: 0 },
      );
      if (totals.errors === 0) {
        toast.success(
          t("importCenter.sync.success", { imported: totals.imported, total: totals.total }),
        );
      } else if (totals.imported > 0) {
        toast.warning(
          t("importCenter.sync.partial", {
            imported: totals.imported,
            total: totals.total,
            errors: totals.errors,
          }),
        );
      } else {
        toast.error(t("importCenter.sync.failed"));
      }
      const rows = results.flatMap((r) => r.rows ?? []);
      if (rows.length > 0) {
        setReport(rows);
      } else {
        setOpen(false);
        setItems(null);
      }
      loadSources(); // refresh the hover card's "آخر تحديث" info now that this run has completed
      onSynced?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sync failed.");
    } finally {
      setCommitting(false);
    }
  };

  const totals = items?.reduce(
    (acc, { preview }) => ({
      total: acc.total + preview.totalRows,
      willImport: acc.willImport + preview.willImportCount,
      duplicate: acc.duplicate + preview.duplicateCount,
      needsReview: acc.needsReview + preview.needsReviewCount,
      errors: acc.errors + preview.errorCount,
    }),
    { total: 0, willImport: 0, duplicate: 0, needsReview: 0, errors: 0 },
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="secondary"
            onClick={handleClick}
            disabled={loading}
            aria-label={t("importCenter.sync.button")}
            className="h-auto gap-2.5 rounded-md border-secondary-foreground/15 px-3 py-2 ring-1 ring-secondary-foreground/10 not-disabled:hover:brightness-105"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-foreground/10">
              <CloudCog className={cn("size-4", loading && "animate-spin")} />
            </span>
            {loading ? t("importCenter.sync.loading") : t("importCenter.sync.button")}
          </EnterpriseButton>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="w-72 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2 rounded-lg p-3 text-start"
        >
          {lastSyncSource?.lastSyncedAt ? (
            <>
              <div className="flex items-center gap-2">
                <Clock className="size-3.5 shrink-0 opacity-70" />
                <span>
                  {t("importCenter.sync.card.lastUpdate")}:{" "}
                  {formatDateTime(lastSyncSource.lastSyncedAt)}
                </span>
              </div>
              {lastSyncSource.lastSyncUserName && (
                <div className="flex items-center gap-2">
                  <UserIcon className="size-3.5 shrink-0 opacity-70" />
                  <span>
                    {t("importCenter.sync.card.by")}: {lastSyncSource.lastSyncUserName}
                  </span>
                </div>
              )}
              {lastSyncSource.lastSyncUserEmail && (
                <div className="flex items-center gap-2">
                  <Mail className="size-3.5 shrink-0 opacity-70" />
                  <span className="opacity-90">{lastSyncSource.lastSyncUserEmail}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 shrink-0 opacity-70" />
              <span>{t("importCenter.sync.card.never")}</span>
            </div>
          )}
        </TooltipContent>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (committing) return;
          setOpen(next);
          if (!next) {
            setItems(null);
            setReport(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {report
                ? t("importCenter.sync.report.title")
                : t("importCenter.sync.previewTitle", {
                    label: items?.map((i) => i.source.label).join(", ") ?? "",
                  })}
            </DialogTitle>
            {!report && (
              <DialogDescription>{t("importCenter.sync.previewDescription")}</DialogDescription>
            )}
          </DialogHeader>

          {report && (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-border/60">
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
                  {report.map((row, idx) => (
                    <tr key={`${row.externalOrderId}-${idx}`} className="border-t border-border/60">
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
          )}

          {!report && totals && (
            <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              <SummaryStat label={t("importCenter.sync.summaryTotal")} value={totals.total} />
              <SummaryStat
                label={t("importCenter.sync.summaryWillImport")}
                value={totals.willImport}
                variant="default"
              />
              <SummaryStat
                label={t("importCenter.sync.summaryDuplicate")}
                value={totals.duplicate}
                variant="outline"
              />
              <SummaryStat
                label={t("importCenter.sync.summaryNeedsReview")}
                value={totals.needsReview}
                variant="secondary"
              />
              <SummaryStat
                label={t("importCenter.sync.summaryErrors")}
                value={totals.errors}
                variant="destructive"
              />
            </div>
          )}

          {!report && items && items.length > 1 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2 text-xs">
              {items.map(({ source, preview }) => (
                <div key={source.id} className="flex items-center justify-between gap-2">
                  <span className="font-medium">{source.label}</span>
                  <span className="text-muted-foreground">
                    {preview.totalRows} · {preview.willImportCount}↑ · {preview.duplicateCount}= ·{" "}
                    {preview.needsReviewCount}? · {preview.errorCount}✕
                  </span>
                </div>
              ))}
            </div>
          )}

          {!report && totals && totals.errors > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {items
                  ?.flatMap((i) => i.preview.errors)
                  .slice(0, 3)
                  .map((e) => e.message)
                  .join(" · ")}
              </span>
            </div>
          )}

          <DialogFooter>
            {report ? (
              <EnterpriseButton
                type="button"
                onClick={() => {
                  setOpen(false);
                  setItems(null);
                  setReport(null);
                }}
              >
                {t("importCenter.sync.report.close")}
              </EnterpriseButton>
            ) : (
              <>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={committing}
                >
                  {t("importCenter.sync.cancel")}
                </EnterpriseButton>
                <EnterpriseButton type="button" onClick={handleConfirm} disabled={committing}>
                  <RefreshCw className={committing ? "animate-spin" : undefined} />
                  {committing
                    ? t("importCenter.sync.confirming")
                    : t("importCenter.sync.confirmButton")}
                </EnterpriseButton>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const REPORT_RESULT_LABEL_KEY: Record<ShippingSyncRowReport["result"], MessageKey> = {
  UPDATED: "importCenter.sync.report.resultUpdated",
  NO_CHANGE: "importCenter.sync.report.resultNoChange",
  REJECTED: "importCenter.sync.report.resultRejected",
  NOT_FOUND: "importCenter.sync.report.resultNotFound",
  NEEDS_REVIEW: "importCenter.sync.report.resultNeedsReview",
};

function reportResultVariant(
  result: ShippingSyncRowReport["result"],
): "default" | "secondary" | "outline" | "destructive" {
  switch (result) {
    case "UPDATED":
      return "default";
    case "NO_CHANGE":
      return "outline";
    case "NEEDS_REVIEW":
      return "secondary";
    case "REJECTED":
    case "NOT_FOUND":
      return "destructive";
  }
}

function SummaryStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "default" | "secondary" | "outline" | "destructive";
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border/60 p-2">
      <EnterpriseBadge variant={variant ?? "outline"}>{value}</EnterpriseBadge>
      <span className="text-[0.65rem] text-muted-foreground">{label}</span>
    </div>
  );
}
