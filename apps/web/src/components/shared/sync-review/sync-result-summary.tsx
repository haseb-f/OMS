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
    return decision === "ACCEPT" && isImportable(row.status);
  });
  const ready = accepted.filter((row) => row.status === "READY").length;
  const warnings = accepted.filter((row) => row.status === "WARNING").length;
  const errors = rows.filter((row) => row.status === "ERROR").length;
  const duplicates = rows.filter((row) => row.status === "DUPLICATE").length;

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
      </dl>
    </div>
  );
}
