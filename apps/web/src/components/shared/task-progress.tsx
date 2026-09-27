"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Ban, RotateCcw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { EnterpriseButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/i18n/translate";

export type TaskProgressStatus = "running" | "succeeded" | "partial" | "failed" | "cancelled";

export interface TaskProgressError {
  id: string;
  /** Where it happened — e.g. "Row 12 · SKU". */
  label?: string;
  message: string;
  /** What to do about it. */
  hint?: string;
}

const STATUS_KEY: Record<TaskProgressStatus, MessageKey> = {
  running: "feedback.task.running",
  succeeded: "feedback.task.succeeded",
  partial: "feedback.task.partial",
  failed: "feedback.task.failed",
  cancelled: "feedback.task.cancelled",
};

const STATUS_TONE: Record<TaskProgressStatus, string> = {
  running: "border-border",
  succeeded: "border-success-border",
  partial: "border-warning-border",
  failed: "border-destructive-border",
  cancelled: "border-border",
};

/** Derives the terminal status from counts: all good / some failed / nothing succeeded. */
export function taskStatusFromCounts(succeeded: number, failed: number): TaskProgressStatus {
  if (failed === 0) return "succeeded";
  return succeeded > 0 ? "partial" : "failed";
}

/**
 * Progress + outcome for imports and other long tasks (design-system §11.4):
 * a determinate bar when `total`/`processed` are known (indeterminate
 * otherwise), completion counts, the first `maxErrors` errors with "show
 * all", and Retry/Cancel actions. Stays on the page — never a toast.
 *
 * Screen readers get polite, throttled updates (`announceIntervalMs`) while
 * running and one summary when it finishes. It never moves focus.
 */
