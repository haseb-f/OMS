"use client";

import { formatDateTime } from "@/lib/date";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";
import type { SyncReviewDecision } from "./types";
import {
  defaultDecision,
  isImportable,
  type SyncReviewRow,
  type SyncReviewSourceMeta,
} from "./types";

export function SyncSourceContext({
  source,
  previewedAt,
  rowsReceived,
  rows,
  decisions,
}: {
  source: SyncReviewSourceMeta | undefined;
  previewedAt: string | undefined;
  rowsReceived: number;
  rows: SyncReviewRow[];
  decisions: Record<string, SyncReviewDecision>;
}) {
  const { t } = useLocale();
  const accepted = rows.filter((row) => {
    const decision = decisions[row.id] ?? defaultDecision(row);
    return decision === "ACCEPT" && isImportable(row.status, row.lifecycle);
  }).length;
  // Part 2/6 — a PENDING row (undecided PHONE_MATCH) is neither accepted nor
  // rejected; it must never inflate the "rejected" count, or the summary
  // would itself claim rows are rejected before the operator ever decided.
  const rejected = rows.filter(
    (row) => (decisions[row.id] ?? defaultDecision(row)) === "REJECT",
  ).length;
  const pending = rows.filter(
    (row) => (decisions[row.id] ?? defaultDecision(row)) === "PENDING",
  ).length;
  const duplicates = rows.filter((row) => row.status === "DUPLICATE").length;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-caption sm:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">{t("importCenter.sync.review.source")}</dt>
        <dd className="font-medium">{t("importCenter.sync.review.sourceGoogleSheets")}</dd>
      </div>
      {source?.worksheetName ? (
        <div>
          <dt className="text-muted-foreground">{t("importCenter.sync.review.sheet")}</dt>
          <dd className="font-medium">{source.worksheetName}</dd>
        </div>
      ) : null}
      {previewedAt ? (
        <div>
          <dt className="text-muted-foreground">{t("importCenter.sync.review.syncTime")}</dt>
          <dd className="font-medium">
            <SemanticValue kind="id">{formatDateTime(previewedAt)}</SemanticValue>
          </dd>
        </div>
      ) : null}
      <div>
        <dt className="text-muted-foreground">{t("importCenter.sync.review.rowsReceived")}</dt>
        <dd className="font-medium tabular-nums" dir="ltr">
          {rowsReceived}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("importCenter.sync.review.rowsAccepted")}</dt>
        <dd className="font-medium tabular-nums" dir="ltr">
          {accepted}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("importCenter.sync.review.rowsRejected")}</dt>
        <dd className="font-medium tabular-nums" dir="ltr">
          {rejected}
        </dd>
      </div>
      {pending > 0 ? (
        <div>
          <dt className="text-muted-foreground">{t("importCenter.sync.review.rowsPending")}</dt>
          <dd className="font-medium tabular-nums" dir="ltr">
            {pending}
          </dd>
        </div>
      ) : null}
      <div>
        <dt className="text-muted-foreground">{t("importCenter.sync.review.duplicates")}</dt>
        <dd className="font-medium tabular-nums" dir="ltr">
          {duplicates}
        </dd>
      </div>
    </dl>
  );
}
