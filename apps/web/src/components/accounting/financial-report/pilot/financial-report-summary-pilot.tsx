"use client";

import type { ReactNode } from "react";
import { Sigma } from "lucide-react";
import { clsx as cx } from "clsx";
import { formatAmountParts } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { EnterpriseBadge } from "@/components/ui/badge";
import { InsightCard } from "@/components/shared/insight-card";
import { useDrCrLabels } from "../use-report-format";
import {
  resolveReconciliationState,
  resolveSummaryTone,
  type ResolvedSummaryTone,
} from "../summary-format";
import { STATE_ICON, TONE, VERDICT_KEY } from "../summary-meta";
import type {
  FinancialReportCheck,
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
} from "../types";

/*
 * Round 3.1 pilot (spec "Round 3.1" item 4, design-system §12) — the report
 * summary as informative cards built on the shared `InsightCard`: a label that
 * says exactly what the number is, the figure, its currency and period
 * directly under it, one context line, and an action only where one exists
 * (the drill-down of an imbalance). Same data, same formatter
 * (`formatAmountParts`) and the same verdict logic
 * (`resolveReconciliationState`) as the classic strip.
 *
 * `clsx`, not `cn`: tailwind-merge would drop the type-scale utilities next
 * to a text color.
 */

/**
 * Figure colors that pass AA as text in light and dark: the category color
 * stays on the icon tile; only a result carries its verdict color on the
 * figure (profit green, loss red — §7 "red only for a net loss").
 */
const FIGURE_TONE: Record<ResolvedSummaryTone, string> = {
  revenue: "text-foreground",
  expense: "text-foreground",
  profit: "text-success-soft-foreground",
  loss: "text-destructive-soft-foreground",
  neutral: "text-foreground",
};

/**
 * Phones: one stacked column (the verdict first, then the figures), compact
 * padding, no sideways scrolling; md+: an auto-fit grid.
 */
const SLOT = "flex min-w-0 [&>*]:w-full max-md:[&>*]:p-3";

function Figure({
  figure,
  side,
  className,
  summaryId,
}: {
  figure: string;
  side?: string;
  className?: string;
  summaryId?: string;
}) {
  return (
    <span data-summary-id={summaryId} className="flex flex-wrap items-baseline gap-x-1.5">
      <span className={className}>{figure}</span>
      {side ? <span className="text-caption font-normal text-muted-foreground">{side}</span> : null}
    </span>
  );
}

/** The line directly under a value: its currency (when it has one) and period. */
function Scope({ currency, period }: { currency?: string; period?: string }) {
  if (!currency && !period) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
      {currency ? <span className="font-medium text-foreground">{currency}</span> : null}
      {currency && period ? <span aria-hidden>·</span> : null}
      {period ? <span>{period}</span> : null}
    </p>
  );
}

const joinContext = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(" · ") || undefined;

function ItemCard({
  item,
  currency,
  period,
  basis,
}: {
  item: FinancialReportSummaryItem;
  currency: string;
  period?: string;
  basis?: string;
}) {
  const { direction } = useLocale();
  const drcrLabels = useDrCrLabels();
  const tone = resolveSummaryTone(item.tone, item.value);
  const parts = formatAmountParts(item.value, {
    negative: item.negative ?? "minus",
    zero: "dash",
    drcrLabels,
  });
  return (
    <div
      id={`report-summary-${item.id}`}
      data-slot="report-kpi"
      data-summary-id={item.id}
      data-tone={tone}
      className={SLOT}
    >
      <InsightCard
        direction={direction}
        tone={tone}
        icon={TONE[tone].icon ?? undefined}
        label={item.cardLabel ?? item.label}
        value={
          <Figure
            figure={parts.figure}
            side={parts.isZero ? "" : parts.side}
            className={parts.isZero ? "text-muted-foreground" : FIGURE_TONE[tone]}
          />
        }
        context={joinContext(item.hint, basis)}
      >
        <Scope currency={item.currency ?? currency} period={period} />
      </InsightCard>
    </div>
  );
}

