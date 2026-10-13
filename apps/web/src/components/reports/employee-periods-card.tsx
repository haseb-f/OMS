"use client";

import { useCallback, type ComponentProps, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { InsightFrame, InsightFrameSkeleton, InsightGroup } from "@/components/shared/insight-card";
import { ReportCard, ReportCardSkeleton } from "@/components/reports/report-card";
import {
  PERIOD_ICON,
  PERIOD_IDENTITY,
  type ReportIdentity,
} from "@/components/reports/report-identity";
import type { PeriodStats, SalesStats } from "@/services/sales-reports-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * R20 §B — the five period boxes inside an employee card. Columns follow the width the card
 * gets (container queries on `InsightFrame`), never the viewport: one per row on a phone, two
 * on a narrow tablet (the lone fifth box spans its row), 3 + 2 on a tablet / laptop and five
 * in one row only from 66rem (a 1440 desktop) — wide enough that a 1,234,567,890.00 amount
 * still fits a box; anything longer wraps, never truncates.
 */
export const PERIOD_BOX_GRID =
  "grid-cols-1 @md:grid-cols-2 @md:[&>:last-child]:col-span-2 @3xl:grid-cols-3 @3xl:[&>:last-child]:col-span-1 @min-[66rem]:grid-cols-5";

/** The quiet counts under a sales-report figure: orders, cancelled (danger), returned (attention). */
export function useReportStatLines() {
  const { t } = useLocale();
  return useCallback(
    (stats: SalesStats) => [
      { label: t("salesReports.stats.orders"), value: stats.orders },
      // R19 §C2 — colour by meaning (non-zero only; the label always says it): a cancelled
      // order is a lost sale (danger); a return is a reversal still to process (attention).
      {
        label: t("salesReports.stats.cancelled"),
        value: stats.cancelled,
        meaning: "danger" as const,
      },
      {
        label: t("salesReports.stats.returned"),
        value: stats.returned,
        meaning: "attention" as const,
      },
    ],
    [t],
  );
}

/**
 * One subject (an employee, or the separate unassigned / agents rows) × the five Live periods:
 * the shared outer card (`InsightFrame`) with its identity header, and one report card per
 * period in the period's colour identity (`PERIOD_IDENTITY`: teal, sky, blue, violet, orchid —
 * the same on every employee, tab and role). Each box is the Live card's content for that
 * subject: valid orders, sales value per currency (never added together), orders / cancelled /
 * returned. The boxes are opaque (`surface="opaque"`): a long list never stacks blurred layers.
 */
export function PeriodsCard({
  title,
  titleId,
  subtitle,
  icon,
  identity,
  meta,
  periods,
  ...props
}: Omit<ComponentProps<"article">, "title"> & {
  title: ReactNode;
  titleId: string;
  subtitle?: ReactNode;
  icon: LucideIcon;
  identity: ReportIdentity;
  meta?: ReactNode;
  periods: PeriodStats[];
}) {
  const { t } = useLocale();
  const statLines = useReportStatLines();
  return (
    <InsightFrame
      title={title}
      titleId={titleId}
      subtitle={subtitle}
      icon={icon}
      identity={identity.hue}
      iconMotion={identity.motion}
      meta={meta}
      {...props}
    >
      <InsightGroup size="report" surface="opaque" className={PERIOD_BOX_GRID}>
        {periods.map((entry) => (
          <ReportCard
            key={entry.period}
            title={t(`salesReports.periods.${entry.period}`)}
            icon={PERIOD_ICON[entry.period]}
            identity={PERIOD_IDENTITY[entry.period]}
            figure={entry.valid}
            unit={t("salesReports.stats.valid")}
            amounts={entry.amounts}
            noAmountsLabel={t("salesReports.stats.noSales")}
            stats={statLines(entry)}
          />
        ))}
      </InsightGroup>
    </InsightFrame>
  );
}

/** Loading placeholder of a `PeriodsCard` — no figure is ever faked. */
export function PeriodsCardSkeleton() {
  return (
    <InsightFrameSkeleton>
      <InsightGroup size="report" surface="opaque" className={PERIOD_BOX_GRID}>
        {Array.from({ length: 5 }, (_, index) => (
          <ReportCardSkeleton key={index} />
        ))}
      </InsightGroup>
    </InsightFrameSkeleton>
  );
}
