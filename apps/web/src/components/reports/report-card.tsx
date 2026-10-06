"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  InsightSurface,
  resolveInsightTone,
  type InsightTone,
} from "@/components/shared/insight-card";
import { MoneyValue } from "@/components/shared/money-value";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format-number";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Currencies listed before the rest fold behind "Show N more". */
const VISIBLE_AMOUNTS = 4;

export interface ReportCardAmount {
  currencyCode: string;
  amount: number;
}

export interface ReportCardStat {
  label: string;
  value: number;
}

/**
 * Report summary card (R13 spec E) in the dashboard card language: the
 * shared `InsightSurface` (soft, tone-tinted glass surface from the theme
 * recipes), a Lucide icon chip, the title with an optional meta chip, ONE
 * prominent figure with its unit, then the money lines — one per currency,
 * each with its explicit code (currencies are never added together) — and a
 * quiet line of secondary counts. Zero is a real figure (neutral tone, "No
 * sales"), never a placeholder; loading uses `ReportCardSkeleton`.
 *
 * With `onSelect` the whole card is one button (`data-interactive`: the
 * shared hover / focus-visible response) and `selected` marks the chosen one
 * with the emphasis edge; without it the card stays flat and still.
 */
export function ReportCard({
  title,
  icon: Icon,
  tone = "neutral",
  figure,
  unit,
  meta,
  amounts,
  noAmountsLabel,
  stats,
  children,
  onSelect,
  selected = false,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: InsightTone;
  /** The prominent count. */
  figure: number;
  /** Muted unit after the figure ("valid orders"). */
  unit?: string;
  /** Small chip at the end of the title row (rank, date range). */
  meta?: ReactNode;
  /** Money per currency; an empty list shows `noAmountsLabel`. */
  amounts?: ReportCardAmount[];
  noAmountsLabel?: string;
  /** Secondary counts on one quiet line. */
  stats?: ReportCardStat[];
  children?: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [showAllAmounts, setShowAllAmounts] = useState(false);
  const resolvedTone = resolveInsightTone(tone, figure, figure);
  const hiddenAmounts =
    amounts && !showAllAmounts ? Math.max(0, amounts.length - VISIBLE_AMOUNTS) : 0;
  const visibleAmounts = amounts && hiddenAmounts > 0 ? amounts.slice(0, VISIBLE_AMOUNTS) : amounts;
  const body = (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {Icon ? (
          <span
            data-slot="insight-icon"
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            aria-hidden
          >
            <Icon className="size-4" strokeWidth={2} />
          </span>
        ) : null}
        <span
          data-slot="insight-label"
          className="min-w-0 flex-1 basis-24 text-metric-label text-pretty text-muted-foreground"
        >
          {title}
        </span>
        {meta ? <span className="max-w-full min-w-0">{meta}</span> : null}
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
        <span data-slot="insight-value" className="num text-metric-lg tracking-tight">
          {formatNumber(figure)}
        </span>
        {unit ? (
          <span className="min-w-0 truncate text-caption font-medium text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
      {amounts ? (
        <ul className="mt-1.5 flex min-w-0 flex-col gap-0.5" data-slot="report-amounts">
          {amounts.length === 0 ? (
            <li className="text-caption text-muted-foreground">{noAmountsLabel}</li>
          ) : (
            visibleAmounts?.map((line) => (
              <li key={line.currencyCode} className="flex min-w-0 justify-start text-body">
                <MoneyValue value={line.amount} currency={line.currencyCode} />
              </li>
            ))
          )}
          {hiddenAmounts > 0 ? (
            <li>
              {/* A span, not a button: the card itself may be a button. */}
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllAmounts(true);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setShowAllAmounts(true);
                }}
                className="cursor-pointer text-caption font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {t("table.showMore", { count: hiddenAmounts })}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {stats?.length ? (
        <dl className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1">
              <dt>{stat.label}</dt>
              <dd className="num font-medium text-foreground">{formatNumber(stat.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className="mt-2 min-w-0">{children}</div> : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        data-slot="insight-card"
        data-tone={resolvedTone}
        data-emphasis={selected || undefined}
        data-interactive=""
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "relative flex min-w-0 flex-col rounded-md border px-3 py-2.5 text-start outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <InsightSurface tone={resolvedTone} emphasis={selected} className={className}>
      {body}
    </InsightSurface>
  );
}

/** Loading placeholder with a `ReportCard`'s geometry — no figure is ever faked. */
export function ReportCardSkeleton({ className }: { className?: string }) {
  return (
    <InsightSurface aria-hidden className={cn("gap-2", className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-14" />
      <Skeleton className="h-4 w-28" />
    </InsightSurface>
  );
}
