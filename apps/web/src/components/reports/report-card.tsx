"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  INSIGHT_REPORT_TEXT,
  InsightCardSkeleton,
  InsightIcon,
  InsightSurface,
  resolveInsightTone,
  type InsightTone,
} from "@/components/shared/insight-card";
import { MoneyValue } from "@/components/shared/money-value";
import { formatNumber } from "@/lib/format-number";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { ReportIdentity } from "@/components/reports/report-identity";

/** Currencies listed before the rest fold behind "Show N more". */
const VISIBLE_AMOUNTS = 4;

export interface ReportCardAmount {
  currencyCode: string;
  amount: number;
}

/**
 * R19 §C2 — what a supporting figure MEANS, for its text colour (never colour alone: the label
 * stays). `success` = completed / collected, `attention` = pending / outstanding / to process,
 * `danger` = failed / lost / negative. Without it (or at zero) the figure is neutral.
 */
export type ReportMeaning = "success" | "attention" | "danger";

export interface ReportCardStat {
  label: string;
  value: number;
  meaning?: ReportMeaning;
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
 *
 * R19 §C — it is the sales-report card, so it always draws at the report size
 * (`InsightSurface size="report"`, `INSIGHT_REPORT_TEXT`): roomier padding, a 16px
 * title, a 32px figure, 16px money lines that never clip, 14px secondary counts and
 * the stronger report tint / edge / depth / hover of the theme recipe. The figures
 * themselves pass through unchanged (`formatNumber`, `MoneyValue`).
 *
 * R19 §C2 — `identity` gives the card its colour identity (report-identity.ts: the metric /
 * period decides it, never the value), and its icon a short hover / focus motion. Text colour
 * follows meaning: the main figure in the identity accent, money lines in the strong neutral
 * with a quieter currency code, a stat in its `meaning` colour only when it is non-zero, the
 * title / period / explanations in readable neutrals.
 */
export function ReportCard({
  title,
  icon: Icon,
  tone = "neutral",
  identity,
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
  /** R19 §C2 — the card's colour identity + icon motion (replaces `tone`). */
  identity?: ReportIdentity;
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {Icon ? <InsightIcon icon={Icon} size="report" motion={identity?.motion} /> : null}
        <span
          data-slot="insight-label"
          className={cn(
            "min-w-0 flex-1 basis-28 text-pretty break-words text-muted-foreground",
            INSIGHT_REPORT_TEXT.title,
          )}
        >
          {title}
        </span>
        {meta ? <span className="max-w-full min-w-0">{meta}</span> : null}
      </div>
      <div
        className={cn(
          INSIGHT_REPORT_TEXT.gap,
          "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5",
        )}
      >
        <span
          data-slot="insight-value"
          className={cn("num tracking-tight", INSIGHT_REPORT_TEXT.figure)}
        >
          {formatNumber(figure)}
        </span>
        {unit ? (
          <span
            className={cn("min-w-0 break-words text-muted-foreground", INSIGHT_REPORT_TEXT.unit)}
          >
            {unit}
          </span>
        ) : null}
      </div>
      {amounts ? (
        <ul
          className={cn(INSIGHT_REPORT_TEXT.gap, "flex min-w-0 flex-col gap-1")}
          data-slot="report-amounts"
        >
          {amounts.length === 0 ? (
            <li className={cn("text-muted-foreground", INSIGHT_REPORT_TEXT.secondary)}>
              {noAmountsLabel}
            </li>
          ) : (
            visibleAmounts?.map((line) => (
              // One money line per currency at the card-title size; the amount is never clipped.
              <li
                key={line.currencyCode}
                className="flex min-w-0 flex-wrap justify-start text-card-title"
              >
                <MoneyValue
                  value={line.amount}
                  currency={line.currencyCode}
                  className="font-semibold"
                  currencyClassName={REPORT_CURRENCY_CLASS}
                />
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
                className="cursor-pointer text-body font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                {t("table.showMore", { count: hiddenAmounts })}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {stats?.length ? (
        <dl
          className={cn(
            INSIGHT_REPORT_TEXT.gap,
            "flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-muted-foreground",
            INSIGHT_REPORT_TEXT.secondary,
          )}
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1">
              <dt>{stat.label}</dt>
              <dd
                className="num font-medium text-foreground"
                data-meaning={stat.meaning && stat.value !== 0 ? stat.meaning : undefined}
              >
                {formatNumber(stat.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className="mt-3 min-w-0">{children}</div> : null}
    </>
  );

  return (
    <InsightSurface
      tone={resolvedTone}
      identity={identity?.hue}
      size="report"
      emphasis={selected}
      onSelect={onSelect}
      pressed={onSelect ? selected : undefined}
      className={className}
    >
      {body}
    </InsightSurface>
  );
}

/** R19 §C2 — the currency code beside a report amount: smaller and quieter than the figure. */
export const REPORT_CURRENCY_CLASS = "text-caption font-medium text-muted-foreground";

/** Loading placeholder with a `ReportCard`'s geometry — no figure is ever faked. */
export function ReportCardSkeleton({ className }: { className?: string }) {
  return <InsightCardSkeleton context size="report" className={className} />;
}
