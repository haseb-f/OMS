"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { MoneyValue } from "@/components/shared/money-value";
import { DetailSection } from "@/components/shared/detail-workspace";
import { WorkflowTracker } from "@/components/shared/workflow-tracker";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/business/status-badge";
import { newIdempotencyKey } from "@/components/payments/declaration/declaration-logic";
import {
  PAYMENT_TRACK_STAGES,
  paymentStageTone,
  paymentTrackPosition,
} from "@/config/agents/agent-finance";
import {
  agentFinanceService,
  type AgentChargeOwner,
  type AgentPaymentStageRow,
} from "@/services/agents-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { useLocale } from "@/providers/locale-provider";
import { formatDate, fromISODate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { reportApiError, toast } from "@/lib/toast";
import { FieldNote } from "./field-note";

/** 0 < amount, at most 2 decimals — the upper bound (collected on the order) is the server's. */
function positiveAmount(raw: string): number | null {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) return null;
  if ((raw.trim().split(".")[1] ?? "").length > 2) return null;
  return value;
}

/**
 * "Record customer refund" on an agent order (`agents.finance.adjust`).
 * COMPANY: paid from one of our receiving accounts (posted, charged to the
 * agent); AGENT: the agent refunded the customer itself (memo). The server
 * bounds the amount by what that payer collected and explains a refusal.
 */
