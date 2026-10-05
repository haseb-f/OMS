"use client";

import { useEffect, useRef, useState } from "react";
import { History, Play, Settings2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  EnterpriseCard,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { StackedCell } from "@/components/shared/stacked-cell";
import { StatusBadge } from "@/components/business/status-badge";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { formatDateTime } from "@/lib/date";
import { toast, reportApiError } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import {
  fxSyncService,
  type FxRateBasis,
  type FxSyncRunRow,
  type FxSyncStatus,
} from "@/services/fx-service";
import { FX_RUN_TONE, fxDayLabel } from "./fx-format";
import { FxStatusPanel, useNowTick } from "./fx-status-panel";
import { cooldownSeconds, formatCountdown, serverOffsetMs } from "./fx-sync-state";

const BASES: FxRateBasis[] = ["MID", "BUY", "SELL"];

function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="min-w-0 text-body">{children}</div>
    </div>
  );
}

/**
 * Automatic official FX import (CBE) — status, settings and history. The
 * enabled switch applies immediately; basis/staleness live behind
 * "Settings" (progressive disclosure). Every action reports its outcome.
 */
export function FxAutoImportCard({
  status,
  statusReceivedAt,
  runs,
  baseCode,
  canManage,
  onChanged,
  onPoll,
}: {
  status: FxSyncStatus | null;
  /** Browser time (ms) at which `status` was received — anchors the server-clock offset. */
  statusReceivedAt: number;
  runs: FxSyncRunRow[];
  baseCode: string;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
  /** Lightweight status + runs refresh used while a run is in progress. */
  onPoll: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState<"toggle" | "run" | "backfill" | "save" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [draft, setDraft] = useState<{
    rateBasis: FxRateBasis;
    maxStaleDays: string;
    staleAlertDays: string;
  }>({ rateBasis: "MID", maxStaleDays: "10", staleAlertDays: "4" });

  const settings = status?.settings;

  // Live state: poll while the server reports a RUNNING row or our own request is in flight.
  const live = Boolean(status?.running) || busy === "run" || busy === "backfill";
  const pollRef = useRef(onPoll);
  useEffect(() => {
    pollRef.current = onPoll;
  });
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void pollRef.current(), 3000);
    return () => window.clearInterval(timer);
  }, [live]);

  // Run now: explicit button — disabled while running, in cooldown, or busy.
  const cooldownActive = Boolean(status?.cooldownEndsAt);
  const now = useNowTick(cooldownActive);
  const waitSeconds = status
    ? cooldownSeconds(status, now, serverOffsetMs(status, statusReceivedAt))
    : 0;
  const runBlockedReason = status?.running
    ? t("fxSettings.state.runNow.running")
    : waitSeconds > 0
      ? t("fxSettings.state.runNow.cooldown", { time: formatCountdown(waitSeconds) })
      : null;

  const reportRun = (run: FxSyncRunRow) => {
    if (run.status === "SUCCESS") {
      toast.success(
        t("fxSettings.toasts.runSucceeded", {
          inserted: run.insertedCount,
          date: fxDayLabel(t, run.effectiveDate),
        }),
      );
    } else if (run.status === "PARTIAL") {
      toast.warning(t("fxSettings.toasts.runPartial"));
    } else if (run.status === "SKIPPED") {
      toast.info(t("fxSettings.toasts.runSkipped", { reason: reasonLabel(run) }));
    } else {
      toast.error(t("fxSettings.toasts.runFailed", { error: run.error ?? "—" }));
    }
  };

  const reasonLabel = (run: FxSyncRunRow) => {
    const reason = run.details?.reason;
    return reason === "DISABLED" || reason === "ALREADY_RUNNING" || reason === "ALREADY_CURRENT"
      ? t(`fxSettings.runReason.${reason}`)
      : (reason ?? "—");
  };

  const toggle = async (enabled: boolean) => {
    setBusy("toggle");
    try {
      await fxSyncService.updateSettings({ enabled });
      toast.success(t(enabled ? "fxSettings.toasts.enabled" : "fxSettings.toasts.disabled"));
      await onChanged();
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: "run" | "backfill") => {
    if (runBlockedReason) return;
    setBusy(kind);
    try {
      const result =
        kind === "run" ? await fxSyncService.runNow() : await fxSyncService.backfill(7);
      reportRun(result);
      if (kind === "backfill") setSettingsOpen(false);
      await onChanged();
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const openSettings = () => {
    setDraft({
      rateBasis: settings?.rateBasis ?? "MID",
      maxStaleDays: String(settings?.maxStaleDays ?? 10),
      staleAlertDays: String(settings?.staleAlertDays ?? 4),
    });
    setSettingsOpen(true);
  };

  const maxStale = Number(draft.maxStaleDays);
  const alertDays = Number(draft.staleAlertDays);
  const draftValid =
    Number.isInteger(maxStale) &&
    maxStale >= 1 &&
    maxStale <= 60 &&
    Number.isInteger(alertDays) &&
    alertDays >= 1 &&
    alertDays <= 60;

  const saveSettings = async () => {
    if (!draftValid) return;
    setBusy("save");
    try {
      await fxSyncService.updateSettings({
        rateBasis: draft.rateBasis,
        maxStaleDays: maxStale,
        staleAlertDays: alertDays,
      });
      toast.success(t("fxSettings.toasts.settingsSaved"));
      setSettingsOpen(false);
      await onChanged();
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const runColumns: CompactDetailColumn<FxSyncRunRow>[] = [
    {
      id: "started",
      header: t("fxSettings.runColumns.started"),
      cell: (row) => (
        <StackedCell
          primary={formatDateTime(row.startedAt)}
          secondary={t(
            (["CRON", "MANUAL", "BACKFILL"].includes(row.trigger)
              ? `fxSettings.runTrigger.${row.trigger}`
              : "fxSettings.runTrigger.CRON") as MessageKey,
          )}
        />
      ),
    },
    {
      id: "status",
      header: t("fxSettings.runColumns.status"),
      cell: (row) => (
        <StackedCell
          primary={
            <StatusBadge
              label={t(`fxSettings.runStatus.${row.status}`)}
              tone={FX_RUN_TONE[row.status]}
            />
          }
          secondary={
            row.effectiveDate
              ? t("fxSettings.autoImport.ratesFor", { date: fxDayLabel(t, row.effectiveDate) })
              : undefined
          }
        />
      ),
    },
    {
      id: "result",
      header: t("fxSettings.runColumns.result"),
      cell: (row) => (
        <div className="min-w-0 text-caption">
          {row.status === "SKIPPED" ? (
            <span className="text-muted-foreground">{reasonLabel(row)}</span>
          ) : row.status === "FAILED" ? (
            <span className="break-words text-destructive">{row.error}</span>
          ) : (
            <>
              <span>
                {t("fxSettings.autoImport.counts", {
                  inserted: row.insertedCount,
                  skipped: row.skippedCount,
                })}
              </span>
              {row.details?.warnings?.length ? (
                <ul className="mt-0.5 list-disc ps-4 text-warning-soft-foreground">
                  {row.details.warnings.map((warning) => (
                    <li key={warning} className="break-words">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <EnterpriseCard className="gap-0 self-start py-3" data-testid="fx-auto-import">
      <EnterpriseCardHeader className="flex flex-wrap items-start justify-between gap-2 px-4 pb-2">
        <div className="min-w-0">
          <EnterpriseCardTitle>{t("fxSettings.autoImport.title")}</EnterpriseCardTitle>
          <p className="text-caption text-muted-foreground">
            {t("fxSettings.autoImport.description", { base: baseCode || "—" })}
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <EnterpriseButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={openSettings}
              disabled={!status}
            >
              <Settings2 />
              {t("fxSettings.autoImport.editSettings")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run("run")}
              isLoading={busy === "run"}
              disabled={busy !== null || runBlockedReason !== null}
              title={runBlockedReason ?? undefined}
              data-testid="fx-run-now"
            >
              <Play />
              {t("fxSettings.autoImport.runNow")}
            </EnterpriseButton>
          </div>
        ) : null}
        {canManage && runBlockedReason ? (
          <p
            className="basis-full text-end text-caption text-muted-foreground"
            data-testid="fx-run-blocked"
          >
            {runBlockedReason}
          </p>
        ) : null}
      </EnterpriseCardHeader>
      <EnterpriseCardContent className="flex flex-col gap-3 px-4">
        <FxStatusPanel
          status={status}
          receivedAtMs={statusReceivedAt}
          canManage={canManage}
          toggleBusy={busy !== null}
          onToggle={(checked) => void toggle(checked)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KeyValue label={t("fxSettings.autoImport.sourceLabel")}>
            {t("fxSettings.autoImport.sourceValue")}
          </KeyValue>
          <KeyValue label={t("fxSettings.autoImport.basis")}>
            {settings ? t(`fxSettings.autoImport.basisOptions.${settings.rateBasis}`) : "—"}
          </KeyValue>
          <KeyValue label={t("fxSettings.autoImport.maxStaleDays")}>
            {settings ? (
              <span title={t("fxSettings.autoImport.maxStaleDaysHint")}>
                {settings.maxStaleDays}
              </span>
            ) : (
              "—"
            )}
          </KeyValue>
        </div>

        <div className="flex flex-col gap-2">
          <EnterpriseButton
            type="button"
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setShowRuns((open) => !open)}
            aria-expanded={showRuns}
          >
            <History />
            {showRuns ? t("fxSettings.autoImport.hideRuns") : t("fxSettings.autoImport.showRuns")}
          </EnterpriseButton>
          {showRuns ? (
            <CompactDetailTable
              columns={runColumns}
              rows={runs}
              rowKey={(row) => row.id}
              empty={t("fxSettings.autoImport.never")}
            />
          ) : null}
        </div>
        <p className="text-caption text-muted-foreground">{t("fxSettings.autoImport.citation")}</p>
      </EnterpriseCardContent>

      <EnterpriseModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t("fxSettings.autoImport.settingsTitle")}
        footer={(requestClose) => (
          <>
            <EnterpriseButton
              type="button"
              variant="ghost"
              className="me-auto"
              onClick={() => void run("backfill")}
              isLoading={busy === "backfill"}
              disabled={busy !== null}
            >
              {t("fxSettings.autoImport.backfill")}
            </EnterpriseButton>
            <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              onClick={() => void saveSettings()}
              isLoading={busy === "save"}
              disabled={!draftValid || busy !== null}
            >
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="fx-basis">{t("fxSettings.autoImport.basis")}</Label>
            <Select
              value={draft.rateBasis}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, rateBasis: value as FxRateBasis }))
              }
            >
              <SelectTrigger id="fx-basis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASES.map((basis) => (
                  <SelectItem key={basis} value={basis}>
                    {t(`fxSettings.autoImport.basisOptions.${basis}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fx-max-stale">{t("fxSettings.autoImport.maxStaleDays")}</Label>
            <Input
              id="fx-max-stale"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={draft.maxStaleDays}
              aria-invalid={!(maxStale >= 1 && maxStale <= 60)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, maxStaleDays: event.target.value }))
              }
            />
            <p className="text-caption text-muted-foreground">
              {t("fxSettings.autoImport.maxStaleDaysHint")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fx-alert-days">{t("fxSettings.autoImport.staleAlertDays")}</Label>
            <Input
              id="fx-alert-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={draft.staleAlertDays}
              aria-invalid={!(alertDays >= 1 && alertDays <= 60)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, staleAlertDays: event.target.value }))
              }
            />
            <p className="text-caption text-muted-foreground">
              {t("fxSettings.autoImport.staleAlertDaysHint")}
            </p>
          </div>
        </div>
      </EnterpriseModal>
    </EnterpriseCard>
  );
}
