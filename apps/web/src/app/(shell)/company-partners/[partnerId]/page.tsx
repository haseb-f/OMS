"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BarChart3,
  CalendarX,
  Handshake,
  Percent,
  Play,
  Plus,
  Printer,
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
import { SummaryCard } from "@/components/agents/summary-card";
import { ReportMoney } from "@/components/accounting/financial-report/report-money";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { RowActionsMenu } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import { AGREEMENT_TONE, incomeStatementHref, percentText } from "@/config/company-partners/format";
import { PeriodStatementView } from "@/config/company-partners/period-statement-view";
import { usePartnerStatementPrint } from "@/config/company-partners/use-statement-print";
import {
  companyPartnersService,
  type CompanyPartnerDetail,
  type PartnerAgreementRow,
  type PartnerPaymentRow,
  type PartnerSegment,
  type PartnerStatement,
} from "@/services/company-partners-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, toISODate } from "@/lib/date";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import {
  AgreementDialog,
  type AgreementDialogMode,
  PaymentDialog,
  ReversePaymentDialog,
} from "../_components/partner-dialogs";
import { PartnerLoginCard } from "../_components/partner-login";
import { ltrIsolate } from "@/lib/bidi";

const yearToDate = (): DateRangeValue => {
  const today = new Date();
  return { from: new Date(today.getFullYear(), 0, 1), to: today };
};

/**
 * One company partner (R14 W5 + R15 W4): terms, the partner's own login, the
 * per-period statement shared with the partner portal (estimate / under
 * review / approved, paid oldest-first, remaining, payment and adjustment
 * history), the live range estimate with the company figures it used, the
 * agreements and the payments with their journal trace.
 */
function PartnerStatementContent() {
  const { t } = useLocale();
  const { partnerId } = useParams<{ partnerId: string }>();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("company-partners.manage");
  const canPay = hasPermission("company-partners.pay");
  const canManageLogin = hasPermission("company-partners.users.manage");
  const printStatement = usePartnerStatementPrint();
  const [range, setRange] = useState<DateRangeValue>(yearToDate);
  const [statement, setStatement] = useState<PartnerStatement | null>(null);
  const [profile, setProfile] = useState<CompanyPartnerDetail | null>(null);
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
      const [nextStatement, nextProfile] = await Promise.all([
        companyPartnersService.statement(partnerId, query),
        companyPartnersService.get(partnerId),
      ]);
      setStatement(nextStatement);
      setProfile(nextProfile);
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

  const activate = useCallback(
    async (agreement: PartnerAgreementRow) => {
      try {
        await companyPartnersService.activateAgreement(agreement.id);
        toast.success(t("companyPartners.toasts.agreementActivated"));
        void load();
      } catch (activateError) {
        reportApiError(activateError, "errors.saveFailed");
      }
    },
    [t, load],
  );

  const agreements = profile?.agreements ?? [];
  const currency = statement?.currency?.code ?? null;
  const current = statement?.currentAgreements[0] ?? null;
  const partnership = profile?.partnership ?? statement?.partnership ?? null;

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
            <span className="text-muted-foreground">
              {t("companyPartners.partnership.openEnded")}
            </span>
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
                key: "activate",
                label: t("companyPartners.actions.activate"),
                icon: Play,
                hidden: !canManage || row.original.status !== "DRAFT",
                onSelect: () => void activate(row.original),
              },
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
    [t, canManage, activate],
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
            <StatusBadge
              label={t("companyPartners.statement.reversed")}
              tone="neutral"
              icon={Undo2}
            />
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
  const paymentTarget = useMemo(
    () =>
      payOpen && statement
        ? {
            partnerId,
            name: statement.partner.name,
            payable: statement.position.payable,
          }
        : null,
    [payOpen, statement, partnerId],
  );

  const print = () => {
    if (!statement) return;
    printStatement(
      statement,
      statement.partner,
      statement.payments.map((payment) => ({
        date: payment.date,
        reference: [payment.paymentNumber, payment.reference].filter(Boolean).join(" · "),
        description: payment.reversedAt
          ? `${t("companyPartners.statement.method.OTHER")} — ${t("companyPartners.statement.reversed")}`
          : t("companyPartners.statement.method.OTHER"),
        amount: payment.amount,
      })),
    );
  };

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
              key: "print",
              label: t("companyPartners.statement.print"),
              icon: Printer,
              disabled: !statement,
              onSelect: print,
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

      {profile && statement && estimate ? (
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
          <SummaryCard
            tone="info"
            icon={Handshake}
            title={t("companyPartners.summary.currentShare")}
            currency=""
            rows={[
              {
                label: t("companyPartners.fields.profitShare"),
                value: current ? percentText(current.profitSharePercent) : "—",
              },
              {
                label: t("companyPartners.fields.basis"),
                value: current ? t(`companyPartners.basis.${current.basis}`) : "—",
              },
              {
                label: t("companyPartners.fields.frequency"),
                value: current ? t(`companyPartners.frequency.${current.frequency}`) : "—",
              },
              {
                label: t("companyPartners.fields.effectiveFrom"),
                value: partnership?.startedOn ? ltrIsolate(formatDate(partnership.startedOn)) : "—",
              },
              {
                label: t("companyPartners.fields.effectiveTo"),
                value: partnership?.endsOn
                  ? ltrIsolate(formatDate(partnership.endsOn))
                  : t("companyPartners.partnership.openEnded"),
              },
              {
                label: t("companyPartners.fields.partnership"),
                value: partnership ? t(`companyPartners.partnership.${partnership.status}`) : "—",
                emphasis: partnership?.status === "ENDED",
              },
            ]}
          />
          <SummaryCard
            tone="revenue"
            icon={BarChart3}
            title={`${t("companyPartners.sections.profitUsed")} — ${ltrIsolate(`${formatDate(statement.range.from)} – ${formatDate(statement.range.to)}`)}`}
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
          <PartnerLoginCard
            partnerId={partnerId}
            partnerName={profile.name}
            partnerEmail={profile.email}
            login={profile.login}
            canManage={canManageLogin}
            hasAgreement={Boolean(partnership && partnership.status !== "NO_AGREEMENT")}
            onChanged={() => void load()}
          />
        </div>
      ) : null}

      <PeriodStatementView
        statement={statement}
        isLoading={isLoading}
        tableIdPrefix="company-partner"
        payments={
          <EnterpriseDataTable
            tableId="company-partner-payments"
            columns={paymentColumns}
            data={statement?.payments ?? []}
            isLoading={isLoading}
            getRowId={(row) => row.id}
            emptyTitle={t("companyPartners.statement.noPayments")}
          />
        }
        extraTabs={[
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
