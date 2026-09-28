"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { clsx as cx } from "clsx";
import { formatAmountParts } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { useUiPilot } from "@/providers/ui-pilot-provider";
import { useDrCrLabels } from "./use-report-format";
import { resolveReconciliationState, resolveSummaryTone } from "./summary-format";
import { STATE_ICON, TONE, VERDICT_KEY } from "./summary-meta";
import { FinancialReportSummaryPilot } from "./pilot/financial-report-summary-pilot";
import type {
  FinancialReportCheck,
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
} from "./types";

/*
 * Class lists are composed with `clsx`, not `cn`: tailwind-merge would drop
 * the custom type-scale utilities (`text-metric`, `text-caption`) next to a
 * text color.
 */

/**
 * Kumo-style card (design-system §11.3): rounded-md, solid card, 1px border,
 * no shadow. A container query lays label and figure on one line when the
 * card is wide enough, stacked otherwise — the figure never truncates.
 */
const CARD =
  "@container min-w-0 rounded-md border border-border bg-card px-3 py-2 text-card-foreground max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0";

function Figure({
  figure,
  suffix,
  className,
  size = "card",
}: {
  figure: string;
  suffix?: string;
  className?: string;
  size?: "body" | "card" | "metric";
}) {
  return (
    <span
      className={cx(
        "flex shrink-0 items-baseline gap-1 font-semibold",
        size === "metric" ? "text-metric" : size === "body" ? "text-body" : "text-card-title",
        className,
      )}
    >
      <span className="num">{figure}</span>
      {suffix ? (
        <span className="text-caption font-normal text-muted-foreground">{suffix}</span>
      ) : null}
    </span>
  );
}

function KpiCard({ item, currency }: { item: FinancialReportSummaryItem; currency: string }) {
  const drcrLabels = useDrCrLabels();
  const tone = resolveSummaryTone(item.tone, item.value);
  const Icon = TONE[tone].icon;
  const parts = formatAmountParts(item.value, {
    negative: item.negative ?? "minus",
    zero: "dash",
    drcrLabels,
  });
  // The report currency is stated once in the header context line; a card
  // names its currency only when it differs (mixed-currency reports).
  const ownCurrency = item.currency && item.currency !== currency ? item.currency : "";
  const suffix = parts.isZero ? "" : [parts.side, ownCurrency].filter(Boolean).join(" ");
  return (
    <div
      id={`report-summary-${item.id}`}
      data-slot="report-kpi"
      data-summary-id={item.id}
      data-tone={tone}
      className={CARD}
    >
      <div className="flex min-w-0 flex-col gap-0.5 @min-[15rem]:flex-row @min-[15rem]:items-center @min-[15rem]:gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          {Icon ? (
            <Icon className={cx("size-4 shrink-0", TONE[tone].className)} aria-hidden />
          ) : null}
          <span className="truncate" title={item.label}>
            {item.label}
          </span>
        </span>
        <Figure
          figure={parts.figure}
          suffix={suffix}
          className={cx(
            "max-md:text-body @min-[15rem]:ms-auto",
            parts.isZero ? "text-muted-foreground" : TONE[tone].className,
          )}
        />
      </div>
    </div>
  );
}

/**
 * The reconciliation card (design-system §11.5) — replaces the old floating
 * "Balanced" badge.
 * - balanced: subtle success icon, «القيود متوازنة لهذه الفترة», the equation
 *   and the compared totals. It states what balances, never that "the
 *   accounting is correct".
 * - unbalanced: a destructive banner with the discrepancy prominent and a
 *   drill-down to investigate.
 * - not applicable: a neutral note (e.g. specific accounts selected), the
 *   totals still shown, no verdict.
 */
