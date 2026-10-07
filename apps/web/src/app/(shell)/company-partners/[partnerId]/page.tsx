"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BarChart3,
  CalendarX,
  Calculator,
  HandCoins,
  Handshake,
  Info,
  Percent,
  Plus,
  Scale,
  Undo2,
  Wallet,
} from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import {
  EnterpriseDateRangePicker,
  type DateRangeValue,
} from "@/components/shared/date-range-picker";
import { InsightCard, InsightGroup, InsightScope } from "@/components/shared/insight-card";
import { SummaryCard } from "@/components/agents/summary-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { RowActionsMenu } from "@/components/shared/data-table";
import { EntityTabs } from "@/components/business/entity-tabs";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseBadge } from "@/components/ui/badge";
import { AGREEMENT_TONE, incomeStatementHref, percentText } from "@/config/company-partners/format";
import {
  companyPartnersService,
  type PartnerAgreementRow,
  type PartnerPaymentRow,
  type PartnerSegment,
  type PartnerStatement,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, toISODate } from "@/lib/date";
import { apiErrorMessage } from "@/lib/toast";
import {
  AgreementDialog,
  type AgreementDialogMode,
  PaymentDialog,
  ReversePaymentDialog,
} from "../_components/partner-dialogs";

type ApprovedPeriod = PartnerStatement["approved"]["periods"][number];

const yearToDate = (): DateRangeValue => {
  const today = new Date();
  return { from: new Date(today.getFullYear(), 0, 1), to: today };
};

