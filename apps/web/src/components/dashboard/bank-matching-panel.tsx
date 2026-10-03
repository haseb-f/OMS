"use client";

import { ArrowDownToLine, ArrowUpFromLine, Landmark } from "lucide-react";
import { InsightBar, InsightCard, InsightGroup } from "@/components/shared/insight-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardPanel, PanelLink } from "@/components/dashboard/dashboard-panel";
import type { BankMatchingSummary } from "@/components/dashboard/dashboard-data";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/** A short label/value breakdown under a figure; non-zero problem rows get their tone. */
function Breakdown({
  rows,
}: {
  rows: { label: MessageKey; value: number; tone?: "warning" | "destructive" }[];
}) {
  const { t } = useLocale();
  return (
    <dl className="mt-2.5 flex flex-col gap-1 text-caption">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3">
          <dt className="min-w-0 break-words text-muted-foreground">{t(row.label)}</dt>
          <dd
            className={cn(
              "num font-medium",
              row.value > 0 && row.tone === "warning" && "text-warning-soft-foreground",
              row.value > 0 && row.tone === "destructive" && "text-destructive-soft-foreground",
              row.value === 0 && "text-muted-foreground",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Where bank matching stands: the matched share of incoming transactions and
 * the posted share of outgoing ones, each with its open breakdown. Counts,
 * not amounts — the Cash Flow screen holds the detail.
 */
export function BankMatchingPanel({
  summary,
  loading,
  failed,
  onRetry,
}: {
  summary: BankMatchingSummary | null;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useLocale();

  return (
    <DashboardPanel
      id="dash-bank"
      icon={Landmark}
      tone="info"
      scope={{ kind: "current", label: t("insights.scope.current") }}
      title={t("dashboard.overview.bankTitle")}
      description={t("dashboard.overview.bankDescription")}
      busy={loading}
      action={
        <PanelLink href="/finance/bank-transactions">{t("dashboard.overview.openBank")}</PanelLink>
      }
    >
      {failed ? (
        <ErrorState description={t("docUi.dashboard.loadFailed")} onRetry={onRetry} />
      ) : !summary ? (
        <div className="flex flex-col gap-2 px-4 py-3" aria-hidden>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : summary.empty ? (
        <EmptyState
          icon={Landmark}
          title={t("masterData.bankTransactions.empty")}
          className="py-6"
        />
      ) : (
        <InsightGroup className="rounded-none border-0 grid-cols-1 sm:grid-cols-2">
          <InsightCard
            icon={ArrowDownToLine}
            tone="success"
            label={t("masterData.bankTransactions.tabs.incoming")}
            value={`${summary.incoming.matchedShare}%`}
            unit={t("masterData.bankTransactions.summary.matched")}
            className="px-4 py-3"
          >
            <InsightBar
              value={summary.incoming.matchedShare}
              label={t("dashboard.overview.matchedOf", {
                matched: summary.incoming.matched,
                total: summary.incoming.total,
              })}
            />
            <p className="num mt-1.5 text-caption text-muted-foreground">
              {t("dashboard.overview.matchedOf", {
                matched: summary.incoming.matched,
                total: summary.incoming.total,
              })}
            </p>
            <Breakdown
              rows={[
                {
                  label: "masterData.bankTransactions.summary.partiallyMatched",
                  value: summary.incoming.partial,
                  tone: "warning",
                },
                {
                  label: "masterData.bankTransactions.summary.unmatched",
                  value: summary.incoming.unmatched,
                  tone: "warning",
                },
                {
                  label: "masterData.bankTransactions.summary.conflicts",
                  value: summary.incoming.conflicts,
                  tone: "destructive",
                },
              ]}
            />
          </InsightCard>
          <InsightCard
            icon={ArrowUpFromLine}
            tone="info"
            label={t("masterData.bankTransactions.tabs.outgoing")}
            value={`${summary.outgoing.postedShare}%`}
            unit={t("masterData.bankTransactions.summary.posted")}
            className="px-4 py-3"
          >
            <InsightBar
              value={summary.outgoing.postedShare}
              label={t("dashboard.overview.postedOf", {
                posted: summary.outgoing.posted,
                total: summary.outgoing.total,
              })}
            />
            <p className="num mt-1.5 text-caption text-muted-foreground">
              {t("dashboard.overview.postedOf", {
                posted: summary.outgoing.posted,
                total: summary.outgoing.total,
              })}
            </p>
            <Breakdown
              rows={[
                {
                  label: "masterData.bankTransactions.summary.pendingVoucher",
                  value: summary.outgoing.pendingVoucher,
                  tone: "warning",
                },
                {
                  label: "masterData.bankTransactions.summary.unclassified",
                  value: summary.outgoing.unclassified,
                  tone: "warning",
                },
                {
                  label: "masterData.bankTransactions.summary.conflicts",
                  value: summary.outgoing.conflicts,
                  tone: "destructive",
                },
              ]}
            />
          </InsightCard>
        </InsightGroup>
      )}
    </DashboardPanel>
  );
}
