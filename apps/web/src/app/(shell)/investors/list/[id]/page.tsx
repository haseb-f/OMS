"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Banknote, Briefcase, CheckCircle2, Pencil, RotateCcw } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import {
  MasterDataForm,
  type MasterDataFormField,
} from "@/components/master-data/master-data-form";
import { EntityTabs } from "@/components/business/entity-tabs";
import { AuditTimeline, type TimelineEntry } from "@/components/business/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { investorsService, type InvestorRow } from "@/services/investors-service";
import {
  investorSubscriptionsService,
  type InvestorSubscriptionRow,
} from "@/services/investor-subscriptions-service";
import {
  capitalContributionsService,
  type CapitalContributionRow,
} from "@/services/capital-contributions-service";
import type { MasterDataActivityEntry } from "@/services/master-data-service";
import {
  investorLedgerService,
  type InvestorFinancialSummary,
} from "@/services/investor-ledger-service";
import { ProfitsTab, StatementTab } from "./investor-ledger-tabs";
import { CapitalReturnsSection } from "./capital-returns-section";
import { investorSchema, investorDefaultValues } from "@/config/investors/investors";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";

const editFields: MasterDataFormField[] = [
  { name: "name", label: "investors.list.fields.name", type: "text", required: true },
  {
    name: "entityType",
    label: "investors.list.fields.entityType",
    type: "select",
    options: [
      { value: "PERSON", label: "PERSON" },
      { value: "ORGANIZATION", label: "ORGANIZATION" },
    ],
  },
  { name: "phone", label: "investors.list.fields.phone", type: "text" },
  { name: "email", label: "investors.list.fields.email", type: "text" },
  {
    name: "status",
    label: "investors.list.fields.status",
    type: "select",
    options: [
      { value: "ACTIVE", label: "ACTIVE" },
      { value: "INACTIVE", label: "INACTIVE" },
    ],
  },
  {
    name: "commercialRegistration",
    label: "investors.list.fields.commercialRegistration",
    type: "text",
  },
  { name: "nationalId", label: "investors.list.fields.nationalId", type: "text" },
  { name: "residencyId", label: "investors.list.fields.residencyId", type: "text" },
  { name: "iban", label: "investors.list.fields.iban", type: "text" },
  { name: "notes", label: "investors.list.fields.notes", type: "textarea" },
];

