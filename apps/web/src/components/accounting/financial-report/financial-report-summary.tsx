"use client";

import { EnterpriseBadge } from "@/components/ui/badge";
import { formatAmountParts } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { clsx as cx } from "clsx";
import { cn } from "@/lib/utils";
import { useDrCrLabels } from "./use-report-format";
import { resolveSummaryTone, type ResolvedSummaryTone } from "./summary-format";
import type {
  FinancialReportCheck,
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
} from "./types";

const TONE_CLASS: Record<ResolvedSummaryTone, { tile: string; value: string }> = {
  revenue: { tile: "border-s-report-revenue bg-report-revenue-soft", value: "text-report-revenue" },
  expense: { tile: "border-s-report-expense bg-report-expense-soft", value: "text-report-expense" },
  profit: { tile: "border-s-report-profit bg-report-profit-soft", value: "text-report-profit" },
  loss: { tile: "border-s-report-loss bg-report-loss-soft", value: "text-report-loss" },
  neutral: { tile: "border-s-border-strong bg-card", value: "text-foreground" },
};

const TILE =
  "flex min-w-0 flex-col justify-center gap-0.5 rounded-sm border border-border border-s-2 px-2 py-1.5 sm:px-3 sm:py-2";

function TileFigure({
  figure,
  suffix,
  className,
}: {
  figure: string;
  suffix: string;
  className?: string;
}) {
  return (
    // clsx, not cn: tailwind-merge would drop `text-metric` next to a text color.
    // Phones: a smaller figure so two tiles fit side by side without clipping.
    <span
      className={cx(
        "flex min-w-0 items-baseline gap-1 text-metric max-sm:text-card-title",
        className,
      )}
    >
      <span className="num truncate">{figure}</span>
      {suffix ? (
        <span className="shrink-0 text-caption font-normal text-muted-foreground">{suffix}</span>
      ) : null}
    </span>
  );
}

function SummaryTile({ item, currency }: { item: FinancialReportSummaryItem; currency: string }) {
  const drcrLabels = useDrCrLabels();
  const tone = resolveSummaryTone(item.tone, item.value);
  const parts = formatAmountParts(item.value, {
    negative: item.negative ?? "minus",
    zero: "dash",
    drcrLabels,
  });
  const suffix = [parts.side, item.currency ?? currency].filter(Boolean).join(" ");
  return (
    <div
      id={`report-summary-${item.id}`}
      data-summary-id={item.id}
      data-tone={tone}
      className={cn(TILE, TONE_CLASS[tone].tile)}
    >
      <span className="truncate text-caption text-muted-foreground" title={item.label}>
        {item.label}
      </span>
      <TileFigure
        figure={parts.figure}
        suffix={parts.isZero ? "" : suffix}
        className={parts.isZero ? "text-muted-foreground" : TONE_CLASS[tone].value}
      />
    </div>
  );
}

/** The balance check as a deliberate tile: verdict badge + the exact discrepancy. */
function CheckTile({ check, currency }: { check: FinancialReportCheck; currency: string }) {
  const { t } = useLocale();
  const parts = formatAmountParts(Math.abs(check.difference), { zero: "dash" });
  const notApplicable = Boolean(check.notApplicable);
  return (
    <div
      id="report-summary-check"
      data-summary-id="check"
      role="status"
      data-balanced={notApplicable ? undefined : check.balanced}
      className={cn(
        TILE,
        notApplicable
          ? "border-s-border-strong bg-card"
          : check.balanced
            ? "border-s-success bg-card"
            : "border-destructive-border border-s-destructive bg-destructive-soft",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-caption text-muted-foreground" title={check.label}>
          {check.label}
        </span>
        <EnterpriseBadge
          variant={notApplicable ? "secondary" : check.balanced ? "success" : "destructive"}
        >
          {notApplicable
            ? t("reports.finance.checkNotApplicable")
            : check.balanced
              ? t("reports.finance.balanced")
              : t("reports.finance.unbalanced")}
        </EnterpriseBadge>
      </span>
      {notApplicable ? (
        <span className="truncate text-caption text-muted-foreground" title={check.notApplicable}>
          {check.notApplicable}
        </span>
      ) : (
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0 text-caption text-muted-foreground">
            {t("reports.finance.discrepancy")}
          </span>
          <TileFigure
            figure={parts.figure}
            suffix={parts.isZero ? "" : currency}
            className={
              check.balanced ? "text-muted-foreground" : "text-destructive-soft-foreground"
            }
          />
        </span>
      )}
    </div>
  );
}

/**
 * The report's final figures as one compact strip above the grid —
 * revenue / expenses / net result carry their category color here and
 * nowhere else. Reports that must balance show the check as a dedicated
 * tile with the exact discrepancy.
 */
export function FinancialReportSummary({
  summary,
  currency,
}: {
  summary: Summary;
  /** Report currency shown with every figure (ISO code). */
  currency: string;
}) {
  return (
    <div
      data-slot="report-summary"
      // Phones: a compact two-column grid, so the report rows start on the first screen.
      className="grid grid-cols-2 gap-1.5 border-b border-border px-3 py-2 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] sm:gap-2"
    >
      {summary.items.map((item) => (
        <SummaryTile key={item.id} item={item} currency={currency} />
      ))}
      {summary.check ? <CheckTile check={summary.check} currency={currency} /> : null}
    </div>
  );
}