function PartnerStatementContent() {
  const { t } = useLocale();
  const { partnerId } = useParams<{ partnerId: string }>();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("company-partners.manage");
  const canPay = hasPermission("company-partners.pay");
  const [range, setRange] = useState<DateRangeValue>(yearToDate);
  const [statement, setStatement] = useState<PartnerStatement | null>(null);
  const [agreements, setAgreements] = useState<PartnerAgreementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreementDialog, setAgreementDialog] = useState<AgreementDialogMode | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [reversing, setReversing] = useState<PartnerPaymentRow | null>(null);

  const query = useMemo(
    () => ({
      from: range.from ? toISODate(range.from) : undefined,
      to: range.to ? toISODate(range.to) : undefined,
    }),
    [range],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextStatement, nextAgreements] = await Promise.all([
        companyPartnersService.statement(partnerId, query),
        companyPartnersService.agreements(partnerId),
      ]);
      setStatement(nextStatement);
      setAgreements(nextAgreements);
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [partnerId, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const currency = statement?.currency?.code ?? null;
  const current = statement?.currentAgreements[0] ?? null;
  const money = (value: number) => <ReportMoney value={value} currency={currency} align="inline" />;

  const segmentColumns = useMemo<ColumnDef<PartnerSegment, unknown>[]>(
    () => [
      {
        id: "from",
        accessorFn: (row) => row.from,
        meta: { titleKey: "companyPartners.fields.from", type: "date", importance: "critical" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.from)}</span>,
      },
      {
        id: "to",
        accessorFn: (row) => row.to,
        meta: { titleKey: "companyPartners.fields.to", type: "date", importance: "critical" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.to)}</span>,
      },
      {
        id: "days",
        accessorFn: (row) => row.days,
        meta: { titleKey: "companyPartners.fields.days", type: "number", importance: "low" },
      },
      {
        id: "basis",
        accessorFn: (row) => row.basis,
        meta: {
          titleKey: "companyPartners.fields.basis",
          type: "default",
          displayValue: (row, tr) => tr(`companyPartners.basis.${row.basis}`),
        },
        cell: ({ row }) => t(`companyPartners.basis.${row.original.basis}`),
      },
      {
        id: "base",
        accessorFn: (row) => row.baseAmount,
        meta: { titleKey: "companyPartners.fields.base", type: "money", importance: "high" },
        cell: ({ row }) => (
          <ReportMoney value={row.original.baseAmount} adverse={row.original.baseAmount < 0} />
        ),
      },
      {
        id: "percent",
        accessorFn: (row) => row.percent,
        meta: {
          titleKey: "companyPartners.fields.percent",
          type: "percent",
          displayValue: (row) => percentText(row.percent),
        },
        cell: ({ row }) => <span className="num">{percentText(row.original.percent)}</span>,
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        meta: { titleKey: "companyPartners.fields.amount", type: "money", importance: "critical" },
        cell: ({ row }) =>
          row.original.lossClamped ? (
            <span className="text-caption text-muted-foreground">
              {t("companyPartners.fields.lossNote")}
            </span>
          ) : (
            <ReportMoney value={row.original.amount} />
          ),
      },
    ],
    [t],
  );

  const periodColumns = useMemo<ColumnDef<ApprovedPeriod, unknown>[]>(
    () => [
      {
        id: "period",
        accessorFn: (row) => row.periodFrom,
        meta: {
          titleKey: "companyPartners.fields.period",
          type: "date",
          importance: "critical",
          displayValue: (row) => `${row.periodFrom} → ${row.periodTo}`,
        },
        cell: ({ row }) => (
          <span className="num">
            {formatDate(row.original.periodFrom)} – {formatDate(row.original.periodTo)}
          </span>
        ),
      },
      {
        id: "original",
        accessorFn: (row) => row.original,
        meta: { titleKey: "companyPartners.fields.original", type: "money" },
        cell: ({ row }) => <ReportMoney value={row.original.original} />,
      },
      {
        id: "adjustments",
        accessorFn: (row) => row.adjustments,
        meta: { titleKey: "companyPartners.fields.adjustments", type: "money" },
        cell: ({ row }) => <ReportMoney value={row.original.adjustments} />,
      },
      {
        id: "total",
        accessorFn: (row) => row.total,
        meta: { titleKey: "companyPartners.fields.total", type: "money", importance: "critical" },
        cell: ({ row }) => <ReportMoney value={row.original.total} />,
      },
      {
        id: "journal",
        meta: { titleKey: "companyPartners.fields.journalEntry", type: "reference" },
        cell: ({ row }) => (
          <JournalTraceCell
            sourceType="PARTNER_PROFIT_DISTRIBUTION"
            sourceId={row.original.periodId}
            expected={row.original.original !== 0}
          />
        ),
      },
      {
        id: "incomeStatement",
        meta: { titleKey: "companyPartners.links.incomeStatement", type: "default" },
        cell: ({ row }) => (
          <Link
            href={incomeStatementHref(row.original.periodFrom, row.original.periodTo)}
            className="text-primary hover:underline focus-visible:underline"
          >
            {t("companyPartners.links.incomeStatement")}
          </Link>
        ),
      },
    ],
    [t],
  );

  const agreementColumns = useMemo<ColumnDef<PartnerAgreementRow, unknown>[]>(
    () => [
      {
        id: "share",
        accessorFn: (row) => row.profitSharePercent,
        meta: {
          titleKey: "companyPartners.fields.profitShare",
          type: "percent",
          importance: "critical",
          displayValue: (row) => percentText(row.profitSharePercent),
        },
        cell: ({ row }) => (
          <span className="num font-medium">{percentText(row.original.profitSharePercent)}</span>
        ),
      },
      {
        id: "basis",
        accessorFn: (row) => row.basis,
        meta: {
          titleKey: "companyPartners.fields.basis",
          type: "default",
          displayValue: (row, tr) => tr(`companyPartners.basis.${row.basis}`),
        },
        cell: ({ row }) => t(`companyPartners.basis.${row.original.basis}`),
      },
      {
        id: "frequency",
        accessorFn: (row) => row.frequency,
        meta: {
          titleKey: "companyPartners.fields.frequency",
          type: "default",
          importance: "low",
          displayValue: (row, tr) => tr(`companyPartners.frequency.${row.frequency}`),
        },
        cell: ({ row }) => t(`companyPartners.frequency.${row.original.frequency}`),
      },
      {
        id: "effectiveFrom",
        accessorFn: (row) => row.effectiveFrom,
        meta: { titleKey: "companyPartners.fields.effectiveFrom", type: "date" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.effectiveFrom)}</span>,
      },
      {
        id: "effectiveTo",
        accessorFn: (row) => row.effectiveTo ?? "",
        meta: { titleKey: "companyPartners.fields.effectiveTo", type: "date" },
        cell: ({ row }) =>
          row.original.effectiveTo ? (
            <span className="num">{formatDate(row.original.effectiveTo)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        meta: {
          titleKey: "companyPartners.fields.status",
          type: "status",
          displayValue: (row, tr) => tr(`companyPartners.agreementStatus.${row.status}`),
        },
        cell: ({ row }) => (
          <StatusBadge
            label={t(`companyPartners.agreementStatus.${row.original.status}`)}
            tone={AGREEMENT_TONE[row.original.status]}
          />
        ),
      },
      {
        id: "actions",
        meta: { titleKey: "common.actions", type: "actions" },
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "change",
                label: t("companyPartners.actions.changeShare"),
                icon: Percent,
                hidden: !canManage || row.original.status !== "ACTIVE",
                onSelect: () => setAgreementDialog({ kind: "change", agreement: row.original }),
              },
              {
                key: "end",
                label: t("companyPartners.actions.endAgreement"),
                icon: CalendarX,
                hidden: !canManage || row.original.status !== "ACTIVE",
                onSelect: () => setAgreementDialog({ kind: "end", agreement: row.original }),
              },
            ]}
          />
        ),
      },
    ],
    [t, canManage],
  );

  const paymentColumns = useMemo<ColumnDef<PartnerPaymentRow, unknown>[]>(
    () => [
      {
        id: "paymentNumber",
        accessorFn: (row) => row.paymentNumber,
        meta: {
          titleKey: "companyPartners.fields.paymentNumber",
          type: "reference",
          importance: "critical",
        },
      },
      {
        id: "date",
        accessorFn: (row) => row.date,
        meta: { titleKey: "companyPartners.fields.date", type: "date", importance: "high" },
        cell: ({ row }) => <span className="num">{formatDate(row.original.date)}</span>,
      },
      {
        id: "amount",
        accessorFn: (row) => row.amount,
        meta: { titleKey: "companyPartners.fields.amount", type: "money", importance: "critical" },
        cell: ({ row }) => (
          <ReportMoney value={row.original.amount} quiet={Boolean(row.original.reversedAt)} />
        ),
      },
      {
        id: "account",
        accessorFn: (row) => `${row.financialAccount.code} ${row.financialAccount.name}`,
        meta: {
          titleKey: "companyPartners.fields.financialAccount",
          type: "default",
          importance: "low",
        },
      },
      {
        id: "reference",
        accessorFn: (row) => row.reference ?? "",
        meta: {
          titleKey: "companyPartners.fields.reference",
          type: "reference",
          importance: "low",
        },
      },
      {
        id: "status",
        accessorFn: (row) => (row.reversedAt ? "REVERSED" : "POSTED"),
        meta: { titleKey: "companyPartners.fields.status", type: "status" },
        cell: ({ row }) =>
          row.original.reversedAt ? (
            <StatusBadge label={t("companyPartners.actions.reverse")} tone="neutral" icon={Undo2} />
          ) : (
            <StatusBadge label={t("companyPartners.fields.paid")} tone="success" />
          ),
      },
      {
        id: "journal",
        meta: { titleKey: "companyPartners.fields.journalEntry", type: "reference" },
        cell: ({ row }) => (
          <JournalTraceCell
            sourceType="PARTNER_PROFIT_PAYMENT"
            sourceId={row.original.id}
            expected
          />
        ),
      },
      {
        id: "actions",
        meta: { titleKey: "common.actions", type: "actions" },
        cell: ({ row }) => (
          <RowActionsMenu
            label={t("common.actions")}
            actions={[
              {
                key: "reverse",
                label: t("companyPartners.actions.reverse"),
                icon: Undo2,
                destructive: true,
                hidden: !canPay || Boolean(row.original.reversedAt),
                onSelect: () => setReversing(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [t, canPay],
  );

  const estimate = statement?.estimate;
  const balance = statement?.balance;
  const paymentTarget = useMemo(
    () =>
      payOpen && statement
        ? {
            partnerId,
            name: statement.partner.name,
            payable: statement.balance.payable,
          }
        : null,
    [payOpen, statement, partnerId],
  );

  return (
    <PageWorkspace
      title={statement?.partner.name ?? t("companyPartners.title")}
      description={statement?.partner.partnerNumber}
      actions={
        <HeaderActions
          primary={{
            key: "pay",
            label: t("companyPartners.actions.recordPayment"),
            icon: Wallet,
            hidden: !canPay,
            disabled: !statement,
            onSelect: () => setPayOpen(true),
          }}
          secondary={[
            current
              ? {
                  key: "change",
                  label: t("companyPartners.actions.changeShare"),
                  icon: Percent,
                  hidden: !canManage,
                  onSelect: () => setAgreementDialog({ kind: "change", agreement: current }),
                }
              : {
                  key: "new",
                  label: t("companyPartners.actions.newAgreement"),
                  icon: Plus,
                  hidden: !canManage,
                  onSelect: () =>
                    setAgreementDialog({
                      kind: "new",
                      partnerId,
                      frequency: agreements[0]?.frequency ?? "MONTHLY",
                    }),
                },
            {
              key: "incomeStatement",
              label: t("companyPartners.links.incomeStatement"),
              icon: BarChart3,
              href: statement
                ? incomeStatementHref(statement.range.from, statement.range.to)
                : undefined,
              disabled: !statement,
            },
          ]}
          inline={<EnterpriseDateRangePicker value={range} onChange={setRange} />}
        />
      }
    >
      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}

      <p className="flex items-start gap-2 rounded-md border border-info-soft bg-info-soft px-3 py-2 text-caption text-info-soft-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("companyPartners.estimateNote")}
      </p>

      {statement && estimate && balance ? (
        <>
          <InsightGroup fit>
            <InsightCard
              icon={Percent}
              tone="info"
              label={t("companyPartners.summary.currentShare")}
              value={current ? percentText(current.profitSharePercent) : "—"}
              context={
                current
                  ? t(`companyPartners.basis.${current.basis}`)
                  : t("companyPartners.summary.noAgreement")
              }
              keepToneAtZero
            />
            <InsightCard
              icon={Calculator}
              tone="profit"
              label={t("companyPartners.summary.estimated")}
              value={money(estimate.amount)}
              amount={estimate.amount}
              meta={
                <EnterpriseBadge variant="outline" className="font-medium">
                  {t("companyPartners.estimateTag")}
                </EnterpriseBadge>
              }
            />
            <InsightCard
              icon={Handshake}
              tone="success"
              label={t("companyPartners.summary.approved")}
              value={money(statement.approved.total)}
              amount={statement.approved.total}
              meta={<InsightScope kind="period">{t("companyPartners.fields.period")}</InsightScope>}
            />
            <InsightCard
              icon={HandCoins}
              label={t("companyPartners.summary.paid")}
              value={money(statement.paidInRange)}
              amount={statement.paidInRange}
              meta={<InsightScope kind="period">{t("companyPartners.fields.period")}</InsightScope>}
            />
            <InsightCard
              icon={Scale}
              tone="warning"
              emphasis={balance.payable > 0}
              label={t("companyPartners.summary.payable")}
              value={money(balance.payable)}
              amount={balance.payable}
              meta={
                <InsightScope kind="current">{t("companyPartners.sections.position")}</InsightScope>
              }
            />
            <InsightCard
              icon={Wallet}
              tone="destructive"
              label={t("companyPartners.summary.advance")}
              value={money(balance.advance)}
              amount={balance.advance}
              meta={
                <InsightScope kind="current">{t("companyPartners.sections.position")}</InsightScope>
              }
            />
          </InsightGroup>

          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <SummaryCard
              tone="revenue"
              icon={BarChart3}
              title={`${t("companyPartners.sections.profitUsed")} — ${formatDate(statement.range.from)} – ${formatDate(statement.range.to)}`}
              currency={currency ?? ""}
              rows={[
                { label: t("companyPartners.fields.revenue"), value: estimate.figures.netRevenue },
                {
                  label: t("companyPartners.fields.costOfSales"),
                  value: estimate.figures.costOfSales,
                },
                {
                  label: t("companyPartners.fields.grossProfit"),
                  value: estimate.figures.grossProfit,
                  emphasis: current?.basis === "GROSS_PROFIT",
                },
                {
                  label: t("companyPartners.fields.otherExpenses"),
                  value: estimate.figures.otherExpensesNet,
                },
                {
                  label: t("companyPartners.fields.netProfit"),
                  value: estimate.figures.netProfit,
                  emphasis: current?.basis !== "GROSS_PROFIT",
                },
              ]}
            />
            <SummaryCard
              tone="profit"
              icon={Scale}
              title={t("companyPartners.sections.position")}
              currency={currency ?? ""}
              rows={[
                { label: t("companyPartners.fields.approved"), value: balance.approved },
                { label: t("companyPartners.fields.paid"), value: balance.paid },
                { label: t("companyPartners.fields.advance"), value: balance.advance },
                {
                  label: t("companyPartners.summary.payable"),
                  value: balance.payable,
                  emphasis: true,
                },
              ]}
            />
          </div>
        </>
      ) : null}

      <EntityTabs
        tabs={[
          {
            value: "estimate",
            label: t("companyPartners.tabs.estimate"),
            content: (
              <EnterpriseDataTable
                tableId="company-partner-segments"
                columns={segmentColumns}
                data={estimate?.segments ?? []}
                isLoading={isLoading}
                getRowId={(row) => `${row.agreementId}-${row.from}`}
                emptyTitle={t("companyPartners.summary.noAgreement")}
              />
            ),
          },
          {
            value: "approved",
            label: t("companyPartners.tabs.approved"),
            content: (
              <EnterpriseDataTable
                tableId="company-partner-approved"
                columns={periodColumns}
                data={statement?.approved.periods ?? []}
                isLoading={isLoading}
                getRowId={(row) => row.periodId}
                emptyTitle={t("companyPartners.periods.empty")}
              />
            ),
          },
          {
            value: "agreements",
            label: t("companyPartners.tabs.agreements"),
            content: (
              <EnterpriseDataTable
                tableId="company-partner-agreements"
                columns={agreementColumns}
                data={agreements}
                isLoading={isLoading}
                getRowId={(row) => row.id}
                emptyTitle={t("companyPartners.summary.noAgreement")}
              />
            ),
          },
          {
            value: "payments",
            label: t("companyPartners.tabs.payments"),
            content: (
              <EnterpriseDataTable
                tableId="company-partner-payments"
                columns={paymentColumns}
                data={statement?.payments ?? []}
                isLoading={isLoading}
                getRowId={(row) => row.id}
                emptyTitle={t("companyPartners.empty")}
              />
            ),
          },
        ]}
      />

      <AgreementDialog
        mode={agreementDialog}
        onOpenChange={(open) => {
          if (!open) setAgreementDialog(null);
        }}
        onSaved={() => {
          setAgreementDialog(null);
          void load();
        }}
      />
      <PaymentDialog
        partner={paymentTarget}
        onOpenChange={(open) => {
          if (!open) setPayOpen(false);
        }}
        onSaved={() => {
          setPayOpen(false);
          void load();
        }}
      />
      <ReversePaymentDialog
        payment={reversing}
        onOpenChange={(open) => {
          if (!open) setReversing(null);
        }}
        onSaved={() => {
          setReversing(null);
          void load();
        }}
      />
    </PageWorkspace>
  );
}

export default function CompanyPartnerStatementPage() {
  return (
    <PermissionGate permission="company-partners.view">
      <PartnerStatementContent />
    </PermissionGate>
  );
}
