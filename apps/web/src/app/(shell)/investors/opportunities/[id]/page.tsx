"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  CirclePlay,
  DoorOpen,
  Plus,
  StopCircle,
  Archive as ArchiveIcon,
} from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { HeaderActions } from "@/components/shared/header-actions";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import {
  FinancialReportView,
  type FinancialReportColumn,
  type FinancialReportLine,
} from "@/components/accounting/financial-report";
import { tableIdentityCellClass, tableSecondaryTextClass } from "@/components/ui/table";
import { Amount, Percent } from "@/components/investors/investor-amount";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import {
  investmentOpportunitiesService,
  type InvestmentOpportunityRow,
} from "@/services/investment-opportunities-service";
import {
  investorSubscriptionsService,
  type InvestorSubscriptionRow,
} from "@/services/investor-subscriptions-service";
import {
  capitalContributionsService,
  type CapitalContributionRow,
} from "@/services/capital-contributions-service";
import { investorsService, type InvestorRow } from "@/services/investors-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import {
  investmentSalesService,
  type OpportunitySaleAllocationRow,
  type OpportunitySalesSummary,
} from "@/services/investment-sales-service";
import {
  investmentExpensesService,
  type OpportunityExpenseCategory,
  type OpportunityExpenseRow,
} from "@/services/investment-expenses-service";
import {
  investmentProfitService,
  type ProfitBreakdown,
  type ProfitCalculationRow,
} from "@/services/investment-profit-service";
import {
  investmentSettlementService,
  type OpportunitySettlementRow,
  type SettlementSuggestionLine,
} from "@/services/investment-settlement-service";
import { DistributionsTab } from "./distributions-tab";
import {
  investmentDistributionsService,
  type OpportunityFinancialSummary,
} from "@/services/investment-distributions-service";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateTime, fromISODate, toISODate } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { cachedLookup } from "@/lib/lookup-cache";

const NO_EXPANDED = new Set<string>();
const WATERFALL_COLUMNS: FinancialReportColumn[] = [
  { key: "amount", labelKey: "investors.profit.waterfall.amount" },
];

const statusTone: Record<
  InvestmentOpportunityRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  OPEN: "success",
  FUNDED: "success",
  ACTIVE: "success",
  ENDED: "warning",
  SETTLED: "neutral",
  CLOSED: "neutral",
  CANCELLED: "destructive",
};

