"use client";

import { DetailSection } from "@/components/shared/detail-workspace";
import { MoneyValue } from "@/components/shared/money-value";

export type SummaryRow = { label: string; value: number | string; emphasis?: boolean };

/** One summary card: label / amount rows, the emphasized row last (a total). */
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
              {typeof row.value === "number" ? (
                <MoneyValue value={row.value} currency={currency} />
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
