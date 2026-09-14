"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { CircleDollarSign, Wallet } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { AccountPicker } from "@/components/business/account-picker";
import { StatusBadge } from "@/components/business/status-badge";
import {
  investmentDistributionsService,
  type DistributionPreview,
  type ProfitDistributionRow,
  type InvestorDistributionRow,
} from "@/services/investment-distributions-service";
import {
  distributionPaymentsService,
  type DistributionPaymentRow,
} from "@/services/distribution-payments-service";
import {
  investmentProfitService,
  type ProfitCalculationRow,
} from "@/services/investment-profit-service";
import { usePaymentMethods } from "@/hooks/use-reference-data";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";

const DISTRIBUTION_TONE: Record<
  ProfitDistributionRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "destructive",
};

const INVESTOR_ROW_TONE: Record<
  InvestorDistributionRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  PENDING: "neutral",
  PAYABLE: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "destructive",
};

export function DistributionsTab({
  opportunityId,
  currencyCode,
  canCreate,
  canApprove,
  canCancel,
  canRecordPayment,
  canConfirmPayment,
  onChanged,
}: {
  opportunityId: string;
  currencyCode: string;
  canCreate: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canRecordPayment: boolean;
  canConfirmPayment: boolean;
  /** Notifies the parent Opportunity page to refresh its Financial Summary (Phase 17) after any mutation here. */
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const [distributions, setDistributions] = useState<ProfitDistributionRow[] | null>(null);
  const [approvedCalculation, setApprovedCalculation] = useState<ProfitCalculationRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ProfitDistributionRow | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<InvestorDistributionRow | null>(null);
  const [payments, setPayments] = useState<Record<string, DistributionPaymentRow[]>>({});

  const load = useCallback(async () => {
    const [list, calculations] = await Promise.all([
      investmentDistributionsService.list({ opportunityId, pageSize: 100 }),
      investmentProfitService.list(opportunityId),
    ]);
    setDistributions(list.items);
    setApprovedCalculation(calculations.find((c) => c.status === "APPROVED") ?? null);
  }, [opportunityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const loadPayments = useCallback(async (investorDistributionId: string) => {
    const result = await distributionPaymentsService.list({ investorDistributionId, pageSize: 50 });
    setPayments((prev) => ({ ...prev, [investorDistributionId]: result.items }));
  }, []);

  async function toggleExpand(distribution: ProfitDistributionRow) {
    if (expandedId === distribution.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(distribution.id);
    await Promise.all(distribution.investorDistributions.map((row) => loadPayments(row.id)));
  }

  async function approve(distribution: ProfitDistributionRow) {
    try {
      await investmentDistributionsService.approve(distribution.id);
      toast.success(t("common.saved"));
      await load();
      onChanged?.();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      await investmentDistributionsService.cancel(cancelTarget.id);
      toast.success(t("common.saved"));
      setCancelTarget(null);
      await load();
      onChanged?.();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  const alreadyDistributedCalcIds = new Set(
    (distributions ?? []).map((d) => d.profitCalculationId),
  );
  const hasUndistributedApproved =
    approvedCalculation != null && !alreadyDistributedCalcIds.has(approvedCalculation.id);

  if (!distributions) return null;

  return (
    <DetailSection
      actions={
        canCreate && hasUndistributedApproved ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setCreateOpen(true)}>
            {t("investors.distributions.actions.create")}
          </EnterpriseButton>
        ) : undefined
      }
    >
      {distributions.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("investors.distributions.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {distributions.map((distribution) => (
            <div key={distribution.id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="font-medium text-body underline-offset-2 hover:underline"
                    onClick={() => toggleExpand(distribution)}
                  >
                    {distribution.code}
                  </button>
                  <StatusBadge
                    label={t(`investors.distributions.status.${distribution.status}` as never)}
                    tone={DISTRIBUTION_TONE[distribution.status]}
                  />
                </div>
                <div className="flex items-center gap-4 text-caption">
                  <span>
                    {t("investors.distributions.fields.total")}:{" "}
                    <strong>{formatMoney(distribution.totalInvestorProfit, currencyCode)}</strong>
                  </span>
                  <span>
                    {t("investors.distributions.fields.paid")}:{" "}
                    <strong>{formatMoney(distribution.totalPaid, currencyCode)}</strong>
                  </span>
                  <span>
                    {t("investors.distributions.fields.outstanding")}:{" "}
                    <strong>{formatMoney(distribution.totalOutstanding, currencyCode)}</strong>
                  </span>
                  {canApprove && distribution.status === "DRAFT" ? (
                    <EnterpriseButton size="sm" onClick={() => approve(distribution)}>
                      {t("investors.distributions.actions.approve")}
                    </EnterpriseButton>
                  ) : null}
                  {canCancel &&
                  (distribution.status === "DRAFT" || distribution.status === "APPROVED") ? (
                    <EnterpriseButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setCancelTarget(distribution)}
                    >
                      {t("investors.distributions.actions.cancel")}
                    </EnterpriseButton>
                  ) : null}
                </div>
              </div>

              {expandedId === distribution.id ? (
                <div className="border-t border-border p-3">
                  <table className="w-full text-start text-body">
                    <thead>
                      <tr className="border-b border-border text-caption text-muted-foreground">
                        <th className="p-2 text-start">
                          {t("investors.distributions.fields.investor")}
                        </th>
                        <th className="p-2 text-start">
                          {t("investors.distributions.fields.entitled")}
                        </th>
                        <th className="p-2 text-start">
                          {t("investors.distributions.fields.paid")}
                        </th>
                        <th className="p-2 text-start">
                          {t("investors.distributions.fields.outstanding")}
                        </th>
                        <th className="p-2 text-start">
                          {t("investors.opportunities.fields.status")}
                        </th>
                        <th className="p-2 text-start">{t("common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distribution.investorDistributions.map((row) => (
                        <Fragment key={row.id}>
                          <tr className="border-b border-border/60">
                            <td className="p-2 font-medium">{row.investorName}</td>
                            <td className="p-2">{formatMoney(row.entitledAmount, currencyCode)}</td>
                            <td className="p-2">{formatMoney(row.paidAmount, currencyCode)}</td>
                            <td className="p-2">
                              {formatMoney(row.outstandingAmount, currencyCode)}
                            </td>
                            <td className="p-2">
                              <StatusBadge
                                label={t(
                                  `investors.distributions.investorStatus.${row.status}` as never,
                                )}
                                tone={INVESTOR_ROW_TONE[row.status]}
                              />
                            </td>
                            <td className="p-2">
                              {canRecordPayment && row.outstandingAmount > 0 ? (
                                <EnterpriseButton
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setPaymentTarget(row)}
                                >
                                  {t("investors.distributions.actions.recordPayment")}
                                </EnterpriseButton>
                              ) : null}
                            </td>
                          </tr>
                          {(payments[row.id]?.length ?? 0) > 0 ? (
                            <tr
                              key={`${row.id}-payments`}
                              className="border-b border-border/60 bg-muted/30"
                            >
                              <td colSpan={6} className="p-2">
                                <div className="flex flex-col gap-1 ps-4">
                                  {payments[row.id]!.map((payment) => (
                                    <div
                                      key={payment.id}
                                      className="flex items-center justify-between text-caption"
                                    >
                                      <span>
                                        {formatDate(payment.paymentDate)} —{" "}
                                        {formatMoney(payment.amount, currencyCode)}
                                        {payment.referenceNumber
                                          ? ` (${payment.referenceNumber})`
                                          : ""}
                                      </span>
                                      <StatusBadge
                                        label={t(
                                          `investors.distributions.paymentStatus.${payment.status}` as never,
                                        )}
                                        tone={
                                          payment.status === "CONFIRMED"
                                            ? "success"
                                            : payment.status === "PENDING"
                                              ? "warning"
                                              : "destructive"
                                        }
                                      />
                                      {canConfirmPayment && payment.status === "PENDING" ? (
                                        <EnterpriseButton
                                          size="sm"
                                          onClick={async () => {
                                            try {
                                              await distributionPaymentsService.confirm(payment.id);
                                              toast.success(t("common.saved"));
                                              await loadPayments(row.id);
                                              await load();
                                              onChanged?.();
                                            } catch (error) {
                                              reportApiError(error, t("common.failedToSave"));
                                            }
                                          }}
                                        >
                                          {t("investors.distributions.actions.confirmPayment")}
                                        </EnterpriseButton>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {createOpen && approvedCalculation ? (
        <CreateDistributionDialog
          profitCalculationId={approvedCalculation.id}
          currencyCode={currencyCode}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => {
            setCreateOpen(false);
            await load();
          }}
        />
      ) : null}

      {paymentTarget ? (
        <RecordPaymentDialog
          investorDistribution={paymentTarget}
          currencyCode={currencyCode}
          open={paymentTarget != null}
          onOpenChange={(open) => !open && setPaymentTarget(null)}
          onRecorded={async () => {
            const id = paymentTarget.id;
            setPaymentTarget(null);
            await loadPayments(id);
            await load();
          }}
        />
      ) : null}

      <ConfirmationDialog
        open={cancelTarget != null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={t("investors.distributions.confirmCancel.title")}
        description={t("investors.distributions.confirmCancel.description")}
        onConfirm={confirmCancel}
        tone="destructive"
      />
    </DetailSection>
  );
}

function CreateDistributionDialog({
  profitCalculationId,
  currencyCode,
  open,
  onOpenChange,
  onCreated,
}: {
  profitCalculationId: string;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<DistributionPreview | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    investmentDistributionsService.preview(profitCalculationId).then(setPreview);
  }, [open, profitCalculationId]);

  const handleCreate = async () => {
    setIsSaving(true);
    try {
      await investmentDistributionsService.create({ profitCalculationId });
      toast.success(t("common.saved"));
      onCreated();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={CircleDollarSign}
      title={t("investors.distributions.createDialog.title")}
      description={t("investors.distributions.createDialog.description")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleCreate()}
          isSubmitting={isSaving}
          submitDisabled={!preview || preview.alreadyDistributed}
        />
      )}
    >
      <CreateOperationLayout>
        {preview ? (
          <>
            <CreateOperationSummary
              title={t("investors.distributions.createDialog.pool")}
              rows={[
                {
                  label: t("investors.profit.waterfall.investorProfitPool"),
                  value: formatMoney(preview.investorProfitPool, currencyCode),
                },
              ]}
            />
            <ModalSection title={t("investors.distributions.createDialog.shares")}>
              <table className="col-span-full w-full text-start text-body">
                <thead>
                  <tr className="border-b border-border text-caption text-muted-foreground">
                    <th className="p-2 text-start">
                      {t("investors.distributions.fields.investor")}
                    </th>
                    <th className="p-2 text-start">
                      {t("investors.profit.shares.participationPercent")}
                    </th>
                    <th className="p-2 text-start">
                      {t("investors.distributions.fields.entitled")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.investorShares.map((share) => (
                    <tr key={share.investorId} className="border-b border-border/60">
                      <td className="p-2 font-medium">{share.investorName}</td>
                      <td className="p-2">{share.participationPercent.toFixed(2)}%</td>
                      <td className="p-2">{formatMoney(share.profitShareAmount, currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ModalSection>
          </>
        ) : null}
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}

function RecordPaymentDialog({
  investorDistribution,
  currencyCode,
  open,
  onOpenChange,
  onRecorded,
}: {
  investorDistribution: InvestorDistributionRow;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useLocale();
  const paymentMethods = usePaymentMethods();
  const [amount, setAmount] = useState(String(investorDistribution.outstandingAmount));
  const [financialAccount, setFinancialAccount] = useState<ChartOfAccountRow | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentDate, setPaymentDate] = useState(toISODate(new Date()));
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(String(investorDistribution.outstandingAmount));
    setFinancialAccount(null);
    setPaymentMethodId("");
    setPaymentDate(toISODate(new Date()));
    setReferenceNumber("");
    setNotes("");
  }, [open, investorDistribution]);

  const amountValue = Number(amount);
  const isOverpayment = amountValue > investorDistribution.outstandingAmount;
  const isValid =
    amountValue > 0 && !isOverpayment && Boolean(financialAccount) && Boolean(paymentDate);

  const handleSave = async () => {
    if (!isValid || !financialAccount) return;
    setIsSaving(true);
    try {
      await distributionPaymentsService.create({
        investorDistributionId: investorDistribution.id,
        amount: amountValue,
        paymentDate,
        financialAccountId: financialAccount.id,
        paymentMethodId: paymentMethodId || undefined,
        referenceNumber: referenceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(t("common.saved"));
      onRecorded();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={Wallet}
      title={t("investors.distributions.paymentDialog.title")}
      description={investorDistribution.investorName}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={!isValid}
        />
      )}
    >
      <CreateOperationLayout>
        <CreateOperationSummary
          title={t("investors.distributions.fields.outstanding")}
          rows={[
            {
              label: t("investors.distributions.fields.outstanding"),
              value: formatMoney(investorDistribution.outstandingAmount, currencyCode),
            },
          ]}
        />
        {isOverpayment ? (
          <p className="text-caption text-destructive">
            {t("investors.distributions.paymentDialog.overpaymentBlocked")}
          </p>
        ) : null}
        <ModalSection title={t("investors.distributions.paymentDialog.title")} columns={2}>
          <div className="flex flex-col gap-1">
            <Label>
              {t("investors.distributions.fields.amount")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              dir="ltr"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t("investors.distributions.fields.date")} <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t("investors.distributions.fields.financialAccount")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <AccountPicker value={financialAccount} onChange={setFinancialAccount} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("investors.distributions.fields.paymentMethod")}</Label>
            <EntityCombobox
              value={paymentMethods.find((method) => method.id === paymentMethodId) ?? null}
              onChange={(row) => setPaymentMethodId(row?.id ?? "")}
              items={paymentMethods}
              getId={(item) => item.id}
              getTitle={(item) => item.name}
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("investors.distributions.fields.reference")}</Label>
            <Input
              dir="ltr"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>
          <div className="col-span-full flex flex-col gap-1">
            <Label>{t("investors.distributions.fields.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
