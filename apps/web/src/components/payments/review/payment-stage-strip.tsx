"use client";

import { InsightCard } from "@/components/shared/insight-card";
import { StatusBadge } from "@/components/business/status-badge";
import { paymentTerm, type PaymentTerm } from "@/config/payments/payment-vocabulary";
import type { MessageKey } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import type { PaymentReviewStage, PaymentReviewSummary } from "@/services/payments-review-service";
import { formatCurrencyTotals } from "../payment-totals";

/** Stages that filter the Payments review list (kept in the URL: `?stage=`). */
export type ReviewListStage = "declared" | "awaitingConfirmation" | "awaitingSettlement";
/** Stages that live in a method's reconciliation workspace. */
type WorkspaceStage = "unmatchedLines" | "exceptions";
type StripStage = ReviewListStage | WorkspaceStage;

const STRIP: { stage: StripStage; term: PaymentTerm; workspaceTab?: string }[] = [
  { stage: "declared", term: "DECLARED" },
  { stage: "unmatchedLines", term: "STATEMENT_LINE", workspaceTab: "matching" },
  { stage: "exceptions", term: "EXCEPTION", workspaceTab: "exceptions" },
  { stage: "awaitingConfirmation", term: "MATCHED" },
  { stage: "awaitingSettlement", term: "AWAITING_SETTLEMENT" },
];

export function isReviewListStage(value: string | null): value is ReviewListStage {
  return value === "declared" || value === "awaitingConfirmation" || value === "awaitingSettlement";
}

/** Workspace link: the one method's tab, or the method list when several methods hold the stage. */
export function workspaceHref(stage: PaymentReviewStage, tab: string): string {
  return stage.methods.length === 1
    ? `/finance/payment-reconciliation/${stage.methods[0].id}?tab=${tab}`
    : "/finance/payment-reconciliation";
}

/**
 * The Payments review stage strip (Round 5 spec 3A): count and outstanding
 * amount per currency for each stage, a one-line description of what the
 * chip does, and a link that filters the list or opens the workspace tab.
 */
export function PaymentStageStrip({
  summary,
  active,
  listHref,
}: {
  summary: PaymentReviewSummary | null;
  active: ReviewListStage | null;
  /** Builds the list URL for a stage (null = clear the stage filter). */
  listHref: (stage: ReviewListStage | null) => string;
}) {
  const { t, direction } = useLocale();
  return (
    <div
      role="group"
      aria-label={t("paymentVocabulary.strip.label")}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5"
      data-testid="payment-stage-strip"
    >
      {STRIP.map(({ stage, term, workspaceTab }) => {
        const definition = paymentTerm(term);
        const data = summary ? summary[stage] : undefined;
        const title = t(`paymentVocabulary.strip.${stage}.title` as MessageKey);
        const description = t(`paymentVocabulary.strip.${stage}.description` as MessageKey);
        if (data === null) {
          // Statement stages without reconciliation access: shown, never hidden, never linked.
          return (
            <InsightCard
              key={stage}
              label={title}
              value="—"
              icon={definition.icon}
              tone="neutral"
              context={t("paymentVocabulary.strip.restricted")}
              direction={direction}
            />
          );
        }
        const isActive = active === stage;
        const href = workspaceTab
          ? data
            ? workspaceHref(data, workspaceTab)
            : undefined
          : listHref(isActive ? null : (stage as ReviewListStage));
        return (
          <InsightCard
            key={stage}
            label={title}
            value={data ? String(data.count) : "…"}
            icon={definition.icon}
            tone={data && data.count > 0 ? definition.tone : "neutral"}
            emphasis={isActive}
            href={href}
            actionLabel={
              workspaceTab
                ? t("paymentVocabulary.strip.openWorkspace")
                : isActive
                  ? t("paymentVocabulary.strip.showAll")
                  : undefined
            }
            meta={
              isActive ? (
                <StatusBadge label={t("paymentVocabulary.strip.filtered")} tone="info" />
              ) : undefined
            }
            context={description}
            direction={direction}
          >
            <p className="truncate text-caption font-medium tabular-nums" dir="ltr">
              {data && data.count > 0
                ? formatCurrencyTotals(data.totals)
                : t("paymentVocabulary.strip.nothing")}
            </p>
          </InsightCard>
        );
      })}
    </div>
  );
}