export default function InvestorProfilePage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("investors.edit");
  const canArchive = hasPermission("investors.archive");
  const canCreateReturn = hasPermission("capital-returns.create");
  const canApproveReturn = hasPermission("capital-returns.approve");
  const canPayReturn = hasPermission("capital-returns.pay");
  const canCancelReturn = hasPermission("capital-returns.cancel");

  const [investor, setInvestor] = useState<InvestorRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [subscriptions, setSubscriptions] = useState<InvestorSubscriptionRow[] | null>(null);
  const [contributions, setContributions] = useState<CapitalContributionRow[] | null>(null);
  const [activity, setActivity] = useState<MasterDataActivityEntry[] | null>(null);
  const [ledgerSummary, setLedgerSummary] = useState<InvestorFinancialSummary | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const editForm = useForm({
    resolver: zodResolver(investorSchema),
    defaultValues: investorDefaultValues,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investorsService.get(params.id);
      setInvestor(data);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    investorLedgerService.summary(params.id).then(setLedgerSummary);
  }, [params.id]);

  useBreadcrumbLabel(investor?.name ?? null);

  const loadSubscriptions = useCallback(async () => {
    const result = await investorSubscriptionsService.list({
      investorId: params.id,
      pageSize: 100,
    });
    setSubscriptions(result.items);
  }, [params.id]);

  const loadContributions = useCallback(async () => {
    const result = await capitalContributionsService.list({ investorId: params.id, pageSize: 100 });
    setContributions(result.items);
  }, [params.id]);

  const loadActivity = useCallback(async () => {
    const entries = await investorsService.activity(params.id);
    setActivity(entries);
  }, [params.id]);

  function openEdit() {
    if (!investor) return;
    editForm.reset({
      name: investor.name,
      entityType: investor.entityType,
      phone: investor.phone ?? "",
      email: investor.email ?? "",
      commercialRegistration: investor.commercialRegistration ?? "",
      nationalId: investor.nationalId ?? "",
      residencyId: investor.residencyId ?? "",
      iban: investor.iban ?? "",
      notes: investor.notes ?? "",
      status: investor.status,
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    const values = editForm.getValues();
    setIsSaving(true);
    try {
      await investorsService.update(params.id, values);
      toast.success(t("common.saved"));
      setEditOpen(false);
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmArchive() {
    try {
      if (investor?.deletedAt) {
        await investorsService.restore(params.id);
      } else {
        await investorsService.archive(params.id);
      }
      setArchiveOpen(false);
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (isLoading || !investor) {
    return null;
  }

  return (
    <>
      <DetailWorkspace
        title={investor.name}
        subtitle={investor.email ?? investor.phone ?? undefined}
        status={
          <StatusBadge
            label={t(`investors.list.status.${investor.status}` as MessageKey)}
            tone={investor.status === "ACTIVE" ? "success" : "neutral"}
          />
        }
        actions={
          <>
            {canEdit ? (
              <EnterpriseButton variant="secondary" onClick={openEdit}>
                <Pencil />
                {t("common.edit")}
              </EnterpriseButton>
            ) : null}
            {canArchive ? (
              <EnterpriseButton variant="ghost" onClick={() => setArchiveOpen(true)}>
                {investor.deletedAt ? <RotateCcw /> : <Archive />}
                {investor.deletedAt ? t("common.restore") : t("common.archive")}
              </EnterpriseButton>
            ) : null}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <KpiCard
            icon={Banknote}
            label={t("investors.ledger.summary.totalConfirmedCapital")}
            value={formatMoney(
              ledgerSummary?.totalConfirmedCapital ?? investor.totalConfirmedFunding,
            )}
          />
          <KpiCard
            icon={Banknote}
            label={t("investors.ledger.summary.capitalReturned")}
            value={formatMoney(ledgerSummary?.capitalReturned ?? 0)}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.ledger.summary.totalApprovedProfit")}
            value={formatMoney(ledgerSummary?.totalApprovedProfit ?? 0)}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.ledger.summary.totalProfitPaid")}
            value={formatMoney(ledgerSummary?.totalProfitPaid ?? 0)}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.ledger.summary.outstandingProfit")}
            value={formatMoney(ledgerSummary?.outstandingProfit ?? 0)}
          />
          <KpiCard
            icon={Briefcase}
            label={t("investors.profile.summary.activeOpportunities")}
            value={investor.activeInvestmentsCount}
          />
          <KpiCard
            icon={CheckCircle2}
            label={t("investors.profile.summary.completedOpportunities")}
            value={investor.completedInvestmentsCount}
          />
        </div>

        <EntityTabs
          tabs={[
            {
              value: "overview",
              label: t("investors.profile.tabs.overview"),
              content: (
                <DetailSection>
                  <DetailFieldGrid columns={3}>
                    <DetailField
                      label={t("investors.list.fields.entityType")}
                      value={t(`investors.list.entityType.${investor.entityType}` as MessageKey)}
                    />
                    <DetailField label={t("investors.list.fields.phone")} value={investor.phone} />
                    <DetailField label={t("investors.list.fields.email")} value={investor.email} />
                    <DetailField
                      label={t("investors.list.fields.commercialRegistration")}
                      value={investor.commercialRegistration}
                    />
                    <DetailField
                      label={t("investors.list.fields.nationalId")}
                      value={investor.nationalId}
                    />
                    <DetailField
                      label={t("investors.list.fields.residencyId")}
                      value={investor.residencyId}
                    />
                    <DetailField label={t("investors.list.fields.iban")} value={investor.iban} />
                    <DetailField label={t("investors.list.fields.notes")} value={investor.notes} />
                  </DetailFieldGrid>
                </DetailSection>
              ),
            },
            {
              value: "investments",
              label: t("investors.profile.tabs.investments"),
              content: <InvestmentsTab subscriptions={subscriptions} onLoad={loadSubscriptions} />,
            },
            {
              value: "funding",
              label: t("investors.profile.tabs.funding"),
              content: (
                <FundingTab
                  contributions={contributions}
                  onLoad={loadContributions}
                  investorId={params.id}
                  subscriptions={subscriptions ?? []}
                  onLoadSubscriptions={loadSubscriptions}
                  canCreateReturn={canCreateReturn}
                  canApproveReturn={canApproveReturn}
                  canPayReturn={canPayReturn}
                  canCancelReturn={canCancelReturn}
                />
              ),
            },
            {
              value: "profits",
              label: t("investors.profile.tabs.profits"),
              content: <ProfitsTab investorId={params.id} />,
            },
            {
              value: "statement",
              label: t("investors.profile.tabs.statement"),
              content: <StatementTab investorId={params.id} />,
            },
            {
              value: "activity",
              label: t("investors.profile.tabs.activity"),
              content: <ActivityTab activity={activity} onLoad={loadActivity} />,
            },
          ]}
        />
      </DetailWorkspace>

      <EnterpriseModal
        open={editOpen}
        onOpenChange={setEditOpen}
        size="md"
        title={t("common.edit")}
        description={investor.name}
        isDirty={editForm.formState.isDirty}
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
            <EnterpriseButton type="button" onClick={() => void saveEdit()} disabled={isSaving}>
              {t("common.save")}
            </EnterpriseButton>
          </>
        )}
      >
        <MasterDataForm
          form={editForm}
          fields={editFields}
          sectionTitle={t("investors.list.title")}
        />
      </EnterpriseModal>

      <ConfirmationDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={investor.deletedAt ? t("common.restore") : t("common.archive")}
        description={investor.name}
        onConfirm={confirmArchive}
        tone={investor.deletedAt ? undefined : "destructive"}
      />
    </>
  );
}

function InvestmentsTab({
  subscriptions,
  onLoad,
}: {
  subscriptions: InvestorSubscriptionRow[] | null;
  onLoad: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!subscriptions) return null;
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title={t("investors.opportunities.title")}
        description={t("common.noDataAvailable")}
      />
    );
  }
  return (
    <DetailSection>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-body">
          <thead>
            <tr className="border-b border-border text-caption text-muted-foreground">
              <th className="p-2 text-start">{t("investors.opportunities.fields.code")}</th>
              <th className="p-2 text-start">
                {t("investors.subscriptions.fields.committedAmount")}
              </th>
              <th className="p-2 text-start">{t("investors.subscriptions.fields.fundedAmount")}</th>
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
                  <a
                    href={`/investors/opportunities/${s.opportunityId}`}
                    className="hover:underline"
                  >
                    {s.opportunityCode} — {s.opportunityName}
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
    </DetailSection>
  );
}

function FundingTab({
  contributions,
  onLoad,
  investorId,
  subscriptions,
  onLoadSubscriptions,
  canCreateReturn,
  canApproveReturn,
  canPayReturn,
  canCancelReturn,
}: {
  contributions: CapitalContributionRow[] | null;
  onLoad: () => void;
  investorId: string;
  subscriptions: InvestorSubscriptionRow[];
  onLoadSubscriptions: () => void;
  canCreateReturn: boolean;
  canApproveReturn: boolean;
  canPayReturn: boolean;
  canCancelReturn: boolean;
}) {
  const { t } = useLocale();
  useEffect(() => {
    onLoad();
    onLoadSubscriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DetailSection>
      {!contributions ? null : contributions.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title={t("investors.contributions.addNew")}
          description={t("common.noDataAvailable")}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.opportunities.fields.code")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.date")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.amount")}</th>
                <th className="p-2 text-start">{t("investors.contributions.fields.status")}</th>
                <th className="p-2 text-start">
                  {t("investors.contributions.fields.confirmedBy")}
                </th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">{c.opportunityCode}</td>
                  <td className="p-2">{formatDate(c.contributionDate)}</td>
                  <td className="p-2">{formatMoney(c.amount)}</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.contributions.status.${c.status}` as MessageKey)}
                      tone="neutral"
                    />
                  </td>
                  <td className="p-2">{c.confirmedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CapitalReturnsSection
        investorId={investorId}
        subscriptions={subscriptions}
        canCreate={canCreateReturn}
        canApprove={canApproveReturn}
        canPay={canPayReturn}
        canCancel={canCancelReturn}
      />
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
