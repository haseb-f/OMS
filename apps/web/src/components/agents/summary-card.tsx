"use client";

import { DetailSection } from "@/components/shared/detail-workspace";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";

export type SummaryRow = { label: string; value: number | string | null; emphasis?: boolean };

/**
 * One summary card: label / amount rows, the emphasized row last (a total).
 * Amounts use the shared statement formatter (`0.00` for a genuine zero,
 * "—" when unavailable, red minus for a negative).
 */
export function SummaryCard({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: SummaryRow[];
  currency: string;
}) {
  return (
    <DetailSection title={title} surface="soft">
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-b-0"
          >
            <dt
              className={
                row.emphasis ? "text-caption font-semibold" : "text-caption text-muted-foreground"
              }
            >
              {row.label}
            </dt>
            <dd className={row.emphasis ? "font-semibold" : undefined}>
              {typeof row.value === "number" || row.value === null ? (
                <ReportMoney value={row.value} currency={currency} align="inline" />
              ) : (
                <span className="num">{row.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </DetailSection>
  );
}
