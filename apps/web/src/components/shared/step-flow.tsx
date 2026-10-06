"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { SubmitButton } from "@/components/shared/form-fields/submit-button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface StepFlowStep {
  id: string;
  label: string;
}

/**
 * StepFlow — the one header for a multi-step form (an order, a wizard): numbered
 * steps with their state (completed / current / remaining). Completed steps are
 * buttons that go back to them; forward moves happen only through the footer's
 * Next, so a step is never skipped. On phones the list collapses to one line
 * ("Step 2 of 4 · Products") over a thin progress bar.
 *
 * Put it in `EnterpriseModal`'s `subheader` (stays visible while the body
 * scrolls) and `StepFlowFooter` in its `footer` (stays above the keyboard).
 * One form instance spans every step — the steps only decide what is shown.
 */
export function StepFlow({
  steps,
  currentIndex,
  onStepSelect,
  className,
}: {
  steps: readonly StepFlowStep[];
  currentIndex: number;
  /** Called with a completed step's index when its header is clicked. Omit to make the header read-only. */
  onStepSelect?: (index: number) => void;
  className?: string;
}) {
  const { t } = useLocale();
  const total = steps.length;
  const current = steps[currentIndex];
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;

  return (
    <nav aria-label={t("common.stepFlow.label")} className={cn("min-w-0", className)}>
      {/* Phones: one compact line + progress bar. */}
      <div className="flex flex-col gap-1.5 sm:hidden" data-testid="step-flow-compact">
        <p className="truncate text-caption">
          <span className="text-muted-foreground">
            {t("common.stepFlow.progress", { current: currentIndex + 1, total })}
          </span>
          {current ? (
            <span className="font-semibold text-foreground"> · {current.label}</span>
          ) : null}
        </p>
        <div className="h-0.5 w-full overflow-hidden bg-muted" aria-hidden>
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ol className="hidden items-center gap-2 sm:flex" data-testid="step-flow-list">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          const marker = (
            <span
              aria-hidden
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-semibold",
                state === "current" && "bg-primary text-primary-foreground",
                state === "complete" && "border border-primary bg-card text-primary",
                state === "upcoming" && "bg-muted text-muted-foreground",
              )}
            >
              {state === "complete" ? <Check className="size-3" /> : index + 1}
            </span>
          );
          const label = (
            <span
              className={cn(
                "min-w-0 truncate text-caption",
                state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
              {state === "complete" ? (
                <span className="sr-only"> ({t("common.stepFlow.completed")})</span>
              ) : null}
            </span>
          );
          return (
            <li
              key={step.id}
              data-state={state}
              className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
            >
              {state === "complete" && onStepSelect ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(index)}
                  className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  {marker}
                  {label}
                </button>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {marker}
                  {label}
                </span>
              )}
              {index < total - 1 ? (
                <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The footer of a StepFlow: Cancel at the start edge; Back + Next (or the final
 * action on the last step) at the end edge — one row, also on phones. Every
 * button is `type="button"`: nothing submits by Enter or skips a step.
 */
export function StepFlowFooter({
  currentIndex,
  stepCount,
  onBack,
  onNext,
  requestClose,
  finalLabel,
  onFinal,
  isSubmitting = false,
  isBusy = false,
  finalDisabled = false,
  extra,
}: {
  currentIndex: number;
  stepCount: number;
  onBack: () => void;
  onNext: () => void;
  /** The modal's guarded close (keeps the unsaved-changes confirmation). */
  requestClose: () => void;
  finalLabel: string;
  onFinal: () => void;
  isSubmitting?: boolean;
  /** A step check is running (e.g. async validation) — Next waits. */
  isBusy?: boolean;
  finalDisabled?: boolean;
  /** Optional content between Cancel and Back (e.g. a hint). */
  extra?: ReactNode;
}) {
  const { t } = useLocale();
  const isFirst = currentIndex === 0;
  const isLast = currentIndex >= stepCount - 1;

  return (
    <div className="flex w-full min-w-0 items-center gap-2" data-testid="step-flow-footer">
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={requestClose}
        disabled={isSubmitting}
        // Phones keep one row: after the first step Back takes Cancel's place (the header X still closes).
        className={cn("me-auto", !isFirst && "max-sm:hidden")}
      >
        {t("common.cancel")}
      </EnterpriseButton>
      {extra}
      {!isFirst ? (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={isSubmitting}
          className={cn(!isFirst && "max-sm:me-auto")}
        >
          {t("common.back")}
        </EnterpriseButton>
      ) : null}
      {isLast ? (
        <SubmitButton
          type="button"
          size="sm"
          isSubmitting={isSubmitting}
          disabled={finalDisabled}
          onClick={onFinal}
          data-testid="step-flow-final"
        >
          {finalLabel}
        </SubmitButton>
      ) : (
        <EnterpriseButton
          type="button"
          size="sm"
          onClick={onNext}
          isLoading={isBusy}
          data-testid="step-flow-next"
        >
          {t("common.next")}
        </EnterpriseButton>
      )}
    </div>
  );
}
