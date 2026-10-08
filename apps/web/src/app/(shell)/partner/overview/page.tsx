"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarRange,
  Handshake,
  HandCoins,
  History,
  Scale,
  Wallet,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import {
  InsightCard,
  InsightCardSkeleton,
  InsightGroup,
  InsightScope,
} from "@/components/shared/insight-card";
import { SummaryCard } from "@/components/agents/summary-card";
import { DashboardPanel, PanelLink, PanelSkeleton } from "@/components/dashboard/dashboard-panel";
import { useLoad } from "@/components/dashboard/dashboard-data";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { percentText } from "@/config/company-partners/format";
import {
  PartnershipEndedNotice,
  PeriodDetailDialog,
} from "@/config/company-partners/period-statement-view";
import {
  PeriodStatusBadge,
  statementPeriodName,
} from "@/config/company-partners/statement-columns";
import {
  partnerPortalService,
  type PortalMe,
  type PortalPeriodDetail,
  type PortalSummary,
} from "@/services/partner-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError } from "@/lib/toast";
import { formatDate, formatDateTime } from "@/lib/date";
import { ltrIsolate } from "@/lib/bidi";

const STATEMENT_ROUTE = "/partner/statement";
const RECENT_PERIODS = 5;

/**
 * Partner portal overview (R15 D15-14, spec-w4 §6): the partner's own figures
 * only — the latest period (estimate or approved, labelled), approved / paid /
 * still due to date, the last payment, the agreement terms and the recent
 * reviewed or closed periods (each opens its calculation). Tiles that open
 * the statement react on hover / focus; static summaries stay flat.
 */
