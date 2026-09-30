"use client";

import type { ReactNode } from "react";
import { Sigma } from "lucide-react";
import { clsx as cx } from "clsx";
import { formatAmountParts } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { EnterpriseBadge } from "@/components/ui/badge";
import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { useDrCrLabels } from "./use-report-format";
import {
  resolveReconciliationState,
  resolveSummaryTone,
  type ResolvedSummaryTone,
} from "./summary-format";
import { STATE_ICON, TONE, VERDICT_KEY } from "./summary-meta";
import type {
  FinancialReportCheck,
  FinancialReportSummary as Summary,
  FinancialReportSummaryItem,
} from "./types";

/*
 * design-system §12.8 — the report
 * summary as compact tiles on the shared `InsightCard`: a concise label, the
 * figure with its currency, and context only where it is essential (the
 * reconciliation verdict). Period and basis are stated once in the report
 * header, not repeated per tile, so the table starts higher. Only the
 * drill-down of an imbalance is clickable. Figures use `formatAmountParts`
 * and the verdict `resolveReconciliationState`.
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

/** A grid cell that stretches its tile (equal heights across a row). */
const SLOT = "flex min-w-0 [&>*]:w-full";

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

const joinContext = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join(" · ") || undefined;

function ItemCard({ item, currency }: { item: FinancialReportSummaryItem; currency: string }) {
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
      title={item.hint}
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
        unit={parts.isZero ? undefined : (item.currency ?? currency)}
      />
    </div>
  );
}

function SideCard({
  side,
  currency,
}: {
  side: NonNullable<FinancialReportCheck["sides"]>[number];
  currency: string;
}) {
  const { direction } = useLocale();
  const parts = formatAmountParts(side.value, { zero: "dash" });
  return (
    <div
      data-slot="report-kpi"
      data-summary-id={`check:${side.id}`}
      title={side.hint}
      className={SLOT}
    >
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
        unit={parts.isZero ? undefined : currency}
      />
    </div>
  );
}

/**
 * The reconciliation tile — states what balances, never "the accounting is
 * correct"; the verdict is always icon + text, never colour alone.
 * - balanced: success icon, «متوازن», "Difference = 0";
 * - unbalanced: destructive accent, the discrepancy as the figure,
 *   «غير متوازن» + the verdict for the scope, and the drill-down;
 * - not applicable: a neutral note with the reason.
 */
export function ReconciliationCard({
  check,
  currency,
}: {
  check: FinancialReportCheck;
  currency: string;
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
        unit={currency}
        context={t(VERDICT_KEY[scope].unbalanced)}
        href={check.drillDown?.href}
        actionLabel={check.drillDown?.label}
      />
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
      />
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
      />
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
 * The report summary. Keeps every hook the acceptance scripts use
 * (`report-summary`, `report-kpi`, `report-reconciliation`,
 * `data-summary-id`, `data-state`, `data-balanced`). Round 4: the
 * reconciliation verdict is its own card (it can open a drill-down); the
 * report's figures are ONE hairline-split group beside it. One column on
 * phones (long figures never squeeze), an auto-fit row from `sm` up.
 */
export function FinancialReportSummary({
  summary,
  currency,
  className,
  id,
  hidden,
}: {
  summary: Summary;
  currency: string;
  /** Stated once in the report header (kept for the shared call signature). */
  period?: string;
  basis?: string;
  className?: string;
  /** Target of the report header's collapse toggle (`aria-controls`). */
  id?: string;
  hidden?: boolean;
}) {
  const { t } = useLocale();
  const check = summary.check;
  const sides = check?.sides ?? [];
  const hasFigures = summary.items.length + sides.length > 0;
  return (
    <section
      id={id}
      hidden={hidden}
      data-slot="report-summary"
      aria-label={t("reports.finance.summaryCards.region")}
      className={cx("flex min-w-0 flex-col gap-2 sm:flex-row print:hidden", className)}
    >
      {check ? (
        <div className="flex min-w-0 sm:w-[17rem] sm:shrink-0 [&>*]:w-full">
          <ReconciliationCard check={check} currency={currency} />
        </div>
      ) : null}
      {hasFigures ? (
        <InsightGroup className="flex-1 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
          {summary.items.map((item) => (
            <ItemCard key={item.id} item={item} currency={currency} />
          ))}
          {sides.map((side) => (
            <SideCard key={side.id} side={side} currency={currency} />
          ))}
        </InsightGroup>
      ) : null}
    </section>
  );
}
