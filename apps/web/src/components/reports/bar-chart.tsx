"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BarChartItem {
  id: string;
  label: string;
  value: number;
  /** Formatted value shown at the end of the bar (direct label). */
  valueLabel: string;
  /** Optional muted prefix (e.g. a rank). */
  prefix?: ReactNode;
}

/**
 * Ranked horizontal bar chart (R13 spec E) — the shared, dependency-free
 * chart for report comparisons. One series, one hue (`--chart-1`, which has
 * its own light / dark step), thin bars with a rounded data end anchored to
 * the start edge, and every bar directly labelled with its value, so identity
 * and magnitude are never colour-only. Built from logical CSS (inline-size,
 * `rounded-e`), so it mirrors in RTL with no extra code. The list keeps the
 * order it is given (callers pass ranked data) and is read by assistive
 * tech as "label: value" rows; the bars themselves are decorative.
 */
export function BarChart({
  title,
  items,
  emptyLabel,
  className,
}: {
  title: string;
  items: BarChartItem[];
  emptyLabel: string;
  className?: string;
}) {
  const titleId = useId();
  const max = items.reduce((top, item) => Math.max(top, item.value), 0);

  return (
    <figure aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-2", className)}>
      <figcaption id={titleId} className="text-caption font-medium text-muted-foreground">
        {title}
      </figcaption>
      {items.length === 0 ? (
        <p className="py-4 text-caption text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="grid min-w-0 grid-cols-[minmax(0,6rem)_minmax(2.5rem,1fr)_max-content] gap-x-3 sm:grid-cols-[minmax(0,14rem)_minmax(4rem,1fr)_max-content]">
          {items.map((item) => {
            const share = max > 0 ? Math.max(0, item.value) / max : 0;
            return (
              // One subgrid row per item: every bar shares the same track
              // width, so lengths compare across rows whatever the labels.
              <li
                key={item.id}
                data-slot="bar-row"
                className="col-span-3 grid grid-cols-subgrid items-center rounded-sm px-1 py-1 hover:bg-muted/60"
              >
                <span className="flex min-w-0 items-baseline gap-1.5 text-caption">
                  {item.prefix ? (
                    <span className="num shrink-0 text-muted-foreground">{item.prefix}</span>
                  ) : null}
                  <span className="truncate text-foreground" title={item.label}>
                    {item.label}
                  </span>
                  <span className="sr-only">: {item.valueLabel}</span>
                </span>
                <span className="relative h-3 min-w-0" aria-hidden>
                  <span
                    data-slot="bar"
                    className="absolute inset-y-0 start-0 rounded-e-sm bg-chart-1"
                    style={{ inlineSize: `${(share * 100).toFixed(2)}%` }}
                  />
                </span>
                <span className="num text-end text-caption font-medium text-foreground" aria-hidden>
                  {item.valueLabel}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </figure>
  );
}
