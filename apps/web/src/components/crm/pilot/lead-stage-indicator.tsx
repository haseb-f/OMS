"use client";

import { Check, X } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const STAGES = ["NEW", "IN_PROGRESS", "QUALIFIED", "CONVERTED"] as const;
type Stage = (typeof STAGES)[number];

/**
 * Where a lead sits in its lifecycle, derived from `status.code` only:
 * NEW → (every working status) → QUALIFIED → CONVERTED. LOST/DISQUALIFIED
 * are a closed end state, not a step.
 */
export function leadStage(code: string | null | undefined): {
  index: number;
  closed: boolean;
} {
  if (code === "LOST" || code === "DISQUALIFIED") return { index: -1, closed: true };
  const index = STAGES.indexOf(code as Stage);
  return { index: index === -1 ? 1 : index, closed: false };
}

/** Round 3 pilot: compact lead stage indicator (design-system §12.6). */
export function LeadStageIndicator({
  statusCode,
  closedLabel,
  className,
}: {
  statusCode: string | null | undefined;
  /** Name of the closing status (e.g. «غير مؤهل»), shown on the closed marker. */
  closedLabel?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const { index, closed } = leadStage(statusCode);
  const converted = index === STAGES.length - 1;

  const position = converted ? STAGES.length : index + 1;
  const currentLabel = closed
    ? (closedLabel ?? t("crm.leads.stage.closed"))
    : t(`crm.leads.stage.${STAGES[index]}`);

  return (
    <>
      {/* Phones: current stage + position + a mini progress bar (never clipped). */}
      <div className={cn("flex min-w-0 flex-1 items-center gap-2 sm:hidden", className)}>
        <span className="min-w-0 truncate text-caption font-semibold text-foreground">
          {currentLabel}
        </span>
        {closed ? null : (
          <span dir="ltr" className="num shrink-0 text-caption text-muted-foreground">
            {position} / {STAGES.length}
          </span>
        )}
        <span
          role="progressbar"
          aria-label={t("crm.leads.stage.label")}
          aria-valuemin={0}
          aria-valuemax={STAGES.length}
          aria-valuenow={closed ? 0 : position}
          aria-valuetext={currentLabel}
          className="ms-auto flex w-24 shrink-0 gap-0.5"
        >
          {STAGES.map((stage, i) => (
            <span
              key={stage}
              className={cn(
                "h-1 flex-1 rounded-full",
                closed
                  ? "bg-border"
                  : i < index || converted
                    ? "bg-success"
                    : i === index
                      ? "bg-foreground"
                      : "bg-border",
              )}
            />
          ))}
        </span>
      </div>
      <ol
        aria-label={t("crm.leads.stage.label")}
        className={cn("hidden min-w-0 items-center gap-2 sm:flex", className)}
      >
        {STAGES.map((stage, i) => {
          const done = !closed && (i < index || converted);
          const current = !closed && i === index && !converted;
          return (
            <li
              key={stage}
              aria-current={current || (converted && i === index) ? "step" : undefined}
              className="flex shrink-0 items-center gap-2"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  done && "border-transparent bg-success text-success-foreground",
                  current && "border-foreground bg-card ring-2 ring-foreground/10",
                  !done && !current && "border-input bg-card",
                )}
              >
                {done ? <Check className="size-2.5" strokeWidth={3} /> : null}
                {current ? <span className="size-1.5 rounded-full bg-foreground" /> : null}
              </span>
              <span
                className={cn(
                  "shrink-0 text-caption whitespace-nowrap",
                  current || (converted && i === index)
                    ? "font-semibold text-foreground"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {t(`crm.leads.stage.${stage}`)}
              </span>
              {i < STAGES.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-10 shrink-0",
                    !closed && i < index ? "bg-success" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
        {closed ? (
          <li
            aria-current="step"
            className="flex shrink-0 items-center gap-1.5 border-s border-border ps-3"
          >
            <span
              aria-hidden
              className="flex size-4 items-center justify-center rounded-full bg-destructive-soft text-destructive-soft-foreground"
            >
              <X className="size-2.5" strokeWidth={3} />
            </span>
            <span className="text-caption font-semibold whitespace-nowrap text-foreground">
              {closedLabel ?? t("crm.leads.stage.closed")}
            </span>
          </li>
        ) : null}
      </ol>
    </>
  );
}
