"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudCog, Clock, User as UserIcon, Mail } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SyncReviewDialog } from "@/components/shared/sync-review";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { formatDateTime } from "@/lib/date";
import { cn } from "@/lib/utils";
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
}: {
  sourceType: SyncSourceType;
  onSynced?: () => void;
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

  const runPreview = useCallback(async () => {
    const fresh = await syncService.listSources(sourceType);
    setSources(fresh);
    const enabled = fresh.filter((source) => source.enabled);
    if (enabled.length === 0) {
      toast.error(t("importCenter.sync.noSource"), {
        description: t("importCenter.sync.configureHint"),
      });
      return false;
    }
    const previews = await Promise.all(
      enabled.map(async (source) => ({ source, preview: await syncService.preview(source.id) })),
    );
    setItems(previews);
    setReport(null);
    setOpen(true);
    return true;
  }, [sourceType, t]);

  if (!canSync) return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      await runPreview();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Sync preview failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (
    commits: Array<{ sourceId: string; jobId: string; acceptRowNumbers: number[] }>,
  ) => {
    setCommitting(true);
    try {
      const results = await Promise.all(
        commits.map((commit) =>
          syncService.commit(commit.sourceId, commit.jobId, commit.acceptRowNumbers),
        ),
      );
      const totals = results.reduce(
        (acc, result) => ({
          total: acc.total + result.totalRows,
          imported: acc.imported + result.importedCount,
          errors: acc.errors + result.errorCount,
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
      toast.error(error instanceof ApiError ? error.message : "Sync failed.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="info"
            onClick={handleClick}
            disabled={loading}
            aria-label={t("importCenter.sync.button")}
            className="h-auto min-h-(--control-height-md) gap-2 rounded-md px-3 py-1.5 text-[length:var(--text-button)] ring-1 ring-info-foreground/15 transition-shadow"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-info-foreground/15">
              <CloudCog className={cn("size-3.5", loading && "animate-spin")} />
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
        onRevalidate={async () => {
          await runPreview();
        }}
      />
    </>
  );
}
