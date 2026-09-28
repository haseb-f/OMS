"use client";

import { Fragment, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { StatusTone } from "@/components/business/status-tone";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Round 3.1 (design-system §12.7) — the one read-only tracker for a
 * multi-step workflow: where a record is on its happy path, which steps are
 * done, which come next, and — when it left that path — the branch/terminal
 * state it is in instead (Lost, Cancelled, Returned, Payment review…).
 *
 * Presentation only. Callers map their REAL status codes onto `stages` /
 * `current` / `state`; this component never infers business meaning and
 * never invents stages. It is never interactive: no buttons, no pointer, no
 * hover — status changes happen through the page's actions.
 *
 * Two forms, chosen by the width the tracker actually gets (container query):
 *   full     ● Stage ── ● Stage ── ○ Stage   | ✕ Closed state
 *   compact  Stage · 2 / 4                     ▬▬▬▬ (segmented bar)
 */

/** Same semantic tones as StatusBadge. */
export type WorkflowTrackerTone = StatusTone;

export interface WorkflowStage {
  key: string;
  label: string;
  /** Optional one-line context under the stage (e.g. the date it was reached). */
  caption?: string | null;
  /**
   * Not every record passes this stage (e.g. Partially paid, Approved when
   * Confirm may approve implicitly). It is shown only while it is the current
   * stage, or when the caller proves it was passed (listed in `completed`) —
   * never as an unverified completed step.
   */
  optional?: boolean;
}

export interface WorkflowTrackerState {
  /** Names the state (e.g. «ملغي», «مرتجع», the catalog status name). */
  label: string;
  tone: WorkflowTrackerTone;
  /**
   * Where the state sits on the path:
   * - "before": a pre-start state (Unfulfilled, Not ready) — before the first stage;
   * - "inline": a branch at the reached point (Payment review, Submitted) —
   *   right after the last completed stage, with the rest still ahead;
   * - "after" (default): a terminal / post-path state (Cancelled, Returned, Lost).
   */
  placement?: "before" | "inline" | "after";
}

export interface WorkflowTrackerProps {
  /** Accessible name of the track (e.g. «الدفع / Payment»). */
  label: string;
  /** The happy path, in order. */
  stages: readonly WorkflowStage[];
  /** Key of the stage the record is at (or last reached, with `state`). */
  current?: string | null;
  /** The current stage is itself finished (the final stage was reached). */
  currentComplete?: boolean;
  /** Explicit completed keys; by default every stage before `current`. */
  completed?: ReadonlySet<string>;
  /**
   * The record is off the happy path (pre-start, branch or terminal state).
   * It becomes the current step, drawn where `placement` says; happy-path
   * stages keep only their completed marks.
   */
  state?: WorkflowTrackerState | null;
  /** Container width from which the full stepper replaces the compact form. */
  fullFrom?: "lg" | "xl" | "2xl" | "3xl";
  className?: string;
}

export interface ResolvedWorkflowStep extends WorkflowStage {
  done: boolean;
  current: boolean;
}

export interface ResolvedWorkflowTrack {
  steps: ResolvedWorkflowStep[];
  /** 1-based position on the happy path; null when off the path. */
  position: number | null;
  total: number;
  currentLabel: string;
  /** Index in `steps` before which the state is drawn (steps.length = at the end). */
  stateIndex: number;
}

/** Pure mapping from props to per-step marks (unit-tested). */
export function resolveWorkflowTrack({
  stages: allStages,
  current,
  currentComplete = false,
  completed,
  state,
}: Pick<
  WorkflowTrackerProps,
  "stages" | "current" | "currentComplete" | "completed" | "state"
>): ResolvedWorkflowTrack {
  const stages = allStages.filter(
    (stage) => !stage.optional || stage.key === current || Boolean(completed?.has(stage.key)),
  );
  const index = current ? stages.findIndex((stage) => stage.key === current) : -1;
  const done =
    completed ??
    new Set(
      stages
        .filter((_, i) => i < index || (i === index && currentComplete))
        .map((stage) => stage.key),
    );
  const steps = stages.map((stage, i) => ({
    ...stage,
    done: done.has(stage.key),
    current: !state && i === index,
  }));
  return {
    steps,
    position: state || index === -1 ? null : index + 1,
    total: stages.length,
    stateIndex:
      state?.placement === "before"
        ? 0
        : state?.placement === "inline"
          ? steps.filter((step) => step.done).length
          : steps.length,
    currentLabel: state?.label ?? (index === -1 ? "" : stages[index].label),
  };
}

const FULL_FROM = {
  lg: { compact: "@lg:hidden", full: "@lg:flex" },
  xl: { compact: "@xl:hidden", full: "@xl:flex" },
  "2xl": { compact: "@2xl:hidden", full: "@2xl:flex" },
  "3xl": { compact: "@3xl:hidden", full: "@3xl:flex" },
} as const;

const STATE_TONE: Record<WorkflowTrackerTone, string> = {
  neutral: "bg-neutral-soft text-neutral-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
};

export function WorkflowTracker({
  label,
  stages,
  current,
  currentComplete,
  completed,
  state,
  fullFrom = "xl",
  className,
}: WorkflowTrackerProps) {
  const { t } = useLocale();
  const { steps, position, total, currentLabel, stateIndex } = resolveWorkflowTrack({
    stages,
    current,
    currentComplete,
    completed,
    state,
  });
  const form = FULL_FROM[fullFrom];

  return (
    <div data-slot="workflow-tracker" className={cn("@container min-w-0 flex-1", className)}>
      {/* Compact: current stage + position + a segmented bar (never clipped). */}
      <div className={cn("flex min-w-0 items-center gap-2", form.compact)}>
        <span className="min-w-0 truncate text-caption font-semibold text-foreground">
          {currentLabel}
        </span>
        {position ? (
          <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
            {t("workflowTracker.position", { position, total })}
          </span>
        ) : null}
        <span
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={steps.filter((step) => step.done || step.current).length}
          aria-valuetext={currentLabel}
          className="ms-auto flex w-24 shrink-0 gap-0.5"
        >
          {steps.map((step) => (
            <span
              key={step.key}
              className={cn(
                "h-1 flex-1 rounded-full",
                step.done ? "bg-success" : step.current ? "bg-foreground" : "bg-border",
              )}
            />
          ))}
        </span>
      </div>

      <ol aria-label={label} className={cn("hidden min-w-0 items-center gap-2", form.full)}>
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const stateFollows = Boolean(state) && stateIndex === i + 1 && i + 1 < steps.length;
          return (
            <Fragment key={step.key}>
              {state && i === stateIndex ? <StateStep state={state} connector /> : null}
              <li
                aria-current={step.current ? "step" : undefined}
                className="flex shrink-0 items-center gap-2"
              >
                <StepMarker done={step.done} current={step.current} />
                <span className="flex flex-col">
                  <span
                    className={cn(
                      "text-caption whitespace-nowrap",
                      step.current
                        ? "font-semibold text-foreground"
                        : step.done
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  {step.caption ? (
                    <span className="num text-micro whitespace-nowrap text-muted-foreground">
                      {step.caption}
                    </span>
                  ) : null}
                </span>
                <span className="sr-only">
                  {step.current
                    ? t("workflowTracker.current")
                    : step.done
                      ? t("workflowTracker.completed")
                      : t("workflowTracker.upcoming")}
                </span>
                {next ? (
                  <Connector done={!stateFollows && step.done && (next.done || next.current)} />
                ) : null}
              </li>
            </Fragment>
          );
        })}
        {state && stateIndex >= steps.length ? (
          <StateStep state={state} separated={steps.length > 0} />
        ) : null}
      </ol>
    </div>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={cn("h-px w-10 shrink-0", done ? "bg-success" : "bg-border")} />
  );
}