function PartnerOverviewContent() {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const canViewStatement = hasPermission("partner.statement.view");
  const [me, setMe] = useState<PortalMe | null>(null);
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalPeriodDetail | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextMe, nextSummary] = await Promise.all([
        partnerPortalService.me(),
        partnerPortalService.summary(),
      ]);
      setMe(nextMe);
      setSummary(nextSummary);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "errors.loadFailed"));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const periodsLoader = useCallback(
    () =>
      canViewStatement
        ? partnerPortalService.periods().then((rows) => rows.slice(0, RECENT_PERIODS))
        : Promise.resolve(null),
    [canViewStatement],
  );
  const recent = useLoad(periodsLoader);

  const openPeriod = async (periodId: string) => {
    try {
      setDetail(await partnerPortalService.period(periodId));
    } catch (openError) {
      reportApiError(openError, "errors.loadFailed");
    }
  };

  const currency = summary?.currency?.code ?? "";
  const money = (value: number) => <ReportMoney value={value} currency={currency} align="inline" />;
  const statementHref = canViewStatement ? STATEMENT_ROUTE : undefined;
  const current = summary?.currentPeriod ?? null;
  const terms = me?.currentAgreement ?? null;
  const context = { t, locale };

  if (error) {
    return (
      <PageWorkspace title={t("partnerPortal.overview.title")}>
        <ErrorState description={error} onRetry={() => void load()} />
      </PageWorkspace>
    );
  }

  return (
    <PageWorkspace
      title={me?.partner.name ?? t("partnerPortal.overview.title")}
      description={t("partnerPortal.overview.description")}
    >
      {summary ? <PartnershipEndedNotice partnership={summary.partnership} /> : null}

      {summary ? (
        <InsightGroup fit>
          <InsightCard
            icon={CalendarRange}
            tone={current?.status === "CLOSED" ? "success" : "profit"}
            label={
              current
                ? `${t("partnerPortal.overview.currentPeriod")} · ${statementPeriodName(current, context)}`
                : t("partnerPortal.overview.currentPeriod")
            }
            value={current ? money(current.approvedDue ?? current.entitlement) : "—"}
            amount={current ? (current.approvedDue ?? current.entitlement) : null}
            meta={current ? <PeriodStatusBadge status={current.status} t={t} /> : undefined}
            href={statementHref}
            direction={locale === "ar" ? "rtl" : "ltr"}
          />
          <InsightCard
            icon={BadgeCheck}
            tone="success"
            label={t("partnerPortal.overview.approved")}
            value={money(summary.position.approved)}
            amount={summary.position.approved}
            meta={
              <InsightScope kind="toDate">
                {t("companyPartners.statement.approvedTag")}
              </InsightScope>
            }
            href={statementHref}
            direction={locale === "ar" ? "rtl" : "ltr"}
          />
          <InsightCard
            icon={HandCoins}
            tone="info"
            label={t("partnerPortal.overview.paid")}
            value={money(summary.position.paid)}
            amount={summary.position.paid}
            href={statementHref}
            direction={locale === "ar" ? "rtl" : "ltr"}
          />
          <InsightCard
            icon={Scale}
            tone="warning"
            emphasis={summary.position.payable > 0}
            label={t("partnerPortal.overview.payable")}
            value={money(summary.position.payable)}
            amount={summary.position.payable}
            meta={
              <InsightScope kind="current">{t("companyPartners.sections.position")}</InsightScope>
            }
          />
          <InsightCard
            icon={Wallet}
            tone="destructive"
            label={t("partnerPortal.overview.advance")}
            value={money(summary.position.advance)}
            amount={summary.position.advance}
          />
          <InsightCard
            icon={History}
            tone="info"
            label={t("partnerPortal.overview.lastPayment")}
            value={summary.lastPayment ? money(summary.lastPayment.amount) : "—"}
            amount={summary.lastPayment?.amount ?? null}
            context={
              summary.lastPayment
                ? `${ltrIsolate(formatDate(summary.lastPayment.date))} · ${t(`companyPartners.statement.method.${summary.lastPayment.method}`)}`
                : t("partnerPortal.overview.noPayment")
            }
          />
        </InsightGroup>
      ) : (
        <InsightGroup fit aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <InsightCardSkeleton key={index} />
          ))}
        </InsightGroup>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        {me ? (
          terms ? (
            <SummaryCard
              tone="info"
              icon={Handshake}
              title={t("partnerPortal.overview.agreement")}
              currency=""
              rows={[
                {
                  label: t("partnerPortal.overview.share"),
                  value: percentText(terms.profitSharePercent),
                  emphasis: true,
                },
                {
                  label: t("partnerPortal.overview.basis"),
                  value: t(`companyPartners.basis.${terms.basis}`),
                },
                {
                  label: t("partnerPortal.overview.frequency"),
                  value: t(`companyPartners.frequency.${terms.frequency}`),
                },
                {
                  label: t("partnerPortal.overview.from"),
                  value: me.partnership.startedOn ? formatDate(me.partnership.startedOn) : "—",
                },
                {
                  label: t("partnerPortal.overview.to"),
                  value: me.partnership.endsOn
                    ? formatDate(me.partnership.endsOn)
                    : t("companyPartners.partnership.openEnded"),
                },
                {
                  label: t("partnerPortal.overview.status"),
                  value: t(`companyPartners.partnership.${me.partnership.status}`),
                },
              ]}
            />
          ) : (
            <EmptyState icon={Handshake} title={t("partnerPortal.overview.noAgreement")} />
          )
        ) : (
          <PanelSkeleton rows={6} />
        )}

        {canViewStatement ? (
          <DashboardPanel
            id="partner-recent-periods"
            title={t("partnerPortal.overview.recentPeriods")}
            description={t("partnerPortal.overview.recentPeriodsHint")}
            icon={CalendarRange}
            tone="info"
            action={
              <PanelLink href={STATEMENT_ROUTE}>
                {t("partnerPortal.overview.openStatement")}
              </PanelLink>
            }
            busy={recent.state.status === "loading"}
          >
            {recent.state.status === "loading" ? (
              <PanelSkeleton rows={RECENT_PERIODS} />
            ) : recent.state.status === "error" ? (
              <ErrorState onRetry={() => void recent.retry()} />
            ) : !recent.state.data?.length ? (
              <p className="px-4 py-6 text-caption text-muted-foreground">
                {t("partnerPortal.overview.noPeriods")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {recent.state.data.map((row) => (
                  <li key={row.periodId ?? row.periodFrom}>
                    <button
                      type="button"
                      onClick={() => row.periodId && void openPeriod(row.periodId)}
                      className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-2.5 text-start outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {statementPeriodName(row, context)}
                        </span>
                        <PeriodStatusBadge status={row.status} t={t} />
                      </span>
                      <span className="shrink-0">
                        <ReportMoney
                          value={row.approvedDue ?? row.entitlement}
                          currency={currency}
                          align="inline"
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DashboardPanel>
        ) : null}
      </div>

      {me?.login ? (
        <p className="text-caption text-muted-foreground">
          {t("partnerPortal.overview.signedInAs")} <span dir="ltr">{me.login.email}</span>
          {me.login.lastLoginAt ? (
            <>
              {" · "}
              {t("companyPartners.login.lastLogin")}:{" "}
              <span className="num">{formatDateTime(me.login.lastLoginAt)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      <PeriodDetailDialog
        row={detail}
        adjustments={detail?.adjustmentHistory ?? []}
        currency={currency}
        onClose={() => setDetail(null)}
      />
    </PageWorkspace>
  );
}

export default function PartnerOverviewPage() {
  return (
    <PermissionGate permission="partner.dashboard.view">
      <PartnerOverviewContent />
    </PermissionGate>
  );
}
