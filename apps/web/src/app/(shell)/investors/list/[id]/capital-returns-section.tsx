"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote } from "lucide-react";
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
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { AccountPicker } from "@/components/business/account-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { capitalReturnsService, type CapitalReturnRow } from "@/services/capital-returns-service";
import type { InvestorSubscriptionRow } from "@/services/investor-subscriptions-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, fromISODate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";

const RETURN_TONE: Record<
  CapitalReturnRow["status"],
  "success" | "neutral" | "warning" | "destructive"
> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  PAID: "success",
  CANCELLED: "destructive",
};

export function CapitalReturnsSection({
  investorId,
  subscriptions,
  canCreate,
  canApprove,
  canPay,
  canCancel,
}: {
  investorId: string;
  subscriptions: InvestorSubscriptionRow[];
  canCreate: boolean;
  canApprove: boolean;
  canPay: boolean;
  canCancel: boolean;
}) {
  const { t } = useLocale();
  const [returns, setReturns] = useState<CapitalReturnRow[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CapitalReturnRow | null>(null);

  const load = useCallback(async () => {
    const result = await capitalReturnsService.list({ investorId, pageSize: 50 });
    setReturns(result.items);
  }, [investorId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function approve(row: CapitalReturnRow) {
    try {
      await capitalReturnsService.approve(row.id);
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  async function pay(row: CapitalReturnRow) {
    try {
      await capitalReturnsService.pay(row.id);
      toast.success(t("common.saved"));
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      await capitalReturnsService.cancel(cancelTarget.id);
      toast.success(t("common.saved"));
      setCancelTarget(null);
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    }
  }

  if (!returns) return null;

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-body font-medium">{t("investors.capitalReturns.title")}</h3>
        {canCreate && subscriptions.length > 0 ? (
          <EnterpriseButton size="sm" onClick={() => setCreateOpen(true)}>
            {t("investors.capitalReturns.actions.create")}
          </EnterpriseButton>
        ) : null}
      </div>
      {returns.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("investors.capitalReturns.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-body">
            <thead>
              <tr className="border-b border-border text-caption text-muted-foreground">
                <th className="p-2 text-start">{t("investors.capitalReturns.fields.code")}</th>
                <th className="p-2 text-start">{t("investors.capitalReturns.fields.amount")}</th>
                <th className="p-2 text-start">{t("investors.capitalReturns.fields.date")}</th>
                <th className="p-2 text-start">{t("investors.capitalReturns.fields.status")}</th>
                <th className="p-2 text-start">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="p-2 font-medium">{row.code}</td>
                  <td className="p-2">{formatMoney(row.amount)}</td>
                  <td className="p-2">{formatDate(row.date)}</td>
                  <td className="p-2">
                    <StatusBadge
                      label={t(`investors.capitalReturns.status.${row.status}` as never)}
                      tone={RETURN_TONE[row.status]}
                    />
                  </td>
                  <td className="p-2 flex gap-1.5">
                    {canApprove && row.status === "DRAFT" ? (
                      <EnterpriseButton size="sm" onClick={() => approve(row)}>
                        {t("investors.capitalReturns.actions.approve")}
                      </EnterpriseButton>
                    ) : null}
                    {canPay && row.status === "APPROVED" ? (
                      <EnterpriseButton size="sm" variant="secondary" onClick={() => pay(row)}>
                        {t("investors.capitalReturns.actions.pay")}
                      </EnterpriseButton>
                    ) : null}
                    {canCancel && (row.status === "DRAFT" || row.status === "APPROVED") ? (
                      <EnterpriseButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setCancelTarget(row)}
                      >
                        {t("investors.capitalReturns.actions.cancel")}
                      </EnterpriseButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen ? (
        <CreateCapitalReturnDialog
          subscriptions={subscriptions}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => {
            setCreateOpen(false);
            await load();
          }}
        />
      ) : null}

      <ConfirmationDialog
        open={cancelTarget != null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={t("investors.capitalReturns.actions.cancel")}
        description={cancelTarget?.code}
        onConfirm={confirmCancel}
        tone="destructive"
      />
    </div>
  );
}

function CreateCapitalReturnDialog({
  subscriptions,
  open,
  onOpenChange,
  onCreated,
}: {
  subscriptions: InvestorSubscriptionRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [subscriptionId, setSubscriptionId] = useState(subscriptions[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [financialAccount, setFinancialAccount] = useState<ChartOfAccountRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const amountValue = Number(amount);
  const isValid = amountValue > 0 && Boolean(subscriptionId) && Boolean(date);

  const handleCreate = async () => {
    if (!isValid) return;
    setIsSaving(true);
    try {
      await capitalReturnsService.create({
        subscriptionId,
        amount: amountValue,
        date,
        financialAccountId: financialAccount?.id,
      });
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
      icon={Banknote}
      title={t("investors.capitalReturns.actions.create")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleCreate()}
          isSubmitting={isSaving}
          submitDisabled={!isValid}
        />
      )}
    >
      <CreateOperationLayout>
        <CreateOperationSummary
          title={t("common.summary")}
          rows={[
            {
              label: t("investors.capitalReturns.fields.amount"),
              value: amountValue > 0 ? formatMoney(amountValue) : "—",
            },
          ]}
        />
        <ModalSection title={t("investors.capitalReturns.actions.create")} columns={2}>
          <div className="flex flex-col gap-1">
            <Label>
              {t("investors.capitalReturns.fields.opportunity")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <EntityCombobox
              value={subscriptions.find((s) => s.id === subscriptionId) ?? null}
              onChange={(row) => setSubscriptionId(row?.id ?? "")}
              items={subscriptions}
              getId={(item) => item.id}
              getTitle={(item) => `${item.opportunityCode} — ${item.opportunityName}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              {t("investors.capitalReturns.fields.amount")}{" "}
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
              {t("investors.capitalReturns.fields.date")}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <EnterpriseDatePicker
              value={fromISODate(date)}
              onChange={(next) => setDate(next ? toISODate(next) : "")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t("investors.capitalReturns.fields.financialAccount")}</Label>
            <AccountPicker value={financialAccount} onChange={setFinancialAccount} />
          </div>
        </ModalSection>
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
