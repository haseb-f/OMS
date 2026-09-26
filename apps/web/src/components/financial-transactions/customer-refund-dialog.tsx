"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { MoneyInput } from "@/components/shared/money-input";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
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
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";

/**
 * "Refund" on a posted Sales Return — pays the customer back against the
 * return's credit. Prefilled with what the API says is refundable now
 * (unrefunded credit capped by the customer's ledger credit) and the
 * default Cash/Bank account, so the common case is one click. Creates +
 * confirms + posts in one call; a synchronous guard blocks double-submit.
 */
export function CustomerRefundDialog({
  open,
  onOpenChange,
  salesReturnId,
  partnerId,
  currencyId,
  currencyCode,
  onRefunded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesReturnId: string;
  partnerId: string;
  currencyId: string | null;
  currencyCode?: string | null;
  onRefunded?: (refund: FinancialTransactionRow) => void;
}) {
  const { t } = useLocale();
  const [summary, setSummary] = useState<RefundableReturnSummary | null>(null);
  const [amount, setAmount] = useState(0);
  const [transactionDate, setTransactionDate] = useState<Date | null>(new Date());
  const [receivingAccountId, setReceivingAccountId] = useState<string | null>(null);
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);
  const [paymentSources, setPaymentSources] = useState<PaymentSourceOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    customerRefundsService
      .refundable(salesReturnId)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setAmount(result.refundableAmount);
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
  }, [open, salesReturnId, t]);

  const refundable = summary?.refundableAmount ?? 0;
  const exceeds = amount > refundable + 0.005;
  const isValid = !!summary && amount > 0 && !exceeds && !!receivingAccountId;

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
      const refund = await customerRefundsService.createConfirmed({
        partnerId,
        currencyId: currencyId ?? undefined,
        transactionDate: transactionDate ? transactionDate.toISOString() : undefined,
        paymentSourceId: paymentSourceId ?? undefined,
        receivingAccountId,
        amount,
        referenceNumber: referenceNumber || undefined,
        allocations: [{ invoiceId: salesReturnId, allocatedAmount: amount }],
      });
      toast.success(t("sales.returns.toasts.refunded", { number: refund.transactionNumber }));
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
      title={t("sales.refunds.dialog.title")}
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
        <CreateOperationSummary
          title={summary?.returnNumber ?? t("common.loading")}
          rows={[
            {
              label: t("sales.refunds.dialog.returnTotal"),
              value: money(summary?.grandTotal ?? 0),
            },
            {
              label: t("sales.refunds.dialog.refunded"),
              value: money(summary?.refundedTotal ?? 0),
            },
            {
              label: t("sales.refunds.dialog.customerCredit"),
              value: money(summary?.customerCreditBalance ?? 0),
            },
            { label: t("sales.refunds.dialog.refundable"), value: money(refundable) },
          ]}
        />
        {summary && refundable <= 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("sales.refunds.dialog.nothingToRefund")}
          </p>
        ) : (
          <ModalSection title={t("sales.refunds.editorTitle")} columns={2}>
            <div className="flex flex-col gap-1">
              <Label>
                {t("sales.refunds.dialog.amount")} <span className="text-destructive">*</span>
              </Label>
              <MoneyInput
                value={amount}
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
                {t("sales.refunds.dialog.paidFrom")} <span className="text-destructive">*</span>
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
