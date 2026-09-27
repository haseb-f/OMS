"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { RowOutcome, StatementPreview } from "@/services/payment-reconciliation-service";

const OUTCOME_TONE: Record<RowOutcome, StatusTone> = {
  CREATE: "success",
  DUPLICATE: "neutral",
  UPDATE: "info",
  REAPPEARED: "info",
  EXCEPTION_CHANGED_AFTER_MATCH: "warning",
  ERROR: "destructive",
};

type PreviewRow = StatementPreview["rows"][number];

/** Mapping errors, per-outcome counts and the first rows — exactly what commit will do. */
export function StatementPreviewPanel({ preview }: { preview: StatementPreview }) {
  const { t } = useLocale();
  const summary = preview.summary;
  return (
    <div className="flex flex-col gap-2">
      {preview.mappingErrors.length > 0 ? (
        <Alert tone="destructive">
          <AlertTriangle />
          <AlertDescription>
            <ul className="list-disc ps-4">
              {preview.mappingErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {summary ? (
        <p className="text-caption text-muted-foreground">
          {t("paymentReconciliation.import.summaryLine", {
            total: String(summary.totalRows),
            created: String(summary.createdRows),
            duplicate: String(summary.duplicateRows),
            updated: String(summary.updatedRows),
            exception: String(summary.exceptionRows),
            error: String(summary.errorRows),
          })}
        </p>
      ) : null}
      {preview.rows.length > 0 ? (
        <div className="max-h-80 overflow-y-auto">
          <CompactDetailTable<PreviewRow>
            rows={preview.rows}
            rowKey={(row) => String(row.rowNumber)}
            columns={[
              { id: "row", header: "#", cell: (row) => <span dir="ltr">{row.rowNumber}</span> },
              {
                id: "outcome",
                header: t("paymentReconciliation.fields.status"),
                cell: (row) => (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <StatusBadge
                      label={t(`paymentReconciliation.import.outcome.${row.outcome}`)}
                      tone={OUTCOME_TONE[row.outcome]}
                    />
                    {row.errors.map((error) => (
                      <span key={error} className="text-caption text-destructive">
                        {error}
                      </span>
                    ))}
                  </div>
                ),
              },
              {
                id: "reference",
                header: t("paymentReconciliation.fields.providerReference"),
                cell: (row) => <span dir="ltr">{row.row?.providerReference ?? "—"}</span>,
              },
              {
                id: "date",
                header: t("paymentReconciliation.fields.transactionDate"),
                cell: (row) => (row.row ? formatDate(row.row.transactionDate) : "—"),
              },
              {
                id: "amount",
                header: t("paymentReconciliation.fields.amount"),
                align: "end",
                cell: (row) =>
                  row.row ? (
                    <span dir="ltr">{formatMoney(row.row.amount, row.row.currencyCode)}</span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