export function ReconciliationCard({
  check,
  currency,
  className,
}: {
  check: FinancialReportCheck;
  currency: string;
  className?: string;
}) {
  const { t } = useLocale();
  const state = resolveReconciliationState(check);
  const Icon = STATE_ICON[state];
  const scope = check.scope ?? "period";
  const unbalanced = state === "unbalanced";
  const difference = formatAmountParts(Math.abs(check.difference), { zero: "dash" });
  const title =
    state === "not-applicable"
      ? t("reports.finance.reconciliation.notApplicable")
      : t(VERDICT_KEY[scope][state]);
  return (
    <div
      id="report-summary-check"
      data-slot="report-reconciliation"
      data-summary-id="check"
      data-state={state}
      data-balanced={state === "not-applicable" ? undefined : state === "balanced"}
      role={unbalanced ? "alert" : "status"}
      className={cx(
        "@container min-w-0 rounded-md border px-3 py-2",
        unbalanced
          ? "border-destructive-border bg-destructive-soft text-destructive-soft-foreground"
          : "border-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden
            className={cx(
              "size-4 shrink-0",
              state === "balanced" && "text-success",
              unbalanced && "text-destructive",
              state === "not-applicable" && "text-muted-foreground",
            )}
          />
          <span className={cx("text-body", unbalanced ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          <span
            className={cx(
              "text-caption",
              unbalanced ? "text-destructive-soft-foreground" : "text-muted-foreground",
            )}
          >
            {state === "not-applicable"
              ? check.notApplicable
              : unbalanced
                ? // The check's equation, negated: "Debits ≠ Credits" — never an
                  // "=" sub-label under an "entries do not balance" verdict.
                  check.label?.replace(" = ", " ≠ ")
                : check.label}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 @min-[36rem]:ms-auto">
          {unbalanced ? (
            <span className="flex items-baseline gap-1.5">
              <span className="text-caption">{t("reports.finance.reconciliation.difference")}</span>
              <Figure
                size="metric"
                figure={difference.figure}
                suffix={difference.isZero ? "" : currency}
                className="text-destructive-soft-foreground"
              />
            </span>
          ) : null}
          {(check.sides ?? []).map((side) => {
            const parts = formatAmountParts(side.value, { zero: "dash" });
            return (
              <span
                key={side.id}
                data-summary-id={`check:${side.id}`}
                className="flex items-baseline gap-1.5"
              >
                <span
                  className={cx(
                    "text-caption",
                    unbalanced ? "text-destructive-soft-foreground" : "text-muted-foreground",
                  )}
                >
                  {side.label}
                </span>
                <Figure
                  size="body"
                  figure={parts.figure}
                  className={unbalanced ? "text-destructive-soft-foreground" : "text-foreground"}
                />
              </span>
            );
          })}
          {unbalanced && check.drillDown ? (
            <Link
              href={check.drillDown.href}
              className="inline-flex items-center gap-1 rounded-xs text-caption font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
            >
              {check.drillDown.label}
              <ChevronRight aria-hidden className="size-3.5 rtl:rotate-180" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The report's summary strip — separate from the table, under the header:
 * compact KPI cards (category color on the icon + figure only) and the
 * reconciliation card where the report must balance.
 */
export function FinancialReportSummary({
  summary,
  currency,
  period,
  basis,
  className,
}: {
  summary: Summary;
  /** Report currency (stated once in the header; cards omit it). */
  currency: string;
  /** The period / as-of date the figures cover (pilot cards state it per card). */
  period?: string;
  /** What the figures include, e.g. "Posted entries only" (pilot cards). */
  basis?: string;
  className?: string;
}) {
  // Round 3 pilot (design-system §12.1): the pilot cards, same data and logic.
  const pilot = useUiPilot().active;
  if (pilot) {
    return (
      <FinancialReportSummaryPilot
        summary={summary}
        currency={currency}
        period={period}
        basis={basis}
        className={className}
      />
    );
  }
  const items = summary.items;
  const check = summary.check;
  return (
    <div
      data-slot="report-summary"
      className={cx(
        "flex flex-col gap-2 md:grid md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] print:hidden",
        className,
      )}
    >
      {items.length > 0 ? (
        // Phones: the figures share ONE card as a two-column key/value grid
        // (no stack of bordered tiles); md+: each figure is its own card.
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-card p-3 md:contents">
          {items.map((item) => (
            <KpiCard key={item.id} item={item} currency={currency} />
          ))}
        </div>
      ) : null}
      {check ? (
        <ReconciliationCard
          check={check}
          currency={currency}
          className={cx("md:col-span-2", items.length === 0 && "md:col-span-full")}
        />
      ) : null}
    </div>
  );
}
