"use client";

import { InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { useLocale } from "@/providers/locale-provider";
import {
  defaultDecision,
  isImportable,
  type SyncReviewDecision,
  type SyncReviewRow,
} from "./types";

export function SyncResultSummary({
  rows,
  decisions,
}: {
  rows: SyncReviewRow[];
  decisions: Record<string, SyncReviewDecision>;
}) {
  const { t } = useLocale();
  const accepted = rows.filter((row) => {
    const decision = decisions[row.id] ?? defaultDecision(row);
    return decision === "ACCEPT" && isImportable(row.status, row.lifecycle);
  });
  const ready = accepted.filter((row) => row.status === "READY").length;
  const warnings = accepted.filter((row) => row.status === "WARNING").length;
  const errors = rows.filter((row) => row.status === "ERROR").length;
  // Part 6 — PHONE_MATCH rows are importable, so lumping them into the
  // generic "duplicates" (excluded) bucket regardless of the staged
  // decision would misrepresent an accepted row as excluded, and a pending
  // one as already rejected. Break them out by their actual decision;
  // "duplicates" here is left for lifecycles that are ALWAYS excluded
  // (e.g. a true external-order-id duplicate), never PHONE_MATCH.
  const phoneMatchRows = rows.filter((row) => row.lifecycle === "PHONE_MATCH");
  const phoneMatchAccepted = phoneMatchRows.filter(
    (row) => (decisions[row.id] ?? defaultDecision(row)) === "ACCEPT",
  ).length;
  const phoneMatchPending = phoneMatchRows.filter(
    (row) => (decisions[row.id] ?? defaultDecision(row)) === "PENDING",
  ).length;
  const duplicates = rows.filter(
    (row) => row.status === "DUPLICATE" && row.lifecycle !== "PHONE_MATCH",
  ).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-foreground">
        {t("importCenter.sync.review.confirmIntro")}
      </p>
      <p className="text-ui-title font-semibold">
        {t("importCenter.sync.review.confirmOrders", { count: accepted.length })}
      </p>
      {/* R18 §C — the shared report cards (one recipe), never bespoke tinted boxes. */}
      <InsightGroup fit>
        <InsightCard
          tone="success"
          label={t("importCenter.sync.review.confirmReady")}
          value={ready}
          size="compact"
        />
        <InsightCard
          tone="warning"
          label={t("importCenter.sync.review.confirmWarnings")}
          value={warnings}
          size="compact"
        />
        <InsightCard
          tone="destructive"
          label={t("importCenter.sync.review.confirmErrorsExcluded")}
          value={errors}
          size="compact"
        />
        <InsightCard
          tone="info"
          label={t("importCenter.sync.review.confirmDuplicates")}
          value={duplicates}
          size="compact"
        />
        {phoneMatchAccepted > 0 ? (
          <InsightCard
            tone="success"
            label={t("importCenter.sync.review.confirmPhoneMatchAccepted")}
            value={phoneMatchAccepted}
            size="compact"
          />
        ) : null}
        {phoneMatchPending > 0 ? (
          <InsightCard
            tone="warning"
            label={t("importCenter.sync.review.confirmPhoneMatchPending")}
            value={phoneMatchPending}
            size="compact"
          />
        ) : null}
      </InsightGroup>
    </div>
  );
}
