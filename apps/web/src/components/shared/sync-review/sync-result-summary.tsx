"use client";

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
      <dl className="grid grid-cols-2 gap-2 text-caption sm:grid-cols-4">
        <div className="rounded-lg border border-success/30 bg-success/5 p-3">
          <dt className="text-muted-foreground">{t("importCenter.sync.review.confirmReady")}</dt>
          <dd className="text-ui-title font-semibold tabular-nums text-success" dir="ltr">
            {ready}
          </dd>
        </div>
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
          <dt className="text-muted-foreground">{t("importCenter.sync.review.confirmWarnings")}</dt>
          <dd
            className="text-ui-title font-semibold tabular-nums text-warning-foreground"
            dir="ltr"
          >
            {warnings}
          </dd>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <dt className="text-muted-foreground">
            {t("importCenter.sync.review.confirmErrorsExcluded")}
          </dt>
          <dd className="text-ui-title font-semibold tabular-nums text-destructive" dir="ltr">
            {errors}
          </dd>
        </div>
        <div className="rounded-lg border border-info/30 bg-info/5 p-3">
          <dt className="text-muted-foreground">
            {t("importCenter.sync.review.confirmDuplicates")}
          </dt>
          <dd className="text-ui-title font-semibold tabular-nums text-info" dir="ltr">
            {duplicates}
          </dd>
        </div>
        {phoneMatchAccepted > 0 ? (
          <div className="rounded-lg border border-success/30 bg-success/5 p-3">
            <dt className="text-muted-foreground">
              {t("importCenter.sync.review.confirmPhoneMatchAccepted")}
            </dt>
            <dd className="text-ui-title font-semibold tabular-nums text-success" dir="ltr">
              {phoneMatchAccepted}
            </dd>
          </div>
        ) : null}
        {phoneMatchPending > 0 ? (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <dt className="text-muted-foreground">
              {t("importCenter.sync.review.confirmPhoneMatchPending")}
            </dt>
            <dd
              className="text-ui-title font-semibold tabular-nums text-warning-foreground"
              dir="ltr"
            >
              {phoneMatchPending}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
