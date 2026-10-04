"use client";

import { StatusBadge } from "@/components/business/status-badge";
import { RecordGridCard, type RowAction } from "@/components/shared/data-table";
import type { RecordGridCardField } from "@/components/shared/data-table/record-grid-card";
import { LocaleText } from "@/components/shared/locale-text";
import { SemanticValue } from "@/components/shared/semantic-value";
import { useLocale } from "@/providers/locale-provider";
import type { ImportJobRowRecord } from "@/services/import-jobs-service";

function rawText(row: ImportJobRowRecord, key: string): string | null {
  const value = row.rawRowData[key];
  return value === undefined || value === null || value === "" ? null : String(value);
}

/**
 * The Needs Review record card (Round 9). The row is an import-sheet row, not a
 * store order, so it gets its own small template: the sheet's customer is the
 * title, the external order id the reference, the sheet row number the key
 * figure. The matched customer and the review (or rejection) reason are the
 * fields; the Confirm / Reject actions are the table's own row actions.
 */
export function NeedsReviewGridCard({
  row,
  actions,
  selected,
  onToggleSelected,
}: {
  row: ImportJobRowRecord;
  /** The table's own row actions (empty in the Rejected view, as in the table). */
  actions?: RowAction[];
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const { t } = useLocale();
  const customerName = rawText(row, "customerName") ?? "—";
  const externalOrderId = rawText(row, "externalOrderId");
  const rejected = row.status === "REJECTED";
  const fields: RecordGridCardField[] = [
    {
      key: "matchedCustomer",
      label: t("storeOrders.needsReview.matchedCustomer"),
      value: row.matchedCustomerName ? (
        <span className="inline-flex max-w-full items-baseline gap-1.5">
          <LocaleText>{row.matchedCustomerName}</LocaleText>
          {row.matchedCustomerPhone ? (
            <SemanticValue kind="phone" className="text-muted-foreground">
              {row.matchedCustomerPhone}
            </SemanticValue>
          ) : null}
        </span>
      ) : (
        "—"
      ),
    },
  ];
  fields.push({
    key: "reason",
    label: t("storeOrders.needsReview.reason"),
    value: row.reviewReason ?? "—",
  });
  if (rejected && row.rejectionReasonCode) {
    fields.push({
      key: "rejectionReason",
      label: t("storeOrders.needsReview.rejectReason.label"),
      value: t(`storeOrders.needsReview.rejectReason.codes.${row.rejectionReasonCode}`),
    });
  }
  return (
    <RecordGridCard
      tone={rejected ? "destructive" : "warning"}
      selected={selected}
      onToggleSelected={onToggleSelected}
      selectLabel={t("tableViews.card.selectRow", { name: customerName })}
      title={<LocaleText>{customerName}</LocaleText>}
      reference={
        externalOrderId ? (
          <SemanticValue kind="id" className="font-medium">
            {externalOrderId}
          </SemanticValue>
        ) : (
          "—"
        )
      }
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          <span>{t("importCenter.wizard.preview.rowNumber")}</span>
          <span dir="ltr" className="num text-foreground">
            #{row.rowNumber}
          </span>
        </span>
      }
      fields={fields}
      badges={
        <StatusBadge
          tone={rejected ? "destructive" : "warning"}
          label={
            rejected
              ? t("storeOrders.needsReview.viewRejected")
              : t("storeOrders.needsReview.viewNeedsReview")
          }
        />
      }
      actions={actions}
      actionsLabel={t("tableViews.card.actions")}
    />
  );
}
