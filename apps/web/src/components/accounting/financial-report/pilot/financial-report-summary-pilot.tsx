"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { clsx as cx } from "clsx";
import { formatAmountParts } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { useDrCrLabels } from "../use-report-format";
import {
  resolveReconciliationState,
  resolveSummaryTone,
  type ResolvedSummaryTone,
} from "../summary-format";
import { STATE_ICON, TONE } from "../summary-meta";
import type {
  FinancialReportCheck,
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
} from "../types";

/*
 * Round 3 pilot (design-system §12.6 "Financial reports") — the summary strip
 * as ONE metric card split by hairlines: the reconciliation status first, then
 * the report's figures, then the compared totals and their difference. Same
 * data, same verdict logic (`resolveReconciliationState`) and the same
 * formatter as the classic strip; only the presentation differs.
 *
 * `clsx`, not `cn`: tailwind-merge would drop the type-scale utilities next
 * to a text color.
 */

/**
 * Cells draw their own end and bottom hairlines; the strip clips the last
 * column's and the last row's (negative margin + overflow-hidden), so the
 * dividers stay correct however the grid wraps.
 */
const CELL =
  "flex min-w-0 flex-col justify-center gap-0.5 border-e border-b border-border px-3 py-2 md:px-4 md:py-2.5";

