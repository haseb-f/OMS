"use client";

import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { InsightIcon, InsightSurface, type InsightTone } from "@/components/shared/insight-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";

export type SummaryRow = { label: string; value: number | string | null; emphasis?: boolean };

/**
 * One summary card in the dashboard card language (design-system §12.8 /
 * §12.23): the shared `InsightSurface`, a concise title with its tone icon
 * chip, label / amount rows and the emphasized row (a total) last in the
 * tone's deep figure colour. Static by default; with `href` (R16 S2) the
 * whole card opens that page through the shared interactive surface (chevron,
 * hover / focus response). Amounts use the shared statement formatter (`0.00` for a genuine
 * zero, "—" when unavailable, red minus for a negative).
 */
export function SummaryCard({
  title,
  rows,
  currency,
  tone = "neutral",
  icon: Icon,
  columns = 1,
  href,
  direction = "rtl",
}: {
  title: string;
  rows: SummaryRow[];
  currency: string;
  tone?: InsightTone;
  icon?: LucideIcon;
  /** Two columns of rows for a long list (wide cards only). */
  columns?: 1 | 2;
  /** The page this summary drills into (e.g. the agent's own overview). */
  href?: string;
  direction?: "rtl" | "ltr";
}) {
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <InsightSurface tone={tone} href={href} className="gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <InsightIcon icon={Icon} /> : null}
        <h3
          data-slot="insight-label"
          className="min-w-0 flex-1 text-metric-label text-pretty break-words text-muted-foreground"
        >
          {title}
        </h3>
        {href ? <Chevron data-slot="insight-go" className="size-4 shrink-0" aria-hidden /> : null}
      </div>
      <dl className={columns === 2 ? "grid grid-cols-1 gap-x-8 sm:grid-cols-2" : "flex flex-col"}>
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
            <dd
              data-slot={row.emphasis ? "insight-value" : undefined}
              className={row.emphasis ? "font-semibold" : undefined}
            >
              {typeof row.value === "number" || row.value === null ? (
                <ReportMoney value={row.value} currency={currency} align="inline" />
              ) : (
                <span className="num">{row.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </InsightSurface>
  );
}
