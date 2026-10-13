"use client";

import { useCallback, type ComponentProps, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  InsightFrame,
  InsightFrameGroup,
  InsightFrameSkeleton,
} from "@/components/shared/insight-card";
import { ReportCard, ReportCardSkeleton } from "@/components/reports/report-card";
import {
  PERIOD_ICON,
  PERIOD_IDENTITY,
  type ReportIdentity,
} from "@/components/reports/report-identity";
import type { PeriodStats, SalesStats } from "@/services/sales-reports-service";
import { useLocale } from "@/providers/locale-provider";

/** The five Live periods, always in this order on every card. */
const PERIOD_ROWS = 5;

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
 * One subject (an employee, or the separate unassigned / agents rows) × the five Live periods
 * (R20 §B2): a compact outer card (`InsightFrame rows`) with its identity header and five
 * compact, full-width period rows (`ReportCard layout="row"`) — 1 Today, 2 Yesterday, 3 Last 7
 * days, 4 This month, 5 Last month — each in its period colour (`PERIOD_IDENTITY`: teal, sky,
 * blue, violet, orchid; the same on every card). A row is the Live card's content for that
 * subject: the period, valid orders, sales per currency (never added together; each code in its
 * currency colour), orders / cancelled / returned. Place cards in a `PeriodsCardGroup`: two per
 * row from a 44rem group, their rows aligned. The rows are opaque: a long list never stacks
 * blurred layers.
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
      rows={PERIOD_ROWS}
      surface="opaque"
      {...props}
    >
      {periods.map((entry) => (
        <ReportCard
          key={entry.period}
          layout="row"
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
    </InsightFrame>
  );
}

/** Employee cards compared side by side (the shared `InsightFrameGroup`). */
export function PeriodsCardGroup(props: ComponentProps<"div">) {
  return <InsightFrameGroup {...props} />;
}

/** Loading placeholder of a `PeriodsCard` — no figure is ever faked. */
export function PeriodsCardSkeleton() {
  return (
    <InsightFrameSkeleton rows={PERIOD_ROWS}>
      {Array.from({ length: PERIOD_ROWS }, (_, index) => (
        <ReportCardSkeleton key={index} />
      ))}
    </InsightFrameSkeleton>
  );
}
