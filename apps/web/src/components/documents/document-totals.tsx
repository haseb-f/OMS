import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface DocumentTotalsLine {
  key: string;
  label: ReactNode;
  value: number;
}

export interface DocumentTotalsGrandLine extends DocumentTotalsLine {
  /** State that must never be carried by color alone (e.g. an "Unbalanced" badge). */
  flag?: ReactNode;
}

/**
 * The ONE totals block every document editor renders (commercial documents,
 * receipts/payments/refunds, journal entries): detail rows in `text-body`,
 * then the grand line in `text-card-title font-semibold` above a strong top
 * rule, on the sunken surface, aligned to the numeric (logical end) edge.
 * Presentation only — callers pass figures they computed (or the server did).
 */
export function DocumentTotalsBlock({
  lines,
  total,
  currency,
  className,
  label,
}: {
  lines: DocumentTotalsLine[];
  total?: DocumentTotalsGrandLine;
  currency?: string | null;
  className?: string;
  /** Accessible name for the totals region. */
  label?: string;
}) {
  return (
    <div className={cn("flex justify-end", className)}>
      <dl
        aria-label={label}
        data-testid="document-totals"
        className="flex w-full flex-col gap-0.5 rounded-md bg-surface-sunken px-3 py-2 sm:max-w-sm"
      >
        {lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-4 text-body">
            <dt className="min-w-0 text-muted-foreground">{line.label}</dt>
            <dd className="num shrink-0 text-end text-foreground">
              {formatMoney(line.value, currency)}
            </dd>
          </div>
        ))}
        {total ? (
          <div
            className={cn(
              "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-card-title font-semibold",
              lines.length > 0 && "mt-1 border-t border-border-strong pt-2",
            )}
          >
            <dt className="flex min-w-0 flex-wrap items-center gap-2">
              {total.label}
              {total.flag}
            </dt>
            <dd className="num ms-auto shrink-0 text-end text-foreground">
              {formatMoney(total.value, currency)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/** Loading placeholder in the final shape of the totals block. */
export function DocumentTotalsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex justify-end", className)} role="status" aria-busy="true">
      <div className="flex w-full flex-col gap-2 rounded-md bg-surface-sunken px-3 py-2.5 sm:max-w-sm">
        <div className="h-3.5 w-full animate-pulse rounded-xs bg-muted motion-reduce:animate-none" />
        <div className="h-3.5 w-full animate-pulse rounded-xs bg-muted motion-reduce:animate-none" />
        <div className="mt-1 h-5 w-full animate-pulse rounded-xs bg-muted motion-reduce:animate-none" />
      </div>
    </div>
  );
}
