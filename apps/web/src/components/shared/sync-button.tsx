"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudCog, Clock, User as UserIcon, Mail } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SyncReviewDialog } from "@/components/shared/sync-review";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  SYNC_ACTION_BUTTON_CLASS,
  SyncLastSyncLabel,
} from "@/components/shared/sync-workspace-card";
import {
  syncService,
  type SyncSourceType,
  type SyncSource,
  type ShippingSyncRowReport,
} from "@/services/sync-service";
import type { SyncReviewSourcePreview } from "@/components/shared/sync-review/sync-review-dialog";

/**
 * "مزامنة البيانات" — the one privileged Sync action, reused identically on
 * Import Center, Leads, Store Orders, Shipping, and Cash Flow. Preview opens
 * the shared Sync Review workspace (validate → decide → import), never a
 * silent one-click commit.
 */
export function SyncButton({
  sourceType,
  onSynced,
  layout = "toolbar",
}: {
  sourceType: SyncSourceType;
  onSynced?: () => void;
  /** `workspace` is the Import Center card layout (full-width button + last-sync line). */
  layout?: "toolbar" | "workspace";
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canSync = hasPermission("import-center.sync");

  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [items, setItems] = useState<SyncReviewSourcePreview[] | null>(null);
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ShippingSyncRowReport[] | null>(null);
  const [sources, setSources] = useState<SyncSource[] | null>(null);
  /** The outcome of the last commit — kept on the card (workspace layout) until dismissed or the next sync. */
  const [lastResult, setLastResult] = useState<{
    tone: "success" | "warning" | "destructive";
    message: string;
    description?: string;
  } | null>(null);

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

  const shippingRunAs =
    sourceType === "SHIPPING_UPDATES" ? ("SHIPPING_UPDATES" as const) : undefined;

  const runPreview = useCallback(
    async (options?: { retryRowNumbers?: number[]; retryAllFailed?: boolean }) => {
      const fresh = await syncService.listSources(sourceType);
      setSources(fresh);
      const enabled = fresh.filter((source) => source.enabled);
      if (enabled.length === 0) {
        const message =
          sourceType === "SHIPPING_UPDATES"
            ? t("importCenter.sync.noSourceShipping")
            : t("importCenter.sync.noSource");
        const description =
          sourceType === "SHIPPING_UPDATES"
            ? t("importCenter.sync.configureHintShipping")
            : t("importCenter.sync.configureHint");
        toast.error(message, { description });
        // Stays on the card until a source is configured and synced (or dismissed).
        setLastResult({ tone: "warning", message, description });
        return false;
      }
      const previews = await Promise.all(
        enabled.map(async (source) => ({
          source,
          preview: await syncService.preview(source.id, {
            ...options,
            ...(shippingRunAs ? { runAs: shippingRunAs } : {}),
          }),
        })),
      );
      setItems(previews);
      setReport(null);
      setOpen(true);
      return true;
    },
    [sourceType, t, shippingRunAs],
  );

  if (!canSync) return null;

  const handleClick = async () => {
    setLoading(true);
    setLastResult(null);
    try {
      await runPreview();
    } catch (error) {
      reportApiError(error, "errors.syncFailed");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (
    commits: Array<{
      sourceId: string;
      jobId: string;
      acceptRowNumbers: number[];
      rejectRowNumbers: number[];
    }>,
  ) => {
    setCommitting(true);
    try {
      const results = await Promise.all(
        commits.map((commit) =>
          syncService.commit(
            commit.sourceId,
            commit.jobId,
            commit.acceptRowNumbers,
            shippingRunAs,
            commit.rejectRowNumbers,
          ),
        ),
      );
      const writebackError = results.find((result) => result.writebackError)?.writebackError;
      const totals = results.reduce(
        (acc, result) => ({
          total: acc.total + result.totalRows,
          imported: acc.imported + result.importedCount,
          errors: acc.errors + result.errorCount,
        }),
        { total: 0, imported: 0, errors: 0 },
      );
      // ONE outcome notification — a write-back failure is folded into it
      // (and downgrades success to a warning) instead of a second, contradictory
      // error toast next to a success toast.
      let tone: "success" | "warning" | "destructive" =
        totals.errors === 0 ? "success" : totals.imported > 0 ? "warning" : "destructive";
      const message =
        tone === "success"
          ? t("importCenter.sync.success", { imported: totals.imported, total: totals.total })
          : tone === "warning"
            ? t("importCenter.sync.partial", {
                imported: totals.imported,
                total: totals.total,
                errors: totals.errors,
              })
            : t("importCenter.sync.failed");
      const description = writebackError
        ? `${t("feedback.sync.writebackWarning")} ${writebackError}`
        : undefined;
      if (writebackError && tone === "success") tone = "warning";
      const notify =
        tone === "success" ? toast.success : tone === "warning" ? toast.warning : toast.error;
      notify(message, description ? { description } : undefined);
      setLastResult({ tone, message, description });
      const rows = results.flatMap((result) => result.rows ?? []);
      if (rows.length > 0) {
        setReport(rows);
      } else {
        setOpen(false);
        setItems(null);
      }
      loadSources();
      onSynced?.();
    } catch (error) {
      reportApiError(error, "errors.syncFailed");
    } finally {
      setCommitting(false);
    }
  };

  const actionButton = (
    <EnterpriseButton
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={loading}
      aria-label={t("importCenter.sync.button")}
      className={cn(layout === "workspace" ? SYNC_ACTION_BUTTON_CLASS : "gap-1.5")}
    >
      <CloudCog className={cn("size-4", loading && "animate-spin")} />
      {/* `action-label`: a page header collapses it to icon-only on phones. */}
      <span data-slot="action-label">
        {loading ? t("importCenter.sync.loading") : t("importCenter.sync.button")}
      </span>
    </EnterpriseButton>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>{actionButton}</TooltipTrigger>
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
      {layout === "workspace" ? (
        <SyncLastSyncLabel lastSyncedAt={lastSyncSource?.lastSyncedAt} />
      ) : null}
      {layout === "workspace" && lastResult ? (
        <DismissibleAlert
          tone={lastResult.tone}
          title={t("feedback.sync.resultTitle")}
          onDismiss={() => setLastResult(null)}
          className="text-start"
        >
          <p>{lastResult.message}</p>
          {lastResult.description ? <p>{lastResult.description}</p> : null}
        </DismissibleAlert>
      ) : null}

      <SyncReviewDialog
        key={items?.map((item) => item.preview.jobId).join("|") ?? "closed"}
        open={open}
        onOpenChange={(next) => {
          if (committing) return;
          setOpen(next);
          if (!next) {
            setItems(null);
            setReport(null);
          }
        }}
        items={items}
        committing={committing}
        report={report}
        onConfirm={handleConfirm}
        onRevalidate={async (options) => {
          await runPreview(options);
        }}
      />
    </>
  );
}
