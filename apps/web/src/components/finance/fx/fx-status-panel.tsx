"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, Info, PauseCircle, Power } from "lucide-react";
import { StatusBadge } from "@/components/business/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { formatBusinessDateTime } from "@/lib/business-date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import type { FxSyncStatus } from "@/services/fx-service";
import { fxDayLabel } from "./fx-format";
import {
  FRESHNESS_ICON,
  FRESHNESS_TONE,
  deriveFxOverallState,
  elapsedSeconds,
  runErrorSummary,
  utcTimeLabel,
  runCounts,
  runVisual,
  schedulerPaused,
  serverOffsetMs,
} from "./fx-sync-state";

/** Ticks once a second while `active` — drives the cooldown and "started N s ago" text. */
export function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function StateTile({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid={testId}
    >
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * The five separate facts of the automatic FX import — switch, current run,
 * last run, rate freshness, next scheduled run — each with its own semantic
 * colour, icon AND text. "On" never implies "fresh", and a failed last run
 * never hides behind a green switch.
 */
export function FxStatusPanel({
  status,
  receivedAtMs,
  canManage,
  toggleBusy,
  onToggle,
}: {
  status: FxSyncStatus | null;
  /** Browser time at which `status` arrived (anchors the server-clock offset). */
  receivedAtMs: number;
  canManage: boolean;
  toggleBusy: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useLocale();
  const now = useNowTick(Boolean(status?.running));
  if (!status) return null;

  const offset = serverOffsetMs(status, receivedAtMs);
  const paused = schedulerPaused(status);
  const lastRun = status.lastRun;
  const visual = runVisual(lastRun);
  const counts = lastRun ? runCounts(lastRun) : null;
  const lastRunFailed = lastRun?.status === "FAILED" || lastRun?.status === "PARTIAL";
  const overall = deriveFxOverallState(status);
  const OverallIcon = overall.icon;
  const overallHint = t(`fxSettings.state.overall.hint.${overall.key}` as MessageKey, {
    error: runErrorSummary(overall.run) ?? t("fxSettings.state.overall.noDetails"),
    date: fxDayLabel(t, status.newestEffectiveDate),
    days: status.settings.staleAlertDays,
  });
  const lastSuccessAt = status.lastSuccess
    ? (status.lastSuccess.finishedAt ?? status.lastSuccess.startedAt)
    : null;
  const triggerText = (trigger: string) =>
    t(
      (["CRON", "MANUAL", "BACKFILL"].includes(trigger)
        ? `fxSettings.runTrigger.${trigger}`
        : "fxSettings.runTrigger.CRON") as MessageKey,
    );
  const FreshIcon = FRESHNESS_ICON[status.freshness];
  const next = status.nextRun;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="fx-status-panel">
      {/* 0 — the one headline state (icon + text, never colour alone) */}
      <div
        className="flex min-w-0 flex-col gap-1 rounded-md border border-border px-3 py-2 sm:col-span-2"
        data-testid="fx-state-overall"
        data-state={overall.key}
        role="status"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {t("fxSettings.state.overall.label")}
          </span>
          <StatusBadge
            label={t(`fxSettings.state.overall.${overall.key}` as MessageKey)}
            tone={overall.tone}
            icon={OverallIcon}
          />
        </div>
        <span
          className={
            overall.key === "FAILED"
              ? "break-words text-caption text-destructive"
              : "break-words text-caption text-muted-foreground"
          }
        >
          {overallHint}
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-caption text-muted-foreground">
          <span className="num" data-testid="fx-last-success">
            {lastSuccessAt
              ? t("fxSettings.state.overall.lastSuccess", {
                  at: formatBusinessDateTime(lastSuccessAt),
                })
              : t("fxSettings.state.freshness.noSuccess")}
          </span>
          {status.newestEffectiveDate ? (
            <span>
              {t("fxSettings.state.overall.effectiveDate", {
                date: fxDayLabel(t, status.newestEffectiveDate),
              })}
            </span>
          ) : null}
        </span>
      </div>

      {/* 1 — switch */}
      <StateTile label={t("fxSettings.state.autoImport.label")} testId="fx-state-switch">
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            checked={status.settings.enabled}
            disabled={!canManage || toggleBusy}
            onCheckedChange={onToggle}
            aria-label={t("fxSettings.state.autoImport.label")}
          />
          <StatusBadge
            label={
              paused ? t("fxSettings.state.autoImport.paused") : t("fxSettings.state.autoImport.on")
            }
            tone={paused ? "neutral" : "success"}
            icon={paused ? PauseCircle : Power}
          />
        </div>
        <span className="text-caption text-muted-foreground">
          {paused
            ? t("fxSettings.state.autoImport.pausedHint")
            : t("fxSettings.state.autoImport.onHint")}
        </span>
      </StateTile>

      {/* 2 — current run (live) */}
      <StateTile label={t("fxSettings.state.running.label")} testId="fx-state-running">
        {status.running ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <Spinner aria-hidden className="size-3.5 text-info-soft-foreground" />
              <StatusBadge label={t("fxSettings.state.running.running")} tone="info" />
            </span>
            <span className="text-caption text-muted-foreground">
              {t("fxSettings.state.running.runningHint", {
                trigger: triggerText(status.running.trigger),
                seconds: elapsedSeconds(status.running.startedAt, now, offset),
              })}
            </span>
          </>
        ) : (
          <>
            <StatusBadge label={t("fxSettings.state.running.idle")} tone="neutral" />
            <span className="text-caption text-muted-foreground">
              {t("fxSettings.state.running.idleHint")}
            </span>
          </>
        )}
      </StateTile>

      {/* 3 — last run outcome */}
      <StateTile label={t("fxSettings.state.lastRun.label")} testId="fx-state-last-run">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            label={t(`fxSettings.state.lastRun.status.${visual.key}` as MessageKey)}
            tone={visual.tone}
            icon={visual.icon}
          />
          {lastRun ? (
            <span className="num text-caption text-muted-foreground">
              {formatBusinessDateTime(lastRun.startedAt)} · {triggerText(lastRun.trigger)}
            </span>
          ) : null}
        </div>
        {lastRunFailed && runErrorSummary(lastRun) ? (
          <span
            className={
              lastRun?.status === "FAILED"
                ? "break-words text-caption text-destructive"
                : "break-words text-caption text-warning-foreground"
            }
            data-testid="fx-last-error"
          >
            {t("fxSettings.state.lastRun.reason", { error: runErrorSummary(lastRun) ?? "" })}
          </span>
        ) : null}
        {lastRun?.status === "SKIPPED" ? (
          <span className="text-caption text-muted-foreground">
            {lastRun.details?.reason === "ALREADY_CURRENT" ||
            lastRun.details?.reason === "DISABLED" ||
            lastRun.details?.reason === "ALREADY_RUNNING"
              ? t(`fxSettings.runReason.${lastRun.details.reason}`)
              : null}
          </span>
        ) : null}
        {counts &&
        lastRun?.status !== "SKIPPED" &&
        lastRun?.status !== "FAILED" &&
        lastRun?.status !== "RUNNING" ? (
          <span className="text-caption text-muted-foreground">
            {t("fxSettings.state.lastRun.counts", counts)}
          </span>
        ) : null}
      </StateTile>

      {/* 4 — rate freshness (independent of the switch and of the last run) */}
      <StateTile label={t("fxSettings.state.freshness.label")} testId="fx-state-freshness">
        <StatusBadge
          label={t(`fxSettings.state.freshness.${status.freshness}` as MessageKey)}
          tone={FRESHNESS_TONE[status.freshness]}
          icon={FreshIcon}
        />
        {status.newestEffectiveDate ? (
          <span className="text-caption text-muted-foreground">
            {status.newestAgeDays
              ? t("fxSettings.state.freshness.detail", {
                  date: fxDayLabel(t, status.newestEffectiveDate),
                  days: status.newestAgeDays,
                })
              : t("fxSettings.state.freshness.detailToday", {
                  date: fxDayLabel(t, status.newestEffectiveDate),
                })}
          </span>
        ) : null}
        <span className="text-caption text-muted-foreground">
          {t("fxSettings.state.freshness.threshold", { days: status.settings.staleAlertDays })}
        </span>
      </StateTile>

      {/* 5 — next scheduled run, Cairo time */}
      <StateTile label={t("fxSettings.state.next.label")} testId="fx-state-next">
        {paused ? (
          <>
            <StatusBadge
              label={t("fxSettings.state.autoImport.paused")}
              tone="neutral"
              icon={PauseCircle}
            />
            <span className="text-caption text-muted-foreground">
              {t("fxSettings.state.next.paused")}
            </span>
          </>
        ) : next ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-body">
              <CalendarClock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="num">
                {t("fxSettings.state.next.atUtc", {
                  at: formatBusinessDateTime(next.at),
                  utc: utcTimeLabel(next.at),
                })}
              </span>
            </span>
            <span className="text-caption text-muted-foreground">
              {next.slot === "late"
                ? t("fxSettings.state.next.slotLate")
                : t("fxSettings.state.next.slotPrimary")}
            </span>
          </>
        ) : (
          "—"
        )}
      </StateTile>

      {/* Progressive disclosure: the rules the import follows, stated from the code. */}
      <Collapsible className="sm:col-span-2" data-testid="fx-how-it-works">
        <CollapsibleTrigger asChild>
          <DisclosureTrigger>
            <Info aria-hidden className="size-3.5" />
            {t("fxSettings.howItWorks.toggle")}
          </DisclosureTrigger>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ms-5 mt-1 list-disc space-y-1 text-caption text-muted-foreground">
            <li>{t("fxSettings.howItWorks.schedule")}</li>
            <li>{t("fxSettings.howItWorks.source")}</li>
            <li>
              {t("fxSettings.howItWorks.basis", {
                basis: t(`fxSettings.autoImport.basisOptions.${status.settings.rateBasis}`),
              })}
            </li>
            <li>{t("fxSettings.howItWorks.manual")}</li>
            <li>{t("fxSettings.howItWorks.weekends")}</li>
            <li>{t("fxSettings.howItWorks.stale", { days: status.settings.maxStaleDays })}</li>
            <li>{t("fxSettings.howItWorks.frozen")}</li>
            <li>{t("fxSettings.howItWorks.refresh")}</li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