/**
 * Step marker. Never looks selectable (no ring-with-dot "radio" look):
 * done = filled check, current = solid dot with a soft halo, upcoming = a
 * small muted dot.
 */
function StepMarker({ done, current }: { done: boolean; current: boolean }) {
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
      {done ? (
        <span className="flex size-4 items-center justify-center rounded-full bg-success text-success-foreground">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : current ? (
        <span className="size-2.5 rounded-full bg-foreground ring-4 ring-foreground/15" />
      ) : (
        <span className="size-2 rounded-full bg-border-strong" />
      )}
    </span>
  );
}

/** The off-path state as the current step. */
function StateStep({
  state,
  connector = false,
  separated = false,
}: {
  state: WorkflowTrackerState;
  /** Stages follow (placement before/inline). */
  connector?: boolean;
  /** Terminal state after the stages: a divider instead of a connector. */
  separated?: boolean;
}) {
  const { t } = useLocale();
  return (
    <li
      aria-current="step"
      className={cn(
        "flex shrink-0 items-center gap-1.5",
        separated && "border-s border-border ps-3",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 items-center justify-center rounded-full",
          STATE_TONE[state.tone],
        )}
      >
        {state.tone === "destructive" ? (
          <X className="size-2.5" strokeWidth={3} />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className="text-caption font-semibold whitespace-nowrap text-foreground">
        {state.label}
      </span>
      <span className="sr-only">{t("workflowTracker.current")}</span>
      {connector ? <Connector done={false} /> : null}
    </li>
  );
}

export interface WorkflowTrack extends WorkflowTrackerProps {
  key: string;
  /** Optional one-line context for the track (e.g. what Sales declared). */
  meta?: ReactNode;
}

/**
 * Independent tracks of one record, each labeled — e.g. «الدفع / Payment»
 * and «التنفيذ / Fulfillment» on a store order. Tracks never merge: each has
 * its own stages, current step and state.
 */
export function WorkflowTracks({
  label,
  tracks,
  className,
}: {
  /** Accessible name of the whole group. */
  label: string;
  tracks: WorkflowTrack[];
  className?: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="workflow-tracks"
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      {tracks.map(({ key, meta, ...track }) => (
        <section
          key={key}
          className="grid min-w-0 gap-x-3 gap-y-0.5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center"
        >
          <h3 className="text-caption text-muted-foreground">{track.label}</h3>
          <WorkflowTracker {...track} />
          {meta ? (
            <p className="min-w-0 truncate text-micro text-muted-foreground sm:col-start-2">
              {meta}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
