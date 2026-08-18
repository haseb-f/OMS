"use client";

import { AlertTriangle } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { syncFieldLabelKey, syncIssueField } from "./messages";
import type { SyncReviewRow } from "./types";

export function SyncErrorDigest({
  rows,
  onShowErrors,
}: {
  rows: SyncReviewRow[];
  onShowErrors: () => void;
}) {
  const { t } = useLocale();
  const errorRows = rows.filter((row) => row.status === "ERROR");
  if (errorRows.length === 0) return null;

  const byField = new Map<string, number>();
  for (const row of errorRows) {
    const fields = new Set(
      row.issues
        .filter((issue) => issue.code !== "DUPLICATE" && issue.code !== "NEEDS_REVIEW")
        .map((issue) => syncIssueField(issue) ?? "__other"),
    );
    for (const field of fields) {
      byField.set(field, (byField.get(field) ?? 0) + 1);
    }
  }

  const breakdown = [...byField.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-caption">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="font-medium text-destructive">
            {t("importCenter.sync.review.digestTitle", { count: errorRows.length })}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {breakdown.map(([field, count]) => {
              const fieldKey = field === "__other" ? null : syncFieldLabelKey(field);
              const label = field === "__other" ? null : fieldKey ? t(fieldKey) : field;
              return (
                <li key={field}>
                  {label
                    ? t("importCenter.sync.review.digestField", { count, field: label })
                    : t("importCenter.sync.review.digestOther", { count })}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <EnterpriseButton type="button" variant="outline" size="sm" onClick={onShowErrors}>
        {t("importCenter.sync.review.digestShow")}
      </EnterpriseButton>
    </div>
  );
}