function SideCard({
  side,
  currency,
  period,
  basis,
}: {
  side: NonNullable<FinancialReportCheck["sides"]>[number];
  currency: string;
  period?: string;
  basis?: string;
}) {
  const { direction } = useLocale();
  const parts = formatAmountParts(side.value, { zero: "dash" });
  return (
    <div data-slot="report-kpi" data-summary-id={`check:${side.id}`} className={SLOT}>
      <InsightCard
        direction={direction}
        icon={Sigma}
        label={side.cardLabel ?? side.label}
        value={
          <Figure
            figure={parts.figure}
            className={parts.isZero ? "text-muted-foreground" : "text-foreground"}
          />
        }
        context={joinContext(side.hint, basis)}
      >
        <Scope currency={currency} period={period} />
      </InsightCard>
    </div>
  );
}

/**
 * The reconciliation card — states what balances, never "the accounting is
 * correct"; the verdict is always icon + text, never colour alone.
 * - balanced: success icon, «متوازن», the equation, "Difference = 0";
 * - unbalanced: destructive icon, the discrepancy as the figure (tinted card),
 *   «غير متوازن» + the verdict for the scope, and the drill-down;
 * - not applicable: a neutral note with the reason.
 */
function ReconciliationCard({
  check,
  currency,
  period,
}: {
  check: FinancialReportCheck;
  currency: string;
  period?: string;
}) {
  const { t, direction } = useLocale();
  const state = resolveReconciliationState(check);
  const scope = check.scope ?? "period";
  const unbalanced = state === "unbalanced";
  let card: ReactNode;
  if (state === "unbalanced") {
    const difference = formatAmountParts(Math.abs(check.difference), { zero: "dash" });
    card = (
      <InsightCard
        direction={direction}
        tone="destructive"
        emphasis
        icon={STATE_ICON.unbalanced}
        // The check's equation, negated: "Debits ≠ Credits".
        label={joinContext(
          t("reports.finance.summaryCards.discrepancy"),
          check.label?.replace(" = ", " ≠ "),
        )!}
        meta={
          <EnterpriseBadge variant="destructive">{t("reports.finance.unbalanced")}</EnterpriseBadge>
        }
        value={<Figure summaryId="check:difference" figure={difference.figure} />}
        context={t(VERDICT_KEY[scope].unbalanced)}
        href={check.drillDown?.href}
        actionLabel={check.drillDown?.label}
      >
        <Scope currency={currency} period={period} />
      </InsightCard>
    );
  } else if (state === "balanced") {
    card = (
      <InsightCard
        direction={direction}
        tone="success"
        icon={STATE_ICON.balanced}
        label={check.label}
        value={t("reports.finance.balanced")}
        context={joinContext(
          t(VERDICT_KEY[scope].balanced),
          t("reports.finance.summaryCards.differenceZero"),
        )}
      >
        <Scope period={period} />
      </InsightCard>
    );
  } else {
    card = (
      <InsightCard
        direction={direction}
        icon={STATE_ICON["not-applicable"]}
        label={check.label}
        value={
          <span className="text-muted-foreground">{t("reports.finance.checkNotApplicable")}</span>
        }
        context={check.notApplicable}
      >
        <Scope period={period} />
      </InsightCard>
    );
  }
  return (
    <div
      id="report-summary-check"
      data-slot="report-reconciliation"
      data-summary-id="check"
      data-state={state}
      data-balanced={state === "not-applicable" ? undefined : state === "balanced"}
      role={unbalanced ? "alert" : "status"}
      className={SLOT}
    >
      {card}
    </div>
  );
}

/**
 * The pilot summary cards. Keeps every hook the acceptance scripts and the
 * classic strip expose (`report-summary`, `report-kpi`, `report-reconciliation`,
 * `data-summary-id`, `data-state`, `data-balanced`).
 */
export function FinancialReportSummaryPilot({
  summary,
  currency,
  period,
  basis,
  className,
}: {
  summary: Summary;
  currency: string;
  period?: string;
  basis?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const check = summary.check;
  return (
    <section
      data-slot="report-summary"
      aria-label={t("reports.finance.summaryCards.region")}
      className={cx(
        "grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] md:gap-3 print:hidden",
        className,
      )}
    >
      {check ? <ReconciliationCard check={check} currency={currency} period={period} /> : null}
      {summary.items.map((item) => (
        <ItemCard key={item.id} item={item} currency={currency} period={period} basis={basis} />
      ))}
      {check
        ? (check.sides ?? []).map((side) => (
            <SideCard key={side.id} side={side} currency={currency} period={period} basis={basis} />
          ))
        : null}
    </section>
  );
}