export default function OpportunityWorkspacePage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();

  const [opportunity, setOpportunity] = useState<InvestmentOpportunityRow | null>(null);
  const [financialSummary, setFinancialSummary] = useState<OpportunityFinancialSummary | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<InvestorSubscriptionRow[] | null>(null);
  const [contributions, setContributions] = useState<CapitalContributionRow[] | null>(null);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addInvestorOpen, setAddInvestorOpen] = useState(false);
  const [addContributionOpen, setAddContributionOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentOpportunitiesService.get(params.id);
      setOpportunity(data);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const loadFinancialSummary = useCallback(async () => {
    const summary = await investmentDistributionsService.opportunitySummary(params.id);
    setFinancialSummary(summary);
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFinancialSummary();
  }, [loadFinancialSummary]);

  useBreadcrumbLabel(opportunity?.code ?? null);

  const loadSubscriptions = useCallback(async () => {
    const result = await investorSubscriptionsService.list({
      opportunityId: params.id,
      pageSize: 100,
    });
    setSubscriptions(result.items);
  }, [params.id]);

  const loadContributions = useCallback(async () => {
    const result = await capitalContributionsService.list({
      opportunityId: params.id,
      pageSize: 100,
    });
    setContributions(result.items);
  }, [params.id]);

  const loadActivity = useCallback(async () => {
    const entries = await investmentOpportunitiesService.activity(params.id);
    setActivity(entries);
  }, [params.id]);

  async function runAction(action: () => Promise<unknown>) {
    try {
      await action();
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (isLoading || !opportunity) return null;

  const canManage = hasPermission("investment-opportunities.manage-status");
  const canCancel = hasPermission("investment-opportunities.cancel");
  const canArchive = hasPermission("investment-opportunities.archive");
  const canCreateSubscription = hasPermission("investor-subscriptions.create");
  const canCreateContribution = hasPermission("capital-contributions.create");
  const canManageSales = hasPermission("investment-sales.manage");
  const canManageExpenses =
    hasPermission("investment-expenses.create") || hasPermission("investment-expenses.edit");
  const canApproveExpenses = hasPermission("investment-expenses.approve");
  const canCalculateProfit = hasPermission("investment-profit.calculate");
  const canApproveProfit = hasPermission("investment-profit.approve");
  const canManageSettlement =
    hasPermission("investment-settlement.start") || hasPermission("investment-settlement.manage");
  const canApproveSettlement = hasPermission("investment-settlement.approve");
  const canCancelSettlement = hasPermission("investment-settlement.cancel");
  const canCreateDistribution = hasPermission("investment-distributions.create");
  const canApproveDistribution = hasPermission("investment-distributions.approve");
  const canCancelDistribution = hasPermission("investment-distributions.cancel");
  const canRecordDistributionPayment = hasPermission("investment-payments.create");
  const canConfirmDistributionPayment = hasPermission("investment-payments.confirm");

  return (
    <>
      <DetailWorkspace
        title={opportunity.nameAr}
        reference={opportunity.code}
        status={
          <StatusBadge
            label={t(`investors.opportunities.status.${opportunity.status}` as MessageKey)}
            tone={statusTone[opportunity.status]}
          />
        }
        actions={
          <HeaderActions
            primary={
              opportunity.status === "DRAFT"
                ? {
                    key: "open",
                    label: t("investors.opportunities.actions.open"),
                    icon: DoorOpen,
                    hidden: !canManage,
                    onSelect: () =>
                      runAction(() => investmentOpportunitiesService.open(opportunity.id)),
                  }
                : opportunity.status === "OPEN" || opportunity.status === "FUNDED"
                  ? {
                      key: "activate",
                      label: t("investors.opportunities.actions.activate"),
                      icon: CirclePlay,
                      hidden: !canManage,
                      onSelect: () =>
                        runAction(() => investmentOpportunitiesService.activate(opportunity.id)),
                    }
                  : opportunity.status === "ACTIVE"
                    ? {
                        key: "end",
                        label: t("investors.opportunities.actions.end"),
                        icon: StopCircle,
                        hidden: !canManage,
                        onSelect: () =>
                          runAction(() => investmentOpportunitiesService.end(opportunity.id)),
                      }
                    : opportunity.status === "SETTLED"
                      ? {
                          key: "close",
                          label: t("investors.opportunities.actions.close"),
                          icon: ArchiveIcon,
                          hidden: !canManage,
                          onSelect: () =>
                            runAction(() => investmentOpportunitiesService.close(opportunity.id)),
                        }
                      : undefined
            }
            more={[
              // Cancel / Archive keep their own ConfirmationDialogs.
              {
                key: "cancel",
                label: t("investors.opportunities.actions.cancel"),
                icon: Ban,
                hidden: !canCancel || !["DRAFT", "OPEN", "FUNDED"].includes(opportunity.status),
                onSelect: () => setCancelOpen(true),
              },
              {
                key: "archive",
                label: t("investors.opportunities.actions.archive"),
                icon: ArchiveIcon,
                hidden:
                  !canArchive || !["DRAFT", "CANCELLED", "CLOSED"].includes(opportunity.status),
                onSelect: () => setArchiveOpen(true),
              },
            ]}
          />
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            size="compact"
            label={t("investors.opportunities.fields.targetCapital")}
            value={formatAmount(opportunity.targetCapital, { currency: opportunity.currency.code })}
          />
          <KpiCard
            size="compact"
            label={t("investors.opportunities.fields.confirmedFundedCapital")}
            value={formatAmount(opportunity.confirmedFundedCapital, {
              currency: opportunity.currency.code,
            })}
          />
          <KpiCard
            size="compact"
            label={t("investors.opportunities.fields.fundingPercent")}
            value={`${formatAmount(opportunity.fundingPercent, { decimals: 0, zero: "zero" })}%`}
          />
          <KpiCard
            size="compact"
            label={t("investors.opportunities.fields.investorsCount")}
            value={opportunity.investorsCount}
          />
          <KpiCard
            size="compact"
            label={t("investors.opportunities.overview.daysRemaining")}
            value={
              opportunity.isPastEndDate
                ? t("investors.opportunities.overview.ended")
                : opportunity.daysRemaining
            }
          />
        </div>

        {financialSummary && financialSummary.approvedNetProfit != null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.approvedNetProfit")}
              value={formatAmount(financialSummary.approvedNetProfit, {
                currency: opportunity.currency.code,
              })}
            />
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.investorProfitPool")}
              value={formatAmount(financialSummary.investorProfitPool ?? 0, {
                currency: opportunity.currency.code,
              })}
            />
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.distributedProfit")}
              value={formatAmount(financialSummary.distributedProfit, {
                currency: opportunity.currency.code,
              })}
            />
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.paidProfit")}
              value={formatAmount(financialSummary.paidProfit, {
                currency: opportunity.currency.code,
              })}
            />
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.outstandingInvestorProfit")}
              value={formatAmount(financialSummary.outstandingInvestorProfit, {
                currency: opportunity.currency.code,
              })}
            />
            <KpiCard
              size="compact"
              label={t("investors.opportunities.financialSummary.capitalReturned")}
              value={formatAmount(financialSummary.capitalReturned, {
                currency: opportunity.currency.code,
              })}
            />
          </div>
        ) : null}

        <EntityTabs
          tabs={[
            {
              value: "overview",
              label: t("investors.opportunities.tabs.overview"),
              content: (
                <DetailSection>
                  <DetailFieldGrid columns={3}>
                    <DetailField
                      label={t("investors.opportunities.fields.nameEn")}
                      value={opportunity.nameEn}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.currency")}
                      value={opportunity.currency.code}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.investorNetProfitSharePercent")}
                      value={
                        <span className="num">{`${opportunity.investorNetProfitSharePercent}%`}</span>
                      }
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.startDate")}
                      value={<span className="num">{formatDate(opportunity.startDate)}</span>}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.endDate")}
                      value={<span className="num">{formatDate(opportunity.endDate)}</span>}
                    />
                    <DetailField
                      label={t("investors.opportunities.overview.totalFundedUnits")}
                      value={<span className="num">{opportunity.totalFundedUnits}</span>}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.description")}
                      value={opportunity.description}
                    />
                  </DetailFieldGrid>
                </DetailSection>
              ),
            },
            {
              value: "products",
              label: t("investors.opportunities.tabs.products"),
              content: (
                <DetailSection>
                  <ProductsTable opportunity={opportunity} />
                </DetailSection>
              ),
            },
            {
              value: "investors",
              label: t("investors.opportunities.tabs.investors"),
              content: (
                <InvestorsTab
                  subscriptions={subscriptions}
                  onLoad={loadSubscriptions}
                  canCreate={canCreateSubscription && opportunity.status === "OPEN"}
                  onAdd={() => setAddInvestorOpen(true)}
                />
              ),
            },
            {
              value: "funding",
              label: t("investors.opportunities.tabs.funding"),
              content: (
                <FundingTab
                  contributions={contributions}
                  onLoad={loadContributions}
                  canCreate={canCreateContribution}
                  onAdd={() => setAddContributionOpen(true)}
                  onChanged={async () => {
                    await loadContributions();
                    await load();
                  }}
                />
              ),
            },
            {
              value: "sales",
              label: t("investors.opportunities.tabs.sales"),
              content: <SalesTab opportunity={opportunity} canManage={canManageSales} />,
            },
            {
              value: "expenses",
              label: t("investors.opportunities.tabs.expenses"),
              content: (
                <ExpensesTab
                  opportunityId={opportunity.id}
                  canManage={canManageExpenses}
                  canApprove={canApproveExpenses}
                />
              ),
            },
            {
              value: "profit",
              label: t("investors.opportunities.tabs.profit"),
              content: (
                <ProfitTab
                  opportunityId={opportunity.id}
                  canCalculate={canCalculateProfit}
                  canApprove={canApproveProfit}
                />
              ),
            },
            {
              value: "settlement",
              label: t("investors.opportunities.tabs.settlement"),
              content: (
                <SettlementTab
                  opportunity={opportunity}
                  canManage={canManageSettlement}
                  canApprove={canApproveSettlement}
                  canCancel={canCancelSettlement}
                />
              ),
            },
            {
              value: "distributions",
              label: t("investors.opportunities.tabs.distributions"),
              content: (
                <DistributionsTab
                  opportunityId={opportunity.id}
                  currencyCode={opportunity.currency.code}
                  canCreate={canCreateDistribution}
                  canApprove={canApproveDistribution}
                  canCancel={canCancelDistribution}
                  canRecordPayment={canRecordDistributionPayment}
                  canConfirmPayment={canConfirmDistributionPayment}
                  onChanged={loadFinancialSummary}
                />
              ),
            },
            {
              value: "activity",
              label: t("investors.opportunities.tabs.activity"),
              content: <ActivityTab activity={activity} onLoad={loadActivity} />,
            },
          ]}
        />
      </DetailWorkspace>

      <ConfirmationDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tone="destructive"
        title={t("investors.opportunities.actions.cancel")}
        description={opportunity.code}
        onConfirm={() => {
          setCancelOpen(false);
          runAction(() => investmentOpportunitiesService.cancel(opportunity.id));
        }}
      />
      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        tone="destructive"
        title={t("investors.opportunities.actions.archive")}
        description={opportunity.code}
        onConfirm={() => {
          setArchiveOpen(false);
          runAction(() => investmentOpportunitiesService.archive(opportunity.id));
        }}
      />

      <AddInvestorDialog
        open={addInvestorOpen}
        onOpenChange={setAddInvestorOpen}
        opportunityId={opportunity.id}
        onAdded={async () => {
          await loadSubscriptions();
          await load();
        }}
      />
      <AddContributionDialog
        open={addContributionOpen}
        onOpenChange={setAddContributionOpen}
        subscriptions={subscriptions ?? []}
        onAdded={async () => {
          await loadContributions();
        }}
      />
    </>
  );
}

function ProductsTable({ opportunity }: { opportunity: InvestmentOpportunityRow }) {
  const { t } = useLocale();
  if (opportunity.products.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("common.noDataAvailable")} />;
  }
  const columns: CompactDetailColumn<InvestmentOpportunityRow["products"][number]>[] = [
    {
      id: "product",
      header: t("investors.opportunities.create.addProduct"),
      cell: (p) => (
        <span className="inline-flex min-w-0 flex-col">
          <span className={tableIdentityCellClass}>{p.productName}</span>
          <span className={tableSecondaryTextClass}>
            <span className="num">{p.productSku}</span>
          </span>
        </span>
      ),
      footer: t("reports.finance.totals"),
    },
    {
      id: "units",
      header: t("investors.opportunities.create.fundedUnits"),
      align: "end",
      cell: (p) => <span className="num">{p.fundedUnits}</span>,
      footer: <span className="num">{opportunity.totalFundedUnits}</span>,
    },
    {
      id: "unitCost",
      header: t("investors.opportunities.create.fundedUnitCost"),
      align: "end",
      cell: (p) => <Amount value={p.fundedUnitCost} />,
    },
    {
      id: "capital",
      header: t("investors.opportunities.create.lineCapital"),
      align: "end",
      cell: (p) => <Amount value={p.fundedCapital} />,
      footer: <Amount value={opportunity.products.reduce((sum, p) => sum + p.fundedCapital, 0)} />,
    },
  ];
  return <CompactDetailTable columns={columns} rows={opportunity.products} rowKey={(p) => p.id} />;
}

function InvestorsTab({
  subscriptions,
  onLoad,
  canCreate,
  onAdd,
}: {
  subscriptions: InvestorSubscriptionRow[] | null;
  onLoad: () => void;
  canCreate: boolean;
  onAdd: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!subscriptions) return null;

  const columns: CompactDetailColumn<InvestorSubscriptionRow>[] = [
    {
      id: "investor",
      header: t("investors.subscriptions.fields.investor"),
      cell: (s) => (
        <a
          href={`/investors/list/${s.investorId}`}
          className={`hover:underline ${tableIdentityCellClass}`}
        >
          {s.investorName}
        </a>
      ),
      footer: t("reports.finance.totals"),
    },
    {
      id: "committed",
      header: t("investors.subscriptions.fields.committedAmount"),
      align: "end",
      cell: (s) => <Amount value={s.committedAmount} />,
      footer: <Amount value={subscriptions.reduce((sum, s) => sum + s.committedAmount, 0)} />,
    },
    {
      id: "funded",
      header: t("investors.subscriptions.fields.fundedAmount"),
      align: "end",
      cell: (s) => <Amount value={s.fundedAmount} />,
      footer: <Amount value={subscriptions.reduce((sum, s) => sum + s.fundedAmount, 0)} />,
    },
    {
      id: "participation",
      header: t("investors.subscriptions.fields.participationPercent"),
      align: "end",
      cell: (s) => <Percent value={s.participationPercent} />,
    },
    {
      id: "status",
      header: t("investors.subscriptions.fields.status"),
      cell: (s) => (
        <StatusBadge
          label={t(`investors.subscriptions.status.${s.status}` as MessageKey)}
          tone="neutral"
        />
      ),
    },
  ];

  return (
    <DetailSection
      actions={
        canCreate ? (
          <EnterpriseButton type="button" size="sm" onClick={onAdd}>
            <Plus />
            {t("investors.opportunities.actions.addInvestor")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {subscriptions.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("common.noDataAvailable")} />
      ) : (
        <CompactDetailTable columns={columns} rows={subscriptions} rowKey={(s) => s.id} />
      )}
    </DetailSection>
  );
}

function FundingTab({
  contributions,
  onLoad,
  canCreate,
  onAdd,
  onChanged,
}: {
  contributions: CapitalContributionRow[] | null;
  onLoad: () => void;
  canCreate: boolean;
  onAdd: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canConfirm = hasPermission("capital-contributions.confirm");
  const canCancel = hasPermission("capital-contributions.cancel");

  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm(id: string) {
    try {
      await capitalContributionsService.confirm(id);
      toast.success(t("common.saved"));
      await onChanged();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  async function cancel(id: string) {
    try {
      await capitalContributionsService.cancel(id);
      toast.success(t("common.saved"));
      await onChanged();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!contributions) return null;

  const columns: CompactDetailColumn<CapitalContributionRow>[] = [
    {
      id: "investor",
      header: t("investors.contributions.fields.investor"),
      cell: (c) => <span className={tableIdentityCellClass}>{c.investorName}</span>,
    },
    {
      id: "date",
      header: t("investors.contributions.fields.date"),
      cell: (c) => <span className="num">{formatDate(c.contributionDate)}</span>,
    },
    {
      id: "amount",
      header: t("investors.contributions.fields.amount"),
      align: "end",
      cell: (c) => <Amount value={c.amount} />,
    },
    {
      id: "status",
      header: t("investors.contributions.fields.status"),
      cell: (c) => (
        <StatusBadge
          label={t(`investors.contributions.status.${c.status}` as MessageKey)}
          tone={
            c.status === "CONFIRMED" ? "success" : c.status === "PENDING" ? "warning" : "neutral"
          }
        />
      ),
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (c) =>
        c.status === "PENDING" ? (
          <div className="flex gap-1">
            {canConfirm ? (
              <EnterpriseButton size="sm" variant="outline" onClick={() => confirm(c.id)}>
                {t("investors.opportunities.actions.confirm")}
              </EnterpriseButton>
            ) : null}
            {canCancel ? (
              <EnterpriseButton size="sm" variant="ghost" onClick={() => cancel(c.id)}>
                {t("investors.opportunities.actions.reject")}
              </EnterpriseButton>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <DetailSection
      actions={
        canCreate ? (
          <EnterpriseButton type="button" size="sm" onClick={onAdd}>
            <Plus />
            {t("investors.opportunities.actions.addContribution")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {contributions.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("common.noDataAvailable")} />
      ) : (
        <CompactDetailTable columns={columns} rows={contributions} rowKey={(c) => c.id} />
      )}
    </DetailSection>
  );
}

function ActivityTab({
  activity,
  onLoad,
}: {
  activity: MasterDataActivityEntry[] | null;
  onLoad: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!activity) return null;
  const entries: TimelineEntry[] = activity.map((entry) => ({
    id: entry.id,
    title: entry.description,
    timestamp: formatDateTime(entry.createdAt),
  }));
  if (entries.length === 0) {
    return <EmptyState icon={CheckCircle2} title={t("common.noActivity")} />;
  }
  return <AuditTimeline entries={entries} />;
}

function AddInvestorDialog({
  open,
  onOpenChange,
  opportunityId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [investor, setInvestor] = useState<InvestorRow | null>(null);
  const [committedAmount, setCommittedAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!investor || !committedAmount) return;
    setIsSaving(true);
    try {
      await investorSubscriptionsService.create({
        investorId: investor.id,
        opportunityId,
        committedAmount: Number(committedAmount),
      });
      toast.success(t("common.saved"));
      setInvestor(null);
      setCommittedAmount("");
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("investors.opportunities.actions.addInvestor")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <EntityCombobox<InvestorRow>
          value={investor}
          onChange={setInvestor}
          onSearch={(query) =>
            cachedLookup(`investors:search:${query}`, () => investorsService.search(query))
          }
          getId={(row) => row.id}
          getTitle={(row) => row.name}
          placeholder={t("investors.subscriptions.fields.investor")}
          triggerProps={{ "aria-label": t("investors.subscriptions.fields.investor") }}
        />
        <Input
          type="number"
          min={0.01}
          step="0.01"
          placeholder={t("investors.subscriptions.fields.committedAmount")}
          value={committedAmount}
          onChange={(e) => setCommittedAmount(e.target.value)}
        />
      </div>
    </EnterpriseModal>
  );
}

function AddContributionDialog({
  open,
  onOpenChange,
  subscriptions,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptions: InvestorSubscriptionRow[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [subscription, setSubscription] = useState<InvestorSubscriptionRow | null>(null);
  const [amount, setAmount] = useState("");
  const [contributionDate, setContributionDate] = useState(() => toISODate(new Date()));
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!subscription || !amount || !contributionDate) return;
    setIsSaving(true);
    try {
      await capitalContributionsService.create({
        subscriptionId: subscription.id,
        amount: Number(amount),
        contributionDate,
      });
      toast.success(t("common.saved"));
      setSubscription(null);
      setAmount("");
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("investors.opportunities.actions.addContribution")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <EntityCombobox<InvestorSubscriptionRow>
          value={subscription}
          onChange={setSubscription}
          items={subscriptions}
          getId={(row) => row.id}
          getTitle={(row) => row.investorName}
          getSubtitle={(row) =>
            `${formatAmount(row.committedAmount)} / ${formatAmount(row.fundedAmount)}`
          }
        />
        <Input
          type="number"
          min={0.01}
          step="0.01"
          placeholder={t("investors.contributions.fields.amount")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <EnterpriseDatePicker
          value={fromISODate(contributionDate)}
          onChange={(next) => setContributionDate(next ? toISODate(next) : "")}
        />
      </div>
    </EnterpriseModal>
  );
}

// ---------------------------------------------------------------------------
// Investor Engine Milestone 2 — Sales / Expenses / Profit / Settlement tabs.
// ---------------------------------------------------------------------------

function SalesTab({
  opportunity,
  canManage,
}: {
  opportunity: InvestmentOpportunityRow;
  canManage: boolean;
}) {
  const { t } = useLocale();
  const [summary, setSummary] = useState<OpportunitySalesSummary | null>(null);
  const [allocations, setAllocations] = useState<OpportunitySaleAllocationRow[] | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<OpportunitySaleAllocationRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [isRecalculating, setIsRecalculating] = useState(false);

  const load = useCallback(async () => {
    const [summaryResult, listResult] = await Promise.all([
      investmentSalesService.summary(opportunity.id),
      investmentSalesService.list({ opportunityId: opportunity.id, pageSize: 100 }),
    ]);
    setSummary(summaryResult);
    setAllocations(listResult.items);
  }, [opportunity.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function recalculate() {
    setIsRecalculating(true);
    try {
      const result = await investmentSalesService.recalculate();
      toast.success(`${t("common.saved")} (${result.allocated})`);
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsRecalculating(false);
    }
  }

  async function confirmReverse() {
    if (!reverseTarget || !reverseReason.trim()) return;
    try {
      await investmentSalesService.reverse(reverseTarget.id, reverseReason.trim());
      toast.success(t("common.saved"));
      setReverseTarget(null);
      setReverseReason("");
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!summary || !allocations) return null;

  const columns: CompactDetailColumn<OpportunitySaleAllocationRow>[] = [
    {
      id: "product",
      header: t("investors.sales.fields.product"),
      cell: (a) => (
        <span className="inline-flex min-w-0 flex-col">
          <span className={tableIdentityCellClass}>{a.productName}</span>
          <span className={tableSecondaryTextClass}>
            <span className="num">{a.productSku}</span>
          </span>
        </span>
      ),
    },
    {
      id: "order",
      header: t("investors.sales.fields.order"),
      cell: (a) => <span className="num">{a.orderNumber}</span>,
    },
    { id: "customer", header: t("investors.sales.fields.customer"), cell: (a) => a.customerName },
    {
      id: "quantity",
      header: t("investors.sales.fields.allocatedQuantity"),
      align: "end",
      cell: (a) => <span className="num">{a.allocatedQuantity}</span>,
    },
    {
      id: "revenue",
      header: t("investors.sales.fields.allocatedRevenue"),
      align: "end",
      cell: (a) => <Amount value={a.allocatedRevenue} />,
    },
    {
      id: "type",
      header: t("investors.sales.fields.type"),
      cell: (a) => t(`investors.sales.type.${a.allocationType}` as MessageKey),
    },
    {
      id: "status",
      header: t("investors.sales.fields.status"),
      cell: (a) => (
        <StatusBadge
          label={t(`investors.sales.status.${a.status}` as MessageKey)}
          tone={a.status === "ACTIVE" ? "success" : "neutral"}
        />
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: t("common.actions"),
            cell: (a: OpportunitySaleAllocationRow) =>
              a.status === "ACTIVE" ? (
                <EnterpriseButton size="sm" variant="ghost" onClick={() => setReverseTarget(a)}>
                  {t("investors.sales.actions.reverse")}
                </EnterpriseButton>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <DetailSection
      actions={
        canManage ? (
          <div className="flex gap-2">
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={recalculate}
              disabled={isRecalculating}
            >
              {t("investors.sales.actions.recalculate")}
            </EnterpriseButton>
            <EnterpriseButton type="button" size="sm" onClick={() => setManualOpen(true)}>
              <Plus />
              {t("investors.sales.actions.manualAllocate")}
            </EnterpriseButton>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          size="compact"
          label={t("investors.sales.metrics.fundedUnits")}
          value={summary.totals.fundedUnits}
        />
        <KpiCard
          size="compact"
          label={t("investors.sales.metrics.netSoldUnits")}
          value={summary.totals.netSoldUnits}
        />
        <KpiCard
          size="compact"
          label={t("investors.sales.metrics.remainingUnits")}
          value={summary.totals.remainingUnits}
        />
        <KpiCard
          size="compact"
          label={t("investors.sales.metrics.attributableRevenue")}
          value={formatAmount(summary.totals.attributableRevenue, {
            currency: opportunity.currency.code,
          })}
        />
        <KpiCard
          size="compact"
          label={t("investors.sales.metrics.cogs")}
          value={formatAmount(summary.totals.cogs, { currency: opportunity.currency.code })}
        />
      </div>

      {allocations.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("common.noDataAvailable")} />
      ) : (
        <CompactDetailTable columns={columns} rows={allocations} rowKey={(a) => a.id} />
      )}

      <ManualAllocateDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        opportunity={opportunity}
        onAllocated={load}
      />
      <ConfirmationDialog
        open={!!reverseTarget}
        onOpenChange={(next) => {
          if (!next) {
            setReverseTarget(null);
            setReverseReason("");
          }
        }}
        title={t("investors.sales.actions.reverse")}
        description={reverseTarget?.orderNumber}
        confirmDisabled={!reverseReason.trim()}
        extra={
          <Textarea
            placeholder={t("common.reason")}
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
        }
        onConfirm={confirmReverse}
      />
    </DetailSection>
  );
}

function ManualAllocateDialog({
  open,
  onOpenChange,
  opportunity,
  onAllocated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: InvestmentOpportunityRow;
  onAllocated: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [opportunityProductId, setOpportunityProductId] = useState("");
  const [storeOrderItemId, setStoreOrderItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!opportunityProductId || !storeOrderItemId || !quantity || !reason.trim()) return;
    setIsSaving(true);
    try {
      await investmentSalesService.manualAllocate({
        opportunityProductId,
        storeOrderItemId,
        quantity: Number(quantity),
        reason: reason.trim(),
      });
      toast.success(t("common.saved"));
      setOpportunityProductId("");
      setStoreOrderItemId("");
      setQuantity("");
      setReason("");
      onOpenChange(false);
      await onAllocated();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("investors.sales.actions.manualAllocate")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <Select value={opportunityProductId} onValueChange={setOpportunityProductId}>
          <SelectTrigger className="w-full" aria-label={t("investors.sales.fields.product")}>
            <SelectValue placeholder={t("investors.opportunities.create.addProduct")} />
          </SelectTrigger>
          <SelectContent>
            {opportunity.products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.productName} ({p.productSku})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder={t("investors.sales.fields.storeOrderItemId")}
          aria-label={t("investors.sales.fields.storeOrderItemId")}
          dir="ltr"
          value={storeOrderItemId}
          onChange={(e) => setStoreOrderItemId(e.target.value)}
        />
        <Input
          type="number"
          min={1}
          step="1"
          placeholder={t("investors.sales.fields.allocatedQuantity")}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Textarea
          placeholder={t("common.reason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </EnterpriseModal>
  );
}

function ExpensesTab({
  opportunityId,
  canManage,
  canApprove,
}: {
  opportunityId: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { t } = useLocale();
  const [expenses, setExpenses] = useState<OpportunityExpenseRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await investmentExpensesService.list({ opportunityId, pageSize: 100 });
    setExpenses(result.items);
  }, [opportunityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runAction(action: () => Promise<unknown>) {
    try {
      await action();
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!expenses) return null;

  const columns: CompactDetailColumn<OpportunityExpenseRow>[] = [
    {
      id: "date",
      header: t("investors.expenses.fields.date"),
      cell: (e) => <span className="num">{formatDate(e.expenseDate)}</span>,
    },
    {
      id: "category",
      header: t("investors.expenses.fields.category"),
      cell: (e) => t(`investors.expenses.category.${e.category}` as MessageKey),
    },
    {
      id: "description",
      header: t("investors.expenses.fields.description"),
      cell: (e) => <span className={tableIdentityCellClass}>{e.description}</span>,
      footer: t("reports.finance.totals"),
    },
    {
      id: "amount",
      header: t("investors.expenses.fields.amount"),
      align: "end",
      cell: (e) => <Amount value={e.amount} />,
      footer: (
        <Amount
          value={expenses
            .filter((e) => e.status === "APPROVED")
            .reduce((sum, e) => sum + e.amount, 0)}
        />
      ),
    },
    {
      id: "status",
      header: t("investors.expenses.fields.status"),
      cell: (e) => (
        <StatusBadge
          label={t(`investors.expenses.status.${e.status}` as MessageKey)}
          tone={e.status === "APPROVED" ? "success" : "neutral"}
        />
      ),
      footer: (
        <span className="text-caption font-normal text-muted-foreground">
          {t("investors.expenses.approvedOnly")}
        </span>
      ),
    },
    ...(canApprove
      ? [
          {
            id: "actions",
            header: t("common.actions"),
            cell: (expense: OpportunityExpenseRow) =>
              expense.status === "DRAFT" ? (
                <div className="flex gap-1">
                  <EnterpriseButton
                    size="sm"
                    variant="outline"
                    onClick={() => runAction(() => investmentExpensesService.approve(expense.id))}
                  >
                    {t("investors.expenses.actions.approve")}
                  </EnterpriseButton>
                  <EnterpriseButton
                    size="sm"
                    variant="ghost"
                    onClick={() => runAction(() => investmentExpensesService.reject(expense.id))}
                  >
                    {t("investors.expenses.actions.reject")}
                  </EnterpriseButton>
                </div>
              ) : expense.status === "APPROVED" ? (
                <EnterpriseButton
                  size="sm"
                  variant="ghost"
                  onClick={() => runAction(() => investmentExpensesService.void(expense.id))}
                >
                  {t("investors.expenses.actions.void")}
                </EnterpriseButton>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <DetailSection
      actions={
        canManage ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            {t("investors.expenses.addNew")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {expenses.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("common.noDataAvailable")} />
      ) : (
        <CompactDetailTable columns={columns} rows={expenses} rowKey={(e) => e.id} />
      )}

      <AddExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        opportunityId={opportunityId}
        onAdded={load}
      />
    </DetailSection>
  );
}

const EXPENSE_CATEGORIES: OpportunityExpenseCategory[] = [
  "ADVERTISING",
  "SHIPPING",
  "STORAGE",
  "PAYMENT_FEES",
  "RETURNS",
  "OTHER",
];

function AddExpenseDialog({
  open,
  onOpenChange,
  opportunityId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityId: string;
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [expenseDate, setExpenseDate] = useState(() => toISODate(new Date()));
  const [category, setCategory] = useState<OpportunityExpenseCategory>("OTHER");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function submit() {
    if (!description.trim() || !amount) return;
    setIsSaving(true);
    try {
      await investmentExpensesService.create({
        opportunityId,
        expenseDate,
        category,
        description: description.trim(),
        amount: Number(amount),
      });
      toast.success(t("common.saved"));
      setDescription("");
      setAmount("");
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t("investors.expenses.addNew")}
      footer={(requestClose) => (
        <>
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={() => void submit()} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <EnterpriseDatePicker
          value={fromISODate(expenseDate)}
          onChange={(next) => setExpenseDate(next ? toISODate(next) : "")}
        />
        <Select
          value={category}
          onValueChange={(value) => setCategory(value as OpportunityExpenseCategory)}
        >
          <SelectTrigger className="w-full" aria-label={t("investors.expenses.fields.category")}>
            <SelectValue placeholder={t("investors.expenses.fields.category")} />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`investors.expenses.category.${value}` as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder={t("investors.expenses.fields.description")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          type="number"
          min={0.01}
          step="0.01"
          placeholder={t("investors.expenses.fields.amount")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
    </EnterpriseModal>
  );
}

function ProfitTab({
  opportunityId,
  canCalculate,
  canApprove,
}: {
  opportunityId: string;
  canCalculate: boolean;
  canApprove: boolean;
}) {
  const { t } = useLocale();
  const [estimate, setEstimate] = useState<ProfitBreakdown | null>(null);
  const [calculations, setCalculations] = useState<ProfitCalculationRow[] | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const load = useCallback(async () => {
    const [estimateResult, listResult] = await Promise.all([
      investmentProfitService.estimate(opportunityId),
      investmentProfitService.list(opportunityId),
    ]);
    setEstimate(estimateResult);
    setCalculations(listResult);
  }, [opportunityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function calculate() {
    setIsWorking(true);
    try {
      await investmentProfitService.calculate(opportunityId);
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsWorking(false);
    }
  }

  async function approve(id: string) {
    try {
      await investmentProfitService.approve(id);
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!estimate || !calculations) return null;

  const hasApproved = calculations.some((c) => c.status === "APPROVED");

  const waterfallLine = (
    id: string,
    labelKey: MessageKey,
    amount: number,
    kind: FinancialReportLine["kind"] = "posting",
  ): FinancialReportLine => ({
    // Namespaced so a line never picks up a shared report section label by id.
    id: `profit-waterfall:${id}`,
    parentId: null,
    kind,
    level: 0,
    label: t(labelKey),
    labelEn: t(labelKey),
    expandable: false,
    values: { amount },
    children: [],
  });
  const waterfall: FinancialReportLine[] = [
    waterfallLine("revenue", "investors.profit.waterfall.revenue", estimate.revenue),
    waterfallLine("cogs", "investors.profit.waterfall.cogs", estimate.cogs),
    waterfallLine("expenses", "investors.profit.waterfall.expenses", estimate.expenses),
    waterfallLine(
      "returnsAdjustment",
      "investors.profit.waterfall.returnsAdjustment",
      estimate.returnsAdjustment,
    ),
    waterfallLine(
      "netProfit",
      "investors.profit.waterfall.netProfit",
      estimate.netProfit,
      "subtotal",
    ),
    waterfallLine(
      "investorProfitPool",
      "investors.profit.waterfall.investorProfitPool",
      estimate.investorProfitPool,
    ),
    waterfallLine(
      "companyProfitPortion",
      "investors.profit.waterfall.companyProfitPortion",
      estimate.companyProfitPortion,
    ),
  ];

  const shareColumns: CompactDetailColumn<ProfitBreakdown["investorShares"][number]>[] = [
    {
      id: "investor",
      header: t("investors.profit.shares.investor"),
      cell: (share) => <span className={tableIdentityCellClass}>{share.investorName}</span>,
    },
    {
      id: "participation",
      header: t("investors.profit.shares.participationPercent"),
      align: "end",
      cell: (share) => <Percent value={share.participationPercent} />,
    },
    {
      id: "amount",
      header: t("investors.profit.shares.profitShareAmount"),
      align: "end",
      cell: (share) => <Amount value={share.profitShareAmount} />,
    },
  ];

  const calculationColumns: CompactDetailColumn<ProfitCalculationRow>[] = [
    {
      id: "status",
      header: t("investors.opportunities.fields.status"),
      cell: (calc) => (
        <StatusBadge
          label={t(`investors.profit.status.${calc.status}` as MessageKey)}
          tone={calc.status === "APPROVED" ? "success" : "neutral"}
        />
      ),
    },
    {
      id: "netProfit",
      header: t("investors.profit.waterfall.netProfit"),
      align: "end",
      cell: (calc) => <Amount value={calc.netProfit} />,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: (calc) =>
        canApprove && calc.status === "ESTIMATED" ? (
          <EnterpriseButton size="sm" variant="outline" onClick={() => approve(calc.id)}>
            {t("investors.profit.actions.approve")}
          </EnterpriseButton>
        ) : null,
    },
  ];

  return (
    <DetailSection
      actions={
        canCalculate && !hasApproved ? (
          <EnterpriseButton type="button" size="sm" onClick={calculate} disabled={isWorking}>
            {t("investors.profit.actions.calculate")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {!hasApproved ? (
        <p className="mb-3 text-caption text-muted-foreground">
          {t("investors.profit.noCalculation")}
        </p>
      ) : null}
      <div className="mb-4 overflow-hidden rounded-md border border-border bg-card">
        <FinancialReportView
          lines={waterfall}
          columns={WATERFALL_COLUMNS}
          expanded={NO_EXPANDED}
          onToggle={() => undefined}
          nameHeaderKey="investors.profit.waterfall.title"
          emptyLabel={t("common.noDataAvailable")}
        />
      </div>

      <CompactDetailTable
        columns={shareColumns}
        rows={estimate.investorShares}
        rowKey={(share) => share.investorId}
        empty={t("common.noDataAvailable")}
      />

      {calculations.length > 0 ? (
        <CompactDetailTable
          className="mt-4"
          columns={calculationColumns}
          rows={calculations}
          rowKey={(calc) => calc.id}
        />
      ) : null}
    </DetailSection>
  );
}

function SettlementTab({
  opportunity,
  canManage,
  canApprove,
  canCancel,
}: {
  opportunity: InvestmentOpportunityRow;
  canManage: boolean;
  canApprove: boolean;
  canCancel: boolean;
}) {
  const { t } = useLocale();
  const [settlements, setSettlements] = useState<OpportunitySettlementRow[] | null>(null);
  const [suggestions, setSuggestions] = useState<SettlementSuggestionLine[] | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [unresolvedReason, setUnresolvedReason] = useState("");

  const load = useCallback(async () => {
    const result = await investmentSettlementService.list(opportunity.id);
    setSettlements(result);
  }, [opportunity.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const active = settlements?.find(
    (s) => s.status === "DRAFT" || s.status === "REVIEW" || s.status === "APPROVED",
  );

  const loadSuggestions = useCallback(async () => {
    if (!active) {
      setSuggestions(null);
      return;
    }
    const result = await investmentSettlementService.suggestions(active.id);
    setSuggestions(result);
  }, [active]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSuggestions();
  }, [loadSuggestions]);

  async function runAction(action: () => Promise<unknown>) {
    try {
      await action();
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!settlements) return null;

  const suggestionColumns: CompactDetailColumn<SettlementSuggestionLine>[] = [
    {
      id: "product",
      header: t("investors.settlement.suggestions.product"),
      cell: (line) => <span className={tableIdentityCellClass}>{line.productName}</span>,
    },
    {
      id: "order",
      header: t("investors.settlement.suggestions.order"),
      cell: (line) => <span className="num">{line.orderNumber}</span>,
    },
    {
      id: "available",
      header: t("investors.settlement.suggestions.available"),
      align: "end",
      cell: (line) => <span className="num">{line.availableQuantity}</span>,
    },
    {
      id: "suggested",
      header: t("investors.settlement.suggestions.suggested"),
      align: "end",
      cell: (line) => <span className="num">{line.suggestedQuantity}</span>,
    },
    {
      id: "revenue",
      header: t("investors.settlement.suggestions.revenue"),
      align: "end",
      cell: (line) => <Amount value={line.estimatedRevenue} />,
    },
  ];

  return (
    <DetailSection
      actions={
        canManage && !active && opportunity.status === "ENDED" ? (
          <EnterpriseButton
            type="button"
            size="sm"
            onClick={() => runAction(() => investmentSettlementService.start(opportunity.id))}
          >
            {t("investors.settlement.actions.start")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {!active ? (
        <EmptyState icon={CheckCircle2} title={t("investors.settlement.none")} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge
              label={t(`investors.settlement.status.${active.status}` as MessageKey)}
              tone={active.status === "APPROVED" ? "success" : "neutral"}
            />
            <div className="flex gap-2">
              {canManage && active.status === "DRAFT" ? (
                <EnterpriseButton
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    runAction(() => investmentSettlementService.moveToReview(active.id))
                  }
                >
                  {t("investors.settlement.actions.moveToReview")}
                </EnterpriseButton>
              ) : null}
              {canApprove && active.status === "REVIEW" ? (
                <EnterpriseButton
                  size="sm"
                  onClick={() => runAction(() => investmentSettlementService.approve(active.id))}
                >
                  {t("investors.settlement.actions.approve")}
                </EnterpriseButton>
              ) : null}
              {canApprove && active.status === "APPROVED" ? (
                <EnterpriseButton size="sm" onClick={() => setCompleteOpen(true)}>
                  {t("investors.settlement.actions.complete")}
                </EnterpriseButton>
              ) : null}
              {canCancel && active.status !== "APPROVED" ? (
                <EnterpriseButton
                  size="sm"
                  variant="ghost"
                  onClick={() => runAction(() => investmentSettlementService.cancel(active.id))}
                >
                  {t("investors.settlement.actions.cancel")}
                </EnterpriseButton>
              ) : null}
            </div>
          </div>

          <div>
            <p className="mb-2 text-caption font-medium text-muted-foreground">
              {t("investors.settlement.suggestions.title")}
            </p>
            {!suggestions || suggestions.length === 0 ? (
              <EmptyState icon={CheckCircle2} title={t("investors.settlement.suggestions.none")} />
            ) : (
              <CompactDetailTable
                columns={suggestionColumns}
                rows={suggestions}
                rowKey={(line) => line.storeOrderItemId}
              />
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={completeOpen}
        onOpenChange={(next) => {
          setCompleteOpen(next);
          if (!next) setUnresolvedReason("");
        }}
        title={t("investors.settlement.completeDialog.title")}
        confirmDisabled={!unresolvedReason.trim()}
        extra={
          <Textarea
            placeholder={t("investors.settlement.completeDialog.reasonPlaceholder")}
            value={unresolvedReason}
            onChange={(e) => setUnresolvedReason(e.target.value)}
          />
        }
        onConfirm={() => {
          if (!active) return;
          setCompleteOpen(false);
          runAction(() =>
            investmentSettlementService.complete(active.id, {
              acceptUnresolved: true,
              unresolvedReason: unresolvedReason.trim(),
            }),
          );
          setUnresolvedReason("");
        }}
      />
    </DetailSection>
  );
}
