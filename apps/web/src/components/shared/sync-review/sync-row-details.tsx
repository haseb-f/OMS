"use client";

import { SemanticValue } from "@/components/shared/semantic-value";
import {
  TableDetailField,
  TableDetailSection,
  TableDetailStack,
} from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { humanizeSyncIssue, syncFieldLabelKey } from "./messages";
import type { SyncReviewRow } from "./types";

function DetailValue({ value, kind }: { value: string | null | undefined; kind?: "phone" | "id" }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (kind) {
    return <SemanticValue kind={kind}>{value}</SemanticValue>;
  }
  return <span className="min-w-0 break-words">{value}</span>;
}

export function SyncRowDetails({ row }: { row: SyncReviewRow }) {
  const { t } = useLocale();
  const errorIssues = row.issues.filter((issue) => issue.code !== "NEEDS_REVIEW");
  const warningIssues = row.issues.filter((issue) => issue.code === "NEEDS_REVIEW");
  const phoneIssue = row.issues.find(
    (issue) => issue.originalValue != null || issue.normalizedValue != null,
  );

  return (
    <TableDetailStack>
      <TableDetailSection title={t("importCenter.sync.review.details")}>
        <TableDetailField
          primary={
            <>
              {t("importCenter.sync.review.sourceRow")}{" "}
              <SemanticValue kind="number">{row.rowNumber}</SemanticValue>
            </>
          }
          secondary={
            row.rowNumbers.length > 1 ? (
              <SemanticValue kind="id">{row.rowNumbers.join(", ")}</SemanticValue>
            ) : undefined
          }
        />
      </TableDetailSection>

      {(row.originalPhone || row.normalizedPhone) && (
        <TableDetailSection title={t("importCenter.sync.review.colPhone")}>
          <TableDetailField
            primary={
              <>
                {t("importCenter.sync.review.original")}:{" "}
                <DetailValue value={row.originalPhone} kind="phone" />
              </>
            }
            secondary={
              <>
                {t("importCenter.sync.review.normalized")}:{" "}
                <DetailValue value={row.normalizedPhone} kind="phone" />
              </>
            }
          />
          {row.countryName ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {t("importCenter.sync.review.country")}: {row.countryName}
            </p>
          ) : null}
          {row.status === "READY" && row.normalizedPhone ? (
            <p className="mt-1 text-caption text-success">
              {t("importCenter.sync.review.phoneReady")}
            </p>
          ) : null}
        </TableDetailSection>
      )}

      {errorIssues.length > 0 ? (
        <TableDetailSection title={t("importCenter.sync.review.validationErrors")}>
          <ul className="flex flex-col gap-2">
            {errorIssues.map((issue, index) => {
              const fieldKey = syncFieldLabelKey(issue.field);
              return (
                <li key={`${issue.code}-${index}`} className="min-w-0">
                  <TableDetailField
                    primary={humanizeSyncIssue(issue, t)}
                    secondary={issue.field ? (fieldKey ? t(fieldKey) : issue.field) : undefined}
                  />
                  {(issue.originalValue || issue.normalizedValue) && (
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {t("importCenter.sync.review.value")}:{" "}
                      <DetailValue
                        value={issue.originalValue ?? phoneIssue?.originalValue}
                        kind="phone"
                      />
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {row.status === "ERROR" ? (
            <p className="mt-2 text-caption text-muted-foreground">
              {t("importCenter.sync.review.reasons.correctThenRevalidate")}
            </p>
          ) : null}
        </TableDetailSection>
      ) : null}

      {warningIssues.length > 0 ? (
        <TableDetailSection title={t("importCenter.sync.review.warnings")}>
          <ul className="flex flex-col gap-1.5">
            {warningIssues.map((issue, index) => (
              <li key={`warn-${index}`}>{humanizeSyncIssue(issue, t)}</li>
            ))}
          </ul>
        </TableDetailSection>
      ) : null}

      {row.status === "DUPLICATE" ? (
        <TableDetailSection title={t("importCenter.sync.review.duplicateInfo")}>
          <TableDetailField
            primary={t("importCenter.sync.review.reasons.duplicateOrder")}
            secondary={
              row.existingRecordId ? (
                <>
                  {t("importCenter.sync.review.existingOrder")}:{" "}
                  <SemanticValue kind="id">{row.existingRecordId}</SemanticValue>
                </>
              ) : undefined
            }
          />
        </TableDetailSection>
      ) : null}
    </TableDetailStack>
  );
}
