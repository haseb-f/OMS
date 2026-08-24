"use client";

import { SemanticValue } from "@/components/shared/semantic-value";
import {
  TableDetailField,
  TableDetailSection,
  TableDetailStack,
} from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { humanizeSyncIssue, syncFieldLabelKey, syncIssueField } from "./messages";
import type { SyncReviewIssue, SyncReviewRow } from "./types";

function DetailValue({ value, kind }: { value: string | null | undefined; kind?: "phone" | "id" }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (kind) {
    return <SemanticValue kind={kind}>{value}</SemanticValue>;
  }
  return <span className="min-w-0 break-words">{value}</span>;
}

function groupIssuesByField(issues: SyncReviewIssue[]): Map<string, SyncReviewIssue[]> {
  const groups = new Map<string, SyncReviewIssue[]>();
  for (const issue of issues) {
    const field = syncIssueField(issue) ?? "_";
    const list = groups.get(field) ?? [];
    list.push(issue);
    groups.set(field, list);
  }
  return groups;
}

function isPhoneShownInPhoneSection(row: SyncReviewRow, value: string | null | undefined): boolean {
  if (!value) return false;
  return value === row.originalPhone || value === row.normalizedPhone;
}

export function SyncRowDetails({ row }: { row: SyncReviewRow }) {
  const { t } = useLocale();
  const errorIssues = row.issues.filter((issue) => issue.code !== "NEEDS_REVIEW");
  const warningIssues = row.issues.filter((issue) => issue.code === "NEEDS_REVIEW");
  const groupedErrors = groupIssuesByField(errorIssues);
  const phoneAlreadyVisible = Boolean(row.originalPhone || row.normalizedPhone);

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
            {[...groupedErrors.entries()].map(([field, issues]) => {
              const fieldKey = syncFieldLabelKey(field === "_" ? null : field);
              const fieldLabel = fieldKey ? t(fieldKey) : field === "_" ? null : field;
              const sample = issues.find((issue) => issue.originalValue || issue.normalizedValue);
              const sampleValue = sample?.originalValue ?? sample?.normalizedValue ?? null;
              const showValue =
                sampleValue &&
                !(phoneAlreadyVisible && isPhoneShownInPhoneSection(row, sampleValue));

              return (
                <li key={field} className="min-w-0">
                  {fieldLabel ? (
                    <p className="text-caption font-medium text-foreground">{fieldLabel}</p>
                  ) : null}
                  {showValue ? (
                    <p className="text-caption text-muted-foreground">
                      <DetailValue value={sampleValue} kind="phone" />
                    </p>
                  ) : null}
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {issues.map((issue, index) => (
                      <li
                        key={`${issue.code}-${index}`}
                        className="text-caption text-muted-foreground"
                      >
                        {humanizeSyncIssue(issue, t)}
                      </li>
                    ))}
                  </ul>
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

      {row.lifecycle === "PHONE_MATCH" && row.phoneMatch ? (
        <TableDetailSection title={t("importCenter.sync.review.phoneMatchInfo")}>
          <p className="text-caption font-medium text-foreground">
            {row.phoneMatch.scope === "BATCH"
              ? t("importCenter.sync.review.phoneMatchScopeBatch")
              : row.phoneMatch.scope === "EXISTING"
                ? t("importCenter.sync.review.phoneMatchScopeExisting")
                : t("importCenter.sync.review.phoneMatchScopeBoth")}
          </p>
          {row.phoneMatch.priorOrder ? (
            <TableDetailField
              primary={
                <>
                  {t("importCenter.sync.review.existingOrder")}:{" "}
                  <SemanticValue kind="id">
                    {row.phoneMatch.priorOrder.internalOrderId}
                  </SemanticValue>
                  {row.phoneMatch.priorOrder.externalOrderId
                    ? ` / ${row.phoneMatch.priorOrder.externalOrderId}`
                    : ""}
                </>
              }
              secondary={
                row.phoneMatch.priorOrder.orderDate
                  ? `${t("importCenter.sync.review.orderDate")}: ${row.phoneMatch.priorOrder.orderDate}`
                  : undefined
              }
            />
          ) : null}
          {row.phoneMatch.batchMatches?.length ? (
            <div className="mt-1">
              <p className="text-caption text-muted-foreground">
                {t("importCenter.sync.review.phoneMatchGroupRows", {
                  count: row.phoneMatch.batchMatches.length,
                })}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {row.phoneMatch.batchMatches.map((member, index) => (
                  <li key={index} className="text-caption text-muted-foreground">
                    {t("importCenter.sync.review.sourceRow")}{" "}
                    <SemanticValue kind="number">{member.rowNumbers.join("/")}</SemanticValue>
                    {member.externalOrderId ? ` — ${member.externalOrderId}` : ""}
                    {member.customerName ? ` — ${member.customerName}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-2 text-caption text-muted-foreground">
            {t("importCenter.sync.review.phoneMatchRecommendation")}
          </p>
        </TableDetailSection>
      ) : row.status === "DUPLICATE" ? (
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