function Metric({
  id,
  summaryId,
  slot,
  label,
  icon,
  figure,
  suffix,
  figureClassName,
  className,
  children,
  tone,
}: {
  id?: string;
  summaryId: string;
  slot?: string;
  label: string;
  icon?: ReactNode;
  figure: string;
  suffix?: string;
  figureClassName?: string;
  className?: string;
  children?: ReactNode;
  tone?: string;
}) {
  return (
    <div
      id={id}
      data-slot={slot}
      data-summary-id={summaryId}
      data-tone={tone}
      className={cx(CELL, className)}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
        {icon}
        <span className="truncate" title={label}>
          {label}
        </span>
      </span>
      <span
        className={cx(
          "flex min-w-0 flex-wrap items-baseline gap-x-1 text-metric font-semibold max-md:text-card-title",
          figureClassName,
        )}
      >
        <span className="num">{figure}</span>
        {suffix ? (
          <span className="text-caption font-normal text-muted-foreground">{suffix}</span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * Figure colors that pass AA as text in light and dark: the category color
 * stays on the icon (graphic, 3:1); only a result carries its verdict color
 * on the figure (profit green, loss red — §7 "red only for a net loss").
 */
const FIGURE_TONE: Record<ResolvedSummaryTone, string> = {
  revenue: "text-foreground",
  expense: "text-foreground",
  profit: "text-success-soft-foreground",
  loss: "text-destructive-soft-foreground",
  neutral: "text-foreground",
};

function ItemMetric({
  item,
  currency,
  className,
}: {
  item: FinancialReportSummaryItem;
  currency: string;
  className?: string;
}) {
  const drcrLabels = useDrCrLabels();
  const tone = resolveSummaryTone(item.tone, item.value);
  const Icon = TONE[tone].icon;
  const parts = formatAmountParts(item.value, {
    negative: item.negative ?? "minus",
    zero: "dash",
    drcrLabels,
  });
  const ownCurrency = item.currency && item.currency !== currency ? item.currency : "";
  return (
    <Metric
      id={`report-summary-${item.id}`}
      slot="report-kpi"
      summaryId={item.id}
      tone={tone}
      label={item.label}
      icon={
        Icon ? <Icon aria-hidden className={cx("size-3.5 shrink-0", TONE[tone].className)} /> : null
      }
      figure={parts.figure}
      suffix={parts.isZero ? "" : [parts.side, ownCurrency].filter(Boolean).join(" ")}
      figureClassName={parts.isZero ? "text-muted-foreground" : FIGURE_TONE[tone]}
      className={className}
    />
  );
}

/** The reconciliation status cell — what balances, never "the accounting is correct". */
function StatusCell({ check }: { check: FinancialReportCheck }) {
  const { t } = useLocale();
  const state = resolveReconciliationState(check);
  const Icon = STATE_ICON[state];
  const unbalanced = state === "unbalanced";
  const verdict =
    state === "not-applicable"
      ? t("reports.finance.reconciliation.notApplicable")
      : unbalanced
        ? t("reports.finance.unbalanced")
        : t("reports.finance.balanced");
  const detail =
    state === "not-applicable"
      ? check.notApplicable
      : unbalanced
        ? // The equation, negated: "Debits ≠ Credits" under an unbalanced verdict.
          check.label?.replace(" = ", " ≠ ")
        : check.label;
  return (
    <div
      id="report-summary-check"
      data-slot="report-reconciliation"
      data-summary-id="check"
      data-state={state}
      data-balanced={state === "not-applicable" ? undefined : state === "balanced"}
      role={unbalanced ? "alert" : "status"}
      className={cx(
        CELL,
        // Phones: verdict and equation on one line across the strip.
        "max-md:col-span-2 max-md:flex-row max-md:flex-wrap max-md:items-baseline max-md:gap-x-3",
        unbalanced && "bg-destructive-soft",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden
          className={cx(
            "size-4 shrink-0",
            state === "balanced" && "text-success",
            unbalanced && "text-destructive",
            state === "not-applicable" && "text-muted-foreground",
          )}
        />
        <span
          className={cx(
            "text-card-title font-semibold",
            unbalanced ? "text-destructive-soft-foreground" : "text-foreground",
          )}
        >
          {verdict}
        </span>
      </span>
      {detail ? (
        <span
          className={cx(
            "text-caption md:ps-6",
            unbalanced ? "text-destructive-soft-foreground" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The pilot summary strip. Keeps every hook the acceptance scripts and the
 * classic strip expose (`report-summary`, `report-kpi`, `report-reconciliation`,
 * `data-summary-id`, `data-state`, `data-balanced`).
 */
export function FinancialReportSummaryPilot({
  summary,
  currency,
  className,
}: {
  summary: Summary;
  currency: string;
  className?: string;
}) {
  const { t } = useLocale();
  const check = summary.check;
  const state = check ? resolveReconciliationState(check) : null;
  const unbalanced = state === "unbalanced";
  const difference = check ? formatAmountParts(Math.abs(check.difference), { zero: "dash" }) : null;
  const sides = check?.sides ?? [];
  const showDifference = Boolean(check && difference && state !== "not-applicable");
  // Phones lay the figures two per row under the status; an odd one out
  // spans the row instead of leaving an empty half cell.
  const figureCount = summary.items.length + sides.length + (showDifference ? 1 : 0);
  const lastSpan = (index: number) =>
    figureCount % 2 === 1 && index === figureCount - 1
      ? // …as one label · figure line.
        "max-md:col-span-2 max-md:flex-row max-md:flex-wrap max-md:items-baseline max-md:justify-between max-md:gap-x-3"
      : undefined;
  return (
    <div
      data-slot="report-summary"
      className={cx(
        "overflow-hidden rounded-md border bg-card text-card-foreground shadow-(--shadow-card) print:hidden",
        unbalanced ? "border-destructive-border" : "border-border",
        className,
      )}
    >
      <div className="-me-px -mb-px grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {check ? <StatusCell check={check} /> : null}
        {summary.items.map((item, index) => (
          <ItemMetric key={item.id} item={item} currency={currency} className={lastSpan(index)} />
        ))}
        {check
          ? sides.map((side, index) => {
              const parts = formatAmountParts(side.value, { zero: "dash" });
              return (
                <Metric
                  key={side.id}
                  summaryId={`check:${side.id}`}
                  label={side.label}
                  figure={parts.figure}
                  figureClassName={parts.isZero ? "text-muted-foreground" : "text-foreground"}
                  className={lastSpan(summary.items.length + index)}
                />
              );
            })
          : null}
        {check && difference && showDifference ? (
          <Metric
            summaryId="check:difference"
            label={t("reports.finance.reconciliation.difference")}
            figure={difference.figure}
            suffix={unbalanced && !difference.isZero ? currency : ""}
            figureClassName={
              unbalanced
                ? "text-destructive-soft-foreground"
                : difference.isZero
                  ? "text-muted-foreground"
                  : "text-foreground"
            }
            className={cx(unbalanced && "bg-destructive-soft", lastSpan(figureCount - 1))}
          >
            {unbalanced && check.drillDown ? (
              <Link
                href={check.drillDown.href}
                className="inline-flex w-fit items-center gap-1 rounded-xs text-caption font-medium text-destructive-soft-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
              >
                {check.drillDown.label}
                <ChevronRight aria-hidden className="size-3.5 rtl:rotate-180" />
              </Link>
            ) : null}
          </Metric>
        ) : null}
      </div>
    </div>
  );
}
