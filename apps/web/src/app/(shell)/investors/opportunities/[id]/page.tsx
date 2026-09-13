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
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
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
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

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
    load();
  }, [load]);

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
        subtitle={opportunity.code}
        status={
          <StatusBadge
            label={t(`investors.opportunities.status.${opportunity.status}` as MessageKey)}
            tone={statusTone[opportunity.status]}
          />
        }
        actions={
          <>
            {canManage && opportunity.status === "DRAFT" ? (
              <EnterpriseButton
                variant="secondary"
                onClick={() => runAction(() => investmentOpportunitiesService.open(opportunity.id))}
              >
                <DoorOpen />
                {t("investors.opportunities.actions.open")}
              </EnterpriseButton>
            ) : null}
            {canManage && (opportunity.status === "OPEN" || opportunity.status === "FUNDED") ? (
              <EnterpriseButton
                variant="secondary"
                onClick={() =>
                  runAction(() => investmentOpportunitiesService.activate(opportunity.id))
                }
              >
                <CirclePlay />
                {t("investors.opportunities.actions.activate")}
              </EnterpriseButton>
            ) : null}
            {canManage && opportunity.status === "ACTIVE" ? (
              <EnterpriseButton
                variant="secondary"
                onClick={() => runAction(() => investmentOpportunitiesService.end(opportunity.id))}
              >
                <StopCircle />
                {t("investors.opportunities.actions.end")}
              </EnterpriseButton>
            ) : null}
            {canManage && opportunity.status === "SETTLED" ? (
              <EnterpriseButton
                variant="secondary"
                onClick={() =>
                  runAction(() => investmentOpportunitiesService.close(opportunity.id))
                }
              >
                <ArchiveIcon />
                {t("investors.opportunities.actions.close")}
              </EnterpriseButton>
            ) : null}
            {canCancel && ["DRAFT", "OPEN", "FUNDED"].includes(opportunity.status) ? (
              <EnterpriseButton variant="ghost" onClick={() => setCancelOpen(true)}>
                <Ban />
                {t("investors.opportunities.actions.cancel")}
              </EnterpriseButton>
            ) : null}
            {canArchive && ["DRAFT", "CANCELLED", "CLOSED"].includes(opportunity.status) ? (
              <EnterpriseButton variant="ghost" onClick={() => setArchiveOpen(true)}>
                <ArchiveIcon />
                {t("investors.opportunities.actions.archive")}
              </EnterpriseButton>
            ) : null}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.opportunities.fields.targetCapital")}
            value={formatMoney(opportunity.targetCapital, opportunity.currency.code)}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.opportunities.fields.confirmedFundedCapital")}
            value={formatMoney(opportunity.confirmedFundedCapital, opportunity.currency.code)}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.opportunities.fields.fundingPercent")}
            value={`${opportunity.fundingPercent.toFixed(0)}%`}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.opportunities.fields.investorsCount")}
            value={opportunity.investorsCount}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.opportunities.overview.daysRemaining")}
            value={
              opportunity.isPastEndDate
                ? t("investors.opportunities.overview.ended")
                : opportunity.daysRemaining
            }
          />
        </div>

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
                      value={`${opportunity.investorNetProfitSharePercent}%`}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.startDate")}
                      value={formatDate(opportunity.startDate)}
                    />
                    <DetailField
                      label={t("investors.opportunities.fields.endDate")}
                      value={formatDate(opportunity.endDate)}
                    />
                    <DetailField
                      label={t("investors.opportunities.overview.totalFundedUnits")}
                      value={opportunity.totalFundedUnits}
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
                  currencyCode={opportunity.currency.code}
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
                  currencyCode={opportunity.currency.code}
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
    return <EmptyState icon={CheckCircle2} title="—" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-body">
        <thead>
          <tr className="border-b border-border text-caption text-muted-foreground">
            <th className="p-2 text-start">{t("investors.opportunities.create.addProduct")}</th>
            <th className="p-2 text-start">{t("investors.opportunities.create.fundedUnits")}</th>
            <th className="p-2 text-start">{t("investors.opportunities.create.fundedUnitCost")}</th>
            <th className="p-2 text-start">{t("investors.opportunities.create.lineCapital")}</th>
          </tr>
        </thead>
        <tbody>
          {opportunity.products.map((p) => (
            <tr key={p.id} className="border-b border-border/60">
              <td className="p-2 font-medium">
                {p.productName}{" "}
                <span className="text-caption text-muted-foreground">({p.productSku})</span>
              </td>
              <td className="p-2">{p.fundedUnits}</td>
              <td className="p-2">{formatMoney(p.fundedUnitCost, opportunity.currency.code)}</td>
              <td className="p-2">{formatMoney(p.fundedCapital, opportunity.currency.code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
        <EmptyState icon={CheckCircle2} title="—" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.subscriptions.fields.investor")}</th>
                <th className="p-2 text-start">
                  {t("investors.subscriptions.fields.committedAmount")}
                </th>
                <th className="p-2 text-start">
                  {t("investors.subscriptions.fields.fundedAmount")}
                </th>
                <th className="p-2 text-start">
                  {t("investors.subscriptions.fields.participationPercent")}
                </th>
                <th className="p-2 text-start">{t("investors.subscriptions.fields.status")}</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">
                    <a href={`/investors/list/${s.investorId}`} className="hover:underline">
                      {s.investorName}
                    </a>
                  </td>
                  <td className="p-2">{formatMoney(s.committedAmount)}</td>
                  <td className="p-2">{formatMoney(s.fundedAmount)}</td>
                  <td className="p-2">{s.participationPercent.toFixed(2)}%</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.subscriptions.status.${s.status}` as MessageKey)}
                      tone="neutral"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
        <EmptyState icon={CheckCircle2} title="—" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.contributions.fields.investor")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.date")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.amount")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.status")}</th>
                <th className="p-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">{c.investorName}</td>
                  <td className="p-2">{formatDate(c.contributionDate)}</td>
                  <td className="p-2">{formatMoney(c.amount)}</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.contributions.status.${c.status}` as MessageKey)}
                      tone="neutral"
                    />
                  </td>
                  <td className="p-2">
                    {c.status === "PENDING" ? (
                      <div className="flex gap-1">
                        {canConfirm ? (
                          <EnterpriseButton
                            size="sm"
                            variant="secondary"
                            onClick={() => confirm(c.id)}
                          >
                            {t("investors.opportunities.actions.confirm")}
                          </EnterpriseButton>
                        ) : null}
                        {canCancel ? (
                          <EnterpriseButton size="sm" variant="ghost" onClick={() => cancel(c.id)}>
                            {t("investors.opportunities.actions.reject")}
                          </EnterpriseButton>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          onSearch={(query) => investorsService.search(query)}
          getId={(row) => row.id}
          getTitle={(row) => row.name}
          getSubtitle={(row) => row.phone ?? row.email ?? undefined}
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
  const [contributionDate, setContributionDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
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
            `${formatMoney(row.committedAmount)} / ${formatMoney(row.fundedAmount)}`
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
        <Input
          type="date"
          value={contributionDate}
          onChange={(e) => setContributionDate(e.target.value)}
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

  return (
    <DetailSection
      actions={
        canManage ? (
          <div className="flex gap-2">
            <EnterpriseButton
              type="button"
              size="sm"
              variant="secondary"
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
          icon={CheckCircle2}
          label={t("investors.sales.metrics.fundedUnits")}
          value={summary.totals.fundedUnits}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.sales.metrics.netSoldUnits")}
          value={summary.totals.netSoldUnits}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.sales.metrics.remainingUnits")}
          value={summary.totals.remainingUnits}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.sales.metrics.attributableRevenue")}
          value={formatMoney(summary.totals.attributableRevenue, opportunity.currency.code)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.sales.metrics.cogs")}
          value={formatMoney(summary.totals.cogs, opportunity.currency.code)}
        />
      </div>

      {allocations.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="—" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.sales.fields.product")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.order")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.customer")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.allocatedQuantity")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.allocatedRevenue")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.type")}</th>
                <th className="p-2 text-start">{t("investors.sales.fields.status")}</th>
                {canManage ? <th className="p-2 text-start">{t("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">
                    {a.productName}{" "}
                    <span className="text-caption text-muted-foreground">({a.productSku})</span>
                  </td>
                  <td className="p-2">{a.orderNumber}</td>
                  <td className="p-2">{a.customerName}</td>
                  <td className="p-2">{a.allocatedQuantity}</td>
                  <td className="p-2">
                    {formatMoney(a.allocatedRevenue, opportunity.currency.code)}
                  </td>
                  <td className="p-2">
                    {t(`investors.sales.type.${a.allocationType}` as MessageKey)}
                  </td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.sales.status.${a.status}` as MessageKey)}
                      tone={a.status === "ACTIVE" ? "success" : "neutral"}
                    />
                  </td>
                  {canManage ? (
                    <td className="p-2">
                      {a.status === "ACTIVE" ? (
                        <EnterpriseButton
                          size="sm"
                          variant="ghost"
                          onClick={() => setReverseTarget(a)}
                        >
                          {t("investors.sales.actions.reverse")}
                        </EnterpriseButton>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <SelectTrigger className="w-full">
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
          placeholder={t("investors.sales.fields.order") + " — Store Order Item ID"}
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
  currencyCode,
  canManage,
  canApprove,
}: {
  opportunityId: string;
  currencyCode: string;
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
        <EmptyState icon={CheckCircle2} title="—" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.expenses.fields.date")}</th>
                <th className="p-2 text-start">{t("investors.expenses.fields.category")}</th>
                <th className="p-2 text-start">{t("investors.expenses.fields.description")}</th>
                <th className="p-2 text-start">{t("investors.expenses.fields.amount")}</th>
                <th className="p-2 text-start">{t("investors.expenses.fields.status")}</th>
                {canApprove ? <th className="p-2 text-start">{t("common.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id} className="border-b border-border/60">
                  <td className="p-2">{formatDate(expense.expenseDate)}</td>
                  <td className="p-2">
                    {t(`investors.expenses.category.${expense.category}` as MessageKey)}
                  </td>
                  <td className="p-2 font-medium">{expense.description}</td>
                  <td className="p-2">{formatMoney(expense.amount, currencyCode)}</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.expenses.status.${expense.status}` as MessageKey)}
                      tone={expense.status === "APPROVED" ? "success" : "neutral"}
                    />
                  </td>
                  {canApprove ? (
                    <td className="p-2">
                      {expense.status === "DRAFT" ? (
                        <div className="flex gap-1">
                          <EnterpriseButton
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              runAction(() => investmentExpensesService.approve(expense.id))
                            }
                          >
                            {t("investors.expenses.actions.approve")}
                          </EnterpriseButton>
                          <EnterpriseButton
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              runAction(() => investmentExpensesService.reject(expense.id))
                            }
                          >
                            {t("investors.expenses.actions.reject")}
                          </EnterpriseButton>
                        </div>
                      ) : expense.status === "APPROVED" ? (
                        <EnterpriseButton
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            runAction(() => investmentExpensesService.void(expense.id))
                          }
                        >
                          {t("investors.expenses.actions.void")}
                        </EnterpriseButton>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
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
        <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        <Select
          value={category}
          onValueChange={(value) => setCategory(value as OpportunityExpenseCategory)}
        >
          <SelectTrigger className="w-full">
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
  currencyCode,
  canCalculate,
  canApprove,
}: {
  opportunityId: string;
  currencyCode: string;
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
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.revenue")}
          value={formatMoney(estimate.revenue, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.cogs")}
          value={formatMoney(estimate.cogs, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.expenses")}
          value={formatMoney(estimate.expenses, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.returnsAdjustment")}
          value={formatMoney(estimate.returnsAdjustment, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.netProfit")}
          value={formatMoney(estimate.netProfit, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.investorProfitPool")}
          value={formatMoney(estimate.investorProfitPool, currencyCode)}
        />
        <KpiCard
          icon={CheckCircle2}
          label={t("investors.profit.waterfall.companyProfitPortion")}
          value={formatMoney(estimate.companyProfitPortion, currencyCode)}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-body">
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th className="p-2 text-start">{t("investors.profit.shares.investor")}</th>
              <th className="p-2 text-start">
                {t("investors.profit.shares.participationPercent")}
              </th>
              <th className="p-2 text-start">{t("investors.profit.shares.profitShareAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {estimate.investorShares.map((share) => (
              <tr key={share.investorId} className="border-b border-border/60">
                <td className="p-2 font-medium">{share.investorName}</td>
                <td className="p-2">{share.participationPercent.toFixed(2)}%</td>
                <td className="p-2">{formatMoney(share.profitShareAmount, currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {calculations.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.opportunities.fields.status")}</th>
                <th className="p-2 text-start">{t("investors.profit.waterfall.netProfit")}</th>
                <th className="p-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {calculations.map((calc) => (
                <tr key={calc.id} className="border-b border-border/60">
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.profit.status.${calc.status}` as MessageKey)}
                      tone={calc.status === "APPROVED" ? "success" : "neutral"}
                    />
                  </td>
                  <td className="p-2">{formatMoney(calc.netProfit, currencyCode)}</td>
                  <td className="p-2">
                    {canApprove && calc.status === "ESTIMATED" ? (
                      <EnterpriseButton
                        size="sm"
                        variant="secondary"
                        onClick={() => approve(calc.id)}
                      >
                        {t("investors.profit.actions.approve")}
                      </EnterpriseButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <div className="flex items-center justify-between gap-2">
            <StatusBadge
              label={t(`investors.settlement.status.${active.status}` as MessageKey)}
              tone={active.status === "APPROVED" ? "success" : "neutral"}
            />
            <div className="flex gap-2">
              {canManage && active.status === "DRAFT" ? (
                <EnterpriseButton
                  size="sm"
                  variant="secondary"
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
              <div className="overflow-x-auto">
                <table className="w-full text-start text-body">
                  <thead>
                    <tr className="border-b border-border text-caption text-muted-foreground">
                      <th className="p-2 text-start">
                        {t("investors.settlement.suggestions.product")}
                      </th>
                      <th className="p-2 text-start">
                        {t("investors.settlement.suggestions.order")}
                      </th>
                      <th className="p-2 text-start">
                        {t("investors.settlement.suggestions.available")}
                      </th>
                      <th className="p-2 text-start">
                        {t("investors.settlement.suggestions.suggested")}
                      </th>
                      <th className="p-2 text-start">
                        {t("investors.settlement.suggestions.revenue")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((line) => (
                      <tr key={line.storeOrderItemId} className="border-b border-border/60">
                        <td className="p-2 font-medium">{line.productName}</td>
                        <td className="p-2">{line.orderNumber}</td>
                        <td className="p-2">{line.availableQuantity}</td>
                        <td className="p-2">{line.suggestedQuantity}</td>
                        <td className="p-2">
                          {formatMoney(line.estimatedRevenue, opportunity.currency.code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