export function TaskProgress({
  status,
  title,
  description,
  total,
  processed,
  succeeded,
  failed,
  skipped,
  errors = [],
  maxErrors = 5,
  onRetry,
  retryLabel,
  isRetrying = false,
  onCancel,
  cancelLabel,
  actions,
  announceIntervalMs = 5000,
  className,
}: {
  status: TaskProgressStatus;
  title?: ReactNode;
  description?: ReactNode;
  total?: number | null;
  processed?: number | null;
  succeeded?: number | null;
  failed?: number | null;
  skipped?: number | null;
  errors?: TaskProgressError[];
  maxErrors?: number;
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
  /** Only pass when the task can really be cancelled. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Extra actions (e.g. "Download error report"). */
  actions?: ReactNode;
  announceIntervalMs?: number;
  className?: string;
}) {
  const { t } = useLocale();
  const titleId = useId();
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounce = useRef<{ at: number; status: TaskProgressStatus | null }>({
    at: 0,
    status: null,
  });

  const running = status === "running";
  const determinate = total != null && total > 0 && processed != null;
  const percent = determinate ? Math.min(100, Math.round((processed! / total!) * 100)) : null;
  const statusText = t(STATUS_KEY[status]);

  useEffect(() => {
    const now = Date.now();
    const previous = lastAnnounce.current;
    let message: string | null = null;
    if (!running) {
      if (previous.status !== status) {
        message = t("feedback.task.announceDone", {
          status: statusText,
          succeeded: succeeded ?? 0,
          failed: failed ?? 0,
        });
      }
    } else if (previous.status !== "running" || now - previous.at >= announceIntervalMs) {
      message = determinate
        ? t("feedback.task.announceProgress", { processed: processed!, total: total! })
        : statusText;
    }
    if (message !== null) {
      lastAnnounce.current = { at: now, status };
      setAnnouncement(message);
    }
  }, [
    status,
    running,
    processed,
    total,
    succeeded,
    failed,
    determinate,
    statusText,
    announceIntervalMs,
    t,
  ]);

  const counts: { key: string; label: string; value: number; className?: string }[] = [];
  if (total != null) counts.push({ key: "total", label: t("feedback.task.total"), value: total });
  if (processed != null && (running || processed !== total))
    counts.push({ key: "processed", label: t("feedback.task.processed"), value: processed });
  if (succeeded != null)
    counts.push({
      key: "succeeded",
      label: t("feedback.task.succeededCount"),
      value: succeeded,
      className: succeeded > 0 ? "text-success" : undefined,
    });
  if (failed != null)
    counts.push({
      key: "failed",
      label: t("feedback.task.failedCount"),
      value: failed,
      className: failed > 0 ? "text-destructive" : undefined,
    });
  if (skipped != null && skipped > 0)
    counts.push({ key: "skipped", label: t("feedback.task.skippedCount"), value: skipped });

  const visibleErrors = showAllErrors ? errors : errors.slice(0, maxErrors);
  const StatusIcon =
    status === "succeeded"
      ? CircleCheck
      : status === "cancelled"
        ? Ban
        : status === "running"
          ? null
          : CircleAlert;

  return (
    <section
      data-slot="task-progress"
      data-status={status}
      aria-labelledby={titleId}
      aria-busy={running || undefined}
      className={cn(
        "flex flex-col gap-3 rounded-sm border bg-card px-3 py-3",
        STATUS_TONE[status],
        className,
      )}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {running ? (
            <Spinner aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : StatusIcon ? (
            <StatusIcon
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-4 shrink-0",
                status === "succeeded" && "text-success",
                status === "partial" && "text-warning",
                status === "failed" && "text-destructive",
                status === "cancelled" && "text-muted-foreground",
              )}
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id={titleId} className="text-body font-semibold">
              {title ?? statusText}
            </h3>
            {title ? <p className="text-caption text-muted-foreground">{statusText}</p> : null}
            {description ? (
              <div className="text-caption text-muted-foreground">{description}</div>
            ) : null}
          </div>
        </div>
        {(onRetry || onCancel || actions) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {onCancel && running ? (
              <EnterpriseButton type="button" variant="outline" size="sm" onClick={onCancel}>
                {cancelLabel ?? t("feedback.task.cancel")}
              </EnterpriseButton>
            ) : null}
            {onRetry && !running ? (
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                isLoading={isRetrying}
              >
                <RotateCcw />
                {retryLabel ?? t("feedback.task.retry")}
              </EnterpriseButton>
            ) : null}
          </div>
        )}
      </div>

      {running ? (
        determinate ? (
          <div className="flex flex-col gap-1">
            <Progress
              value={percent}
              // ui/progress does not forward `value` to the Radix root, so the
              // root would report "indeterminate" — state the value explicitly.
              aria-valuenow={percent ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={statusText}
              aria-valuetext={t("feedback.task.processedOf", {
                processed: processed!,
                total: total!,
              })}
            />
            <p className="num text-caption text-muted-foreground">
              {t("feedback.task.processedOf", { processed: processed!, total: total! })}
            </p>
          </div>
        ) : (
          <div
            role="progressbar"
            aria-label={statusText}
            aria-valuetext={
              total != null ? t("feedback.task.processingTotal", { total }) : statusText
            }
            className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div className="absolute inset-y-0 start-0 w-1/3 rounded-full bg-primary/70 motion-safe:animate-pulse" />
          </div>
        )
      ) : null}

      {counts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counts.map((count) => (
            <div
              key={count.key}
              data-count={count.key}
              className="flex flex-col gap-0.5 rounded-sm border border-border px-2.5 py-1.5"
            >
              <dt className="text-caption text-muted-foreground">{count.label}</dt>
              <dd className={cn("num text-card-title font-semibold", count.className)}>
                {count.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {errors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-caption font-semibold">
            {t("feedback.task.errorsTitle")} ({errors.length})
          </h4>
          <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
            {visibleErrors.map((error) => (
              <li key={error.id} className="flex flex-col gap-0.5 px-2.5 py-1.5 text-caption">
                <span>
                  {error.label ? (
                    <span className="font-medium text-foreground">{error.label}: </span>
                  ) : null}
                  <span className="text-destructive">{error.message}</span>
                </span>
                {error.hint ? <span className="text-muted-foreground">{error.hint}</span> : null}
              </li>
            ))}
          </ul>
          {errors.length > maxErrors && (
            <EnterpriseButton
              type="button"
              variant="link"
              size="sm"
              className="self-start px-0"
              aria-expanded={showAllErrors}
              onClick={() => setShowAllErrors((value) => !value)}
            >
              {showAllErrors
                ? t("feedback.task.showFewer")
                : t("feedback.task.showAll", { count: errors.length })}
            </EnterpriseButton>
          )}
        </div>
      )}
    </section>
  );
}