export function RecordRefundDialog({
  orderId,
  orderNumber,
  currency,
  onOpenChange,
  onRecorded,
}: {
  orderId: string;
  orderNumber: string;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [paidBy, setPaidBy] = useState<AgentChargeOwner | "">("");
  const [amount, setAmount] = useState("");
  const [payingAccountId, setPayingAccountId] = useState("");
  const [refundDate, setRefundDate] = useState(() => toISODate(new Date()));
  const [reason, setReason] = useState("");
  const [accounts, setAccounts] = useState<ReceivingAccountOption[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    receivingAccountsService
      .list()
      .then(setAccounts)
      .catch(() => undefined);
  }, []);

  const amountValue = positiveAmount(amount);
  const accountMissing = paidBy === "COMPANY" && !payingAccountId;
  const valid = !!paidBy && amountValue != null && !accountMissing && !!reason.trim();

  const submit = async () => {
    if (!valid || !paidBy || amountValue == null) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await agentFinanceService.refund(orderId, {
        paidBy,
        amount: amountValue,
        payingAccountId: paidBy === "COMPANY" ? payingAccountId : undefined,
        refundDate: refundDate || undefined,
        reason: reason.trim(),
        idempotencyKey,
      });
      toast.success(t("agents.refund.recorded"));
      onRecorded();
      onOpenChange(false);
    } catch (error) {
      // e.g. REFUND_EXCEEDS_COLLECTED — the server's own message explains the bound.
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={t("agents.refund.title", { order: orderNumber })}
      description={t("agents.refund.description")}
      isDirty={!!(paidBy || amount || reason)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitLabel={t("agents.refund.submit")}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.refund.action")}>
          <FormCardField
            required
            label={t("agents.refund.paidBy")}
            htmlFor={`${fieldId}-paidBy`}
            message={
              <FieldNote
                error={showErrors && !paidBy ? t("agents.agreements.errors.required") : null}
                hint={paidBy ? t(`agents.refund.paidByHint.${paidBy}`) : undefined}
              />
            }
          >
            <SearchableSelect
              id={`${fieldId}-paidBy`}
              value={paidBy}
              onValueChange={(value) => setPaidBy(value as AgentChargeOwner)}
              placeholder={t("agents.agreements.choose")}
              error={showErrors && !paidBy}
              options={(["COMPANY", "AGENT"] as const).map((value) => ({
                value,
                label: t(`agents.refund.paidByValues.${value}`),
              }))}
            />
          </FormCardField>
          <FormCardRow>
            <FormCardField
              size="sm"
              required
              label={`${t("agents.refund.amount")} (${currency})`}
              htmlFor={`${fieldId}-amount`}
              message={
                <FieldNote
                  error={
                    showErrors && amountValue == null ? t("agents.refund.errors.amount") : null
                  }
                />
              }
            >
              <MoneyInput
                id={`${fieldId}-amount`}
                value={amount}
                aria-invalid={showErrors && amountValue == null}
                onChange={(event) => setAmount(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              label={t("agents.refund.refundDate")}
              htmlFor={`${fieldId}-date`}
            >
              <EnterpriseDatePicker
                id={`${fieldId}-date`}
                value={fromISODate(refundDate)}
                onChange={(date) => setRefundDate(date ? toISODate(date) : "")}
              />
            </FormCardField>
          </FormCardRow>
          {paidBy === "COMPANY" ? (
            <FormCardField
              required
              label={t("agents.refund.payingAccount")}
              htmlFor={`${fieldId}-account`}
              message={
                <FieldNote
                  error={showErrors && accountMissing ? t("agents.refund.errors.account") : null}
                />
              }
            >
              <SearchableSelect
                id={`${fieldId}-account`}
                value={payingAccountId}
                onValueChange={setPayingAccountId}
                placeholder={t("agents.agreements.choose")}
                error={showErrors && accountMissing}
                options={accounts.map((account) => ({ value: account.id, label: account.name }))}
              />
            </FormCardField>
          ) : null}
          <FormCardField
            required
            label={t("agents.refund.reason")}
            htmlFor={`${fieldId}-reason`}
            message={
              <FieldNote
                error={showErrors && !reason.trim() ? t("agents.refund.errors.reason") : null}
                hint={t("agents.refund.reasonHint")}
              />
            }
          >
            <Textarea
              id={`${fieldId}-reason`}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}

/**
 * Finance adjustment on the agent ledger (`agents.finance.adjust`). The
 * form is followed by a confirmation stating the sign in plain language.
 */
export function AdjustmentDialog({
  agentId,
  agentLabel,
  currency,
  onOpenChange,
  onRecorded,
}: {
  agentId: string;
  agentLabel: string;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [direction, setDirection] = useState<"CREDIT" | "DEBIT" | "">("");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(() => toISODate(new Date()));
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const amountValue = positiveAmount(amount);
  const valid = !!direction && amountValue != null && !!reason.trim();

  const record = async () => {
    if (!direction || amountValue == null) return;
    setIsSaving(true);
    try {
      await agentFinanceService.adjust(agentId, {
        direction,
        amount: amountValue,
        entryDate: entryDate || undefined,
        reason: reason.trim(),
        idempotencyKey,
      });
      toast.success(t("agents.adjustment.recorded"));
      setConfirming(false);
      onRecorded();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const formatted = amountValue != null ? formatMoney(amountValue, currency) : "";

  return (
    <>
      <EnterpriseModal
        open
        onOpenChange={onOpenChange}
        size="md"
        layout="form-card"
        title={t("agents.adjustment.title", { agent: agentLabel })}
        description={t("agents.adjustment.description")}
        isDirty={!!(direction || amount || reason)}
        footer={(requestClose) => (
          <CreateOperationFooter
            requestClose={requestClose}
            onSubmit={() => (valid ? setConfirming(true) : setShowErrors(true))}
            isSubmitting={isSaving}
            submitLabel={t("agents.adjustment.submit")}
          />
        )}
      >
        <FormCardStack>
          <FormCardSection title={t("agents.adjustment.action")}>
            <FormCardField
              required
              label={t("agents.adjustment.direction")}
              htmlFor={`${fieldId}-direction`}
              message={
                <FieldNote
                  error={showErrors && !direction ? t("agents.adjustment.errors.direction") : null}
                />
              }
            >
              <SearchableSelect
                id={`${fieldId}-direction`}
                value={direction}
                onValueChange={(value) => setDirection(value as "CREDIT" | "DEBIT")}
                placeholder={t("agents.agreements.choose")}
                error={showErrors && !direction}
                options={(["CREDIT", "DEBIT"] as const).map((value) => ({
                  value,
                  label: t(`agents.adjustment.directionValues.${value}`),
                }))}
              />
            </FormCardField>
            <FormCardRow>
              <FormCardField
                size="sm"
                required
                label={`${t("agents.adjustment.amount")} (${currency})`}
                htmlFor={`${fieldId}-amount`}
                message={
                  <FieldNote
                    error={
                      showErrors && amountValue == null
                        ? t("agents.adjustment.errors.amount")
                        : null
                    }
                  />
                }
              >
                <MoneyInput
                  id={`${fieldId}-amount`}
                  value={amount}
                  aria-invalid={showErrors && amountValue == null}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormCardField>
              <FormCardField
                size="sm"
                label={t("agents.adjustment.entryDate")}
                htmlFor={`${fieldId}-date`}
              >
                <EnterpriseDatePicker
                  id={`${fieldId}-date`}
                  value={fromISODate(entryDate)}
                  onChange={(date) => setEntryDate(date ? toISODate(date) : "")}
                />
              </FormCardField>
            </FormCardRow>
            <FormCardField
              required
              label={t("agents.adjustment.reason")}
              htmlFor={`${fieldId}-reason`}
              message={
                <FieldNote
                  error={showErrors && !reason.trim() ? t("agents.adjustment.errors.reason") : null}
                />
              }
            >
              <Textarea
                id={`${fieldId}-reason`}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormCardField>
          </FormCardSection>
        </FormCardStack>
      </EnterpriseModal>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="warning"
        title={t("agents.adjustment.confirmTitle")}
        description={
          direction === "CREDIT"
            ? t("agents.adjustment.confirmCredit", { amount: formatted })
            : t("agents.adjustment.confirmDebit", { amount: formatted })
        }
        confirmLabel={t("agents.adjustment.confirm")}
        isConfirming={isSaving}
        onConfirm={() => void record()}
      />
    </>
  );
}

/** Per-payment stage timeline of one agent order (spec §7 stages, computed server-side). */
export function AgentPaymentStages({
  agentId,
  storeOrderId,
  refreshKey,
  actions,
}: {
  agentId: string;
  storeOrderId: string;
  /** Changes when the order changed (declaration, verification…) so the timeline reloads. */
  refreshKey?: string;
  /** Section actions (e.g. Record customer refund). */
  actions?: ReactNode;
}) {
  const { t } = useLocale();
  const [rows, setRows] = useState<AgentPaymentStageRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentFinanceService
      .paymentStages(agentId, storeOrderId)
      .then((result) => !cancelled && setRows(result))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [agentId, storeOrderId, refreshKey]);

  if (!rows) return null;
  return (
    <DetailSection title={t("agents.paymentStages.title")} actions={actions}>
      {rows.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("agents.paymentStages.empty")}</p>
      ) : (
        rows.map((row) => {
          const position = paymentTrackPosition(row.stage);
          return (
            <div
              key={row.id}
              className="flex min-w-0 flex-col gap-1.5 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2 text-caption">
                <span className="num font-medium">{row.paymentNumber}</span>
                <span className="num text-muted-foreground">{formatDate(row.paymentDate)}</span>
                <MoneyValue value={row.amount} currency={row.currency} />
                {row.paymentMethod ? (
                  <span className="text-muted-foreground">{row.paymentMethod.name}</span>
                ) : null}
                <StatusBadge
                  label={t(`agents.paymentStage.${row.stage}`)}
                  tone={paymentStageTone(row.stage)}
                />
              </div>
              <WorkflowTracker
                label={t("agents.paymentStages.trackLabel", { number: row.paymentNumber })}
                stages={PAYMENT_TRACK_STAGES.map((stage) => ({
                  key: stage.key,
                  label: t(`agents.paymentStage.${stage.key}`),
                  optional: stage.optional,
                  caption:
                    stage.key === "AVAILABLE" && row.availableAt
                      ? formatDate(row.availableAt)
                      : null,
                }))}
                current={position.current}
                currentComplete={position.currentComplete}
                state={
                  position.offPath
                    ? {
                        label: t(`agents.paymentStage.${position.offPath}`),
                        tone: paymentStageTone(position.offPath),
                      }
                    : null
                }
              />
            </div>
          );
        })
      )}
    </DetailSection>
  );
}
