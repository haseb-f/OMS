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
