"use client";

import { RequiredMark } from "@/components/ui/form";
import { useEffect, useId, useRef, useState } from "react";
import { Info, Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { MoneyInput } from "@/components/shared/money-input";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/searchable-select";
import {
  customerRefundsService,
  type RefundableReturnSummary,
} from "@/services/customer-refunds-service";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import {
  paymentSourcesService,
  type PaymentSourceOption,
} from "@/services/payment-sources-service";
import {
  storeOrderMoneyService,
  type StoreOrderRefundable,
} from "@/components/store-orders/money/store-order-money-service";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import { newIdempotencyKey } from "@/hooks/use-idempotency-key";

/**
 * What a refund pays back: one posted credit note, or — R15 (D15-11) — a
 * store order (the server refunds its credit notes first, then its verified
 * advance of a cancelled / undelivered order or an overpayment).
 */
export type RefundTarget =
  | { kind: "return"; salesReturnId: string; partnerId: string; currencyId: string | null }
  | { kind: "order"; storeOrderId: string; orderNumber: string };

/** The dialog's read-only summary — every figure comes from the API. */
export interface RefundSummary {
  title: string;
  rows: { labelKey: MessageKey; amount: number }[];
  refundable: number;
}

export function returnRefundSummary(summary: RefundableReturnSummary): RefundSummary {
  return {
    title: summary.returnNumber,
    rows: [
      { labelKey: "sales.refunds.dialog.returnTotal", amount: summary.grandTotal },
      { labelKey: "sales.refunds.dialog.refunded", amount: summary.refundedTotal },
      { labelKey: "sales.refunds.dialog.customerCredit", amount: summary.customerCreditBalance },
      { labelKey: "sales.refunds.dialog.refundable", amount: summary.refundableAmount },
    ],
    refundable: summary.refundableAmount,
  };
}

export function orderRefundSummary(summary: StoreOrderRefundable): RefundSummary {
  return {
    title: summary.internalOrderId,
    rows: [
      { labelKey: "storeOrderMoney.refundDialog.collected", amount: summary.collected },
      { labelKey: "storeOrderMoney.refundDialog.netInvoiced", amount: summary.expected },
      { labelKey: "storeOrderMoney.refundDialog.refunded", amount: summary.refunded },
      { labelKey: "storeOrderMoney.refundDialog.refundDue", amount: summary.refundDue },
      {
        labelKey: "storeOrderMoney.refundDialog.customerCredit",
        amount: summary.customerCreditBalance,
      },
      { labelKey: "storeOrderMoney.refundDialog.refundable", amount: summary.refundable },
    ],
    refundable: summary.refundable,
  };
}

/**
 * "Refund" — money actually returned to the customer, recorded manually (no
 * payment gateway is integrated, so the money goes back through the gateway /
 * bank first; the dialog says so). Prefilled with what the API says is
 * refundable now (capped by the customer's ledger credit) and the default
 * Cash/Bank account, so the common case is one click. Creates + confirms +
 * posts in one call; one idempotency key per opening and a synchronous guard
 * block a double submit.
 */
export function CustomerRefundDialog({
  open,
  onOpenChange,
  target,
  currencyCode,
  onRefunded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RefundTarget;
  currencyCode?: string | null;
  onRefunded?: (refund: FinancialTransactionRow) => void;
}) {
  const { t } = useLocale();
  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [amount, setAmount] = useState(0);
  const [transactionDate, setTransactionDate] = useState<Date | null>(new Date());
  const [receivingAccountId, setReceivingAccountId] = useState<string | null>(null);
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [paymentSources, setPaymentSources] = useState<PaymentSourceOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  /** One idempotency key per opening of the dialog (R13 B2) — a retried submit returns the first refund. */
  const idempotencyKeyRef = useRef<string | null>(null);
  const fieldId = useId();
  const targetId = target.kind === "return" ? target.salesReturnId : target.storeOrderId;

  useEffect(() => {
    if (!open) return;
    idempotencyKeyRef.current = newIdempotencyKey();
    let cancelled = false;
    const load =
      target.kind === "return"
        ? customerRefundsService.refundable(targetId).then(returnRefundSummary)
        : storeOrderMoneyService.refundable(targetId).then(orderRefundSummary);
    load
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setAmount(result.refundable);
      })
      .catch((error) => reportApiError(error, t("errors.generic")));
    receivingAccountsService
      .list()
      .then((accounts) => {
        if (cancelled) return;
        setReceivingAccounts(accounts);
        const preferred =
          accounts.find((account) => account.isDefault) ??
          (accounts.length === 1 ? accounts[0] : undefined);
        setReceivingAccountId((current) => current ?? preferred?.id ?? null);
      })
      .catch(() => setReceivingAccounts([]));
    paymentSourcesService
      .list()
      .then((sources) => !cancelled && setPaymentSources(sources))
      .catch(() => setPaymentSources([]));
    return () => {
      cancelled = true;
    };
  }, [open, target.kind, targetId, t]);

  const refundable = summary?.refundable ?? 0;
  const exceeds = amount > refundable + 0.005;
  const isValid = !!summary && amount > 0 && !exceeds && !!receivingAccountId;

  const submit = (accountId: string) => {
    const common = {
      transactionDate: transactionDate ? transactionDate.toISOString() : undefined,
      paymentSourceId: paymentSourceId ?? undefined,
      referenceNumber: referenceNumber || undefined,
    };
    const idempotencyKey = idempotencyKeyRef.current ?? newIdempotencyKey();
    return target.kind === "return"
      ? customerRefundsService.createConfirmed({
          ...common,
          partnerId: target.partnerId,
          currencyId: target.currencyId ?? undefined,
          receivingAccountId: accountId,
          amount,
          allocations: [{ invoiceId: target.salesReturnId, allocatedAmount: amount }],
          idempotencyKey,
        })
      : storeOrderMoneyService.recordRefund(target.storeOrderId, {
          ...common,
          receivingAccountId: accountId,
          amount,
          idempotencyKey,
        });
  };

  const handleSubmit = async () => {
    if (!summary) return;
    if (!receivingAccountId) {
      toast.error(t("financialTransactions.validation.receivingAccountRequired"));
      return;
    }
    if (amount <= 0) {
      toast.error(t("financialTransactions.validation.amountRequired"));
      return;
    }
    if (exceeds) {
      toast.error(
        t("sales.refunds.dialog.amountExceeds", { amount: formatMoney(refundable, currencyCode) }),
      );
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const refund = await submit(receivingAccountId);
      toast.success(
        target.kind === "return"
          ? t("sales.returns.toasts.refunded", { number: refund.transactionNumber })
          : t("storeOrderMoney.refundDialog.recorded", { number: refund.transactionNumber }),
      );
      onOpenChange(false);
      onRefunded?.(refund);
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const money = (value: number) => formatMoney(value, currencyCode);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={Undo2}
      title={
        target.kind === "return"
          ? t("sales.refunds.dialog.title")
          : t("storeOrderMoney.refundDialog.title", { order: target.orderNumber })
      }
      description={t("sales.refunds.dialog.description")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSubmit()}
          isSubmitting={isSubmitting}
          submitDisabled={!isValid}
          submitLabel={t("sales.refunds.dialog.submit")}
        />
      )}
    >
      <CreateOperationLayout>
        <Alert tone="info">
          <Info />
          <AlertDescription>
            {t("storeOrderMoney.refundDialog.gatewayNotice")}
            {target.kind === "order" ? (
              <span className="block">{t("storeOrderMoney.refundDialog.split")}</span>
            ) : null}
          </AlertDescription>
        </Alert>
        <CreateOperationSummary
          title={summary?.title ?? t("common.loading")}
          rows={(summary?.rows ?? []).map((row) => ({
            label: t(row.labelKey),
            value: money(row.amount),
          }))}
        />
        {summary && refundable <= 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("sales.refunds.dialog.nothingToRefund")}
          </p>
        ) : (
          <ModalSection title={t("sales.refunds.editorTitle")} columns={2}>
            <div className="flex flex-col gap-1">
              <Label>
                {t("sales.refunds.dialog.amount")}
                <RequiredMark className="ms-0.5" />
              </Label>
              <MoneyInput
                value={amount || ""}
                aria-invalid={exceeds || undefined}
                onChange={(event) => setAmount(event.target.valueAsNumber || 0)}
              />
              {exceeds && (
                <p className="text-caption text-destructive">
                  {t("sales.refunds.dialog.amountExceeds", { amount: money(refundable) })}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("financialTransactions.fields.transactionDate")}</Label>
              <EnterpriseDatePicker value={transactionDate} onChange={setTransactionDate} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-receiving`}>
                {t("sales.refunds.dialog.paidFrom")}
                <RequiredMark className="ms-0.5" />
              </Label>
              <SearchableSelect
                id={`${fieldId}-receiving`}
                value={receivingAccountId}
                onValueChange={(value) => setReceivingAccountId(value || null)}
                options={receivingAccounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                }))}
                allowClear
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-source`}>
                {t("financialTransactions.fields.paymentSource")}
              </Label>
              <SearchableSelect
                id={`${fieldId}-source`}
                value={paymentSourceId}
                onValueChange={(value) => setPaymentSourceId(value || null)}
                options={paymentSources.map((source) => ({ value: source.id, label: source.name }))}
                allowClear
              />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label>{t("financialTransactions.fields.referenceNumber")}</Label>
              <Input
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
              />
            </div>
          </ModalSection>
        )}
      </CreateOperationLayout>
    </EnterpriseModal>
  );
}
