"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalSection } from "@/components/shared/modal-section";
import { MoneyInput } from "@/components/shared/money-input";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { StatusBadge } from "@/components/business/status-badge";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useExchangeRateRecovery } from "@/hooks/use-exchange-rate-recovery";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { toast, reportApiError } from "@/lib/toast";
import { recordHref } from "@/config/traceability/record-routes";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import {
  paymentSettlementsService,
  type EligibleClaim,
  type SettlementDetail,
  type SettlementPreview,
} from "@/services/payment-settlements-service";
import {
  buildSettlementInput,
  inputSignature,
  newIdempotencyKey,
  selectionTotals,
  type SettlementFormState,
} from "./settlement-form";
import { RatesSummary, RecordLink, SettlementJournalTable } from "./settlement-parts";

function initialForm(claims: EligibleClaim[]): SettlementFormState {
  return {
    receivedAmount: "",
    receivedCurrencyId: claims[0]?.currency.id ?? "",
    receivingAccountId: "",
    settlementDate: toISODate(new Date()),
    providerReference: "",
    feeAmount: "",
    notes: "",
    partialAmounts: {},
  };
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

/**
 * Settle → Preview → Confirm. The server recomputes the preview on confirm
 * (never trusting client numbers); one idempotency key per dialog opening
 * makes a double click or retry return the same settlement.
 */
export function SettleDialog({
  open,
  onOpenChange,
  methodId,
  claims,
  onSettled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methodId: string;
  claims: EligibleClaim[];
  onSettled: (settlement: SettlementDetail) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const fx = useExchangeRateRecovery();
  const totals = selectionTotals(claims);
  const claimCurrency = totals.currency;

  const [form, setForm] = useState<SettlementFormState>(() => initialForm(claims));
  const [accounts, setAccounts] = useState<ReceivingAccountOption[]>([]);
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  // Fresh state (and a fresh idempotency key) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(initialForm(claims));
    setPreview(null);
    setPreviewSignature("");
    setIdempotencyKey(newIdempotencyKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    receivingAccountsService
      .list()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [open]);

  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => !a.currencyId || a.currencyId === form.receivedCurrencyId)
        .map((a) => ({ value: a.id, label: a.name })),
    [accounts, form.receivedCurrencyId],
  );

  // Smart default: the only / default bank account for the received currency.
  useEffect(() => {
    if (form.receivingAccountId || accountOptions.length === 0) return;
    const matching = accounts.filter(
      (a) => !a.currencyId || a.currencyId === form.receivedCurrencyId,
    );
    const pick =
      matching.find((a) => a.currencyId === form.receivedCurrencyId && a.isDefault) ??
      matching.find((a) => a.isDefault) ??
      (matching.length === 1 ? matching[0] : undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pick) setForm((prev) => ({ ...prev, receivingAccountId: pick.id }));
  }, [accountOptions, accounts, form.receivedCurrencyId, form.receivingAccountId]);

  const input = buildSettlementInput(methodId, claims, form);
  const signature = inputSignature(input);
  const crossCurrency = !!claimCurrency && form.receivedCurrencyId !== claimCurrency.id;
  const previewIsCurrent = !!preview && previewSignature === signature;
  const isDirty = form.receivedAmount.trim() !== "" || form.providerReference.trim() !== "";

  const update = (patch: Partial<SettlementFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const runPreview = () => {
    if (!input) {
      toast.error(t("paymentSettlement.dialog.invalid"));
      return;
    }
    setIsPreviewing(true);
    const requested = signature;
    fx.run(() => paymentSettlementsService.preview(input))
      .then((result) => {
        if (!result) return;
        setPreview(result);
        setPreviewSignature(requested);
      })
      .catch((error: unknown) => {
        reportApiError(error, "common.failedToSave");
      })
      .finally(() => setIsPreviewing(false));
  };

  const confirm = () => {
    if (!input || !previewIsCurrent || isConfirming) return;
    setIsConfirming(true);
    paymentSettlementsService
      .create({ ...input, idempotencyKey })
      .then((settlement) => {
        const href = settlement.journalEntry
          ? recordHref("JOURNAL_ENTRY", settlement.journalEntry.id)
          : null;
        const message = t(
          settlement.replayed
            ? "paymentSettlement.dialog.replayed"
            : "paymentSettlement.dialog.success",
          { number: settlement.settlementNumber },
        );
        const action = href
          ? { label: t("paymentSettlement.dialog.open"), onClick: () => router.push(href) }
          : undefined;
        if (settlement.replayed) toast.info(message, { action });
        else toast.success(message, { action });
        onOpenChange(false);
        onSettled(settlement);
      })
      .catch((error: unknown) => {
        reportApiError(error, "common.failedToSave");
      })
      .finally(() => setIsConfirming(false));
  };

  const code = claimCurrency?.code ?? null;
  const functionalCode = preview?.functionalCurrency.code ?? "";
  const fxAmount = Number(preview?.fxDifference ?? 0);

  return (
    <>
      <EnterpriseModal
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        icon={HandCoins}
        title={t("paymentSettlement.dialog.title")}
        description={t("paymentSettlement.dialog.description", {
          count: totals.count,
          amount: formatMoney(totals.remaining, code),
        })}
        isDirty={isDirty}
        footer={(requestClose) =>
          preview && previewIsCurrent ? (
            <>
              <EnterpriseButton
                type="button"
                variant="ghost"
                disabled={isConfirming}
                onClick={() => setPreview(null)}
              >
                {t("paymentSettlement.dialog.edit")}
              </EnterpriseButton>
              <EnterpriseButton type="button" disabled={isConfirming} onClick={confirm}>
                {t("paymentSettlement.dialog.confirm")}
              </EnterpriseButton>
            </>
          ) : (
            <>
              <EnterpriseButton type="button" variant="ghost" onClick={requestClose}>
                {t("common.cancel")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                disabled={!input || isPreviewing}
                onClick={runPreview}
              >
                {t("paymentSettlement.dialog.preview")}
              </EnterpriseButton>
            </>
          )
        }
      >
        {preview && previewIsCurrent ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 text-body md:grid-cols-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">
                  {t("paymentSettlement.fields.gross")}
                </dt>
                <dd>
                  <MoneyValue value={preview.grossAmount} currency={preview.claimCurrency} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">
                  {t("paymentSettlement.fields.received")}
                </dt>
                <dd>
                  <MoneyValue value={preview.receivedAmount} currency={preview.receivedCurrency} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">
                  {t("paymentSettlement.fields.fee")} ·{" "}
                  {t(`paymentSettlement.preview.feeBasis.${preview.feeBasis}`)}
                </dt>
                <dd>
                  <MoneyValue value={preview.feeAmount} currency={preview.claimCurrency} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">
                  {t("paymentSettlement.fields.fxDifference")}
                  {fxAmount !== 0
                    ? ` · ${t(fxAmount > 0 ? "paymentSettlement.preview.fxLoss" : "paymentSettlement.preview.fxGain")}`
                    : ""}
                </dt>
                <dd>
                  <MoneyValue value={Math.abs(fxAmount)} currency={functionalCode} />
                </dd>
              </div>
            </dl>

            <ModalSection title={t("paymentSettlement.preview.rates")} columns={2}>
              <div className="md:col-span-2">
                <RatesSummary
                  rates={[preview.rates.claim, preview.rates.received]}
                  functionalCode={functionalCode}
                />
              </div>
            </ModalSection>

            <section className="flex flex-col gap-1.5">
              <h3 className="text-body font-semibold">
                {t("paymentSettlement.preview.journal", { currency: functionalCode })}
              </h3>
              <SettlementJournalTable
                currency={functionalCode}
                totalDebit={preview.totalDebit}
                totalCredit={preview.totalCredit}
                lines={preview.journalLines.map((line, index) => ({
                  key: `${line.role}-${index}`,
                  account: line.account,
                  description: t(`paymentSettlement.preview.roles.${line.role}`),
                  debit: line.debit,
                  credit: line.credit,
                }))}
              />
            </section>

            <section className="flex flex-col gap-1.5">
              <h3 className="text-body font-semibold">{t("paymentSettlement.fields.lines")}</h3>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {preview.claims.map((claim) => (
                  <li
                    key={claim.paymentId}
                    className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-body"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <SemanticValue kind="id">{claim.paymentNumber}</SemanticValue>
                      <RecordLink
                        kind="STORE_ORDER"
                        id={claim.storeOrder?.id}
                        label={claim.storeOrder?.internalOrderId}
                      />
                      {claim.customer ? (
                        <span className="text-muted-foreground">{claim.customer.name}</span>
                      ) : null}
                      {!claim.fullySettles ? (
                        <StatusBadge
                          label={t("paymentSettlement.preview.partial")}
                          tone="warning"
                        />
                      ) : null}
                    </span>
                    <MoneyValue value={claim.settleAmount} currency={preview.claimCurrency} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {preview && !previewIsCurrent ? (
              <p className="text-caption text-warning-foreground">
                {t("paymentSettlement.dialog.previewStale")}
              </p>
            ) : null}
            <ModalSection title={t("paymentSettlement.dialog.payoutSection")} columns={3}>
              <Field
                id="settle-received"
                label={t("paymentSettlement.fields.receivedAmount")}
                required
              >
                <MoneyInput
                  id="settle-received"
                  value={form.receivedAmount}
                  onChange={(e) => update({ receivedAmount: e.target.value })}
                />
              </Field>
              <Field
                id="settle-currency"
                label={t("paymentSettlement.fields.receivedCurrency")}
                required
              >
                <CurrencyPicker
                  id="settle-currency"
                  valueKey="id"
                  value={form.receivedCurrencyId}
                  onValueChange={(value) =>
                    update({ receivedCurrencyId: value, receivingAccountId: "", feeAmount: "" })
                  }
                />
              </Field>
              <Field id="settle-date" label={t("paymentSettlement.fields.settlementDate")} required>
                <EnterpriseDatePicker
                  id="settle-date"
                  className="w-full"
                  value={fromISODate(form.settlementDate)}
                  onChange={(date) => update({ settlementDate: date ? toISODate(date) : "" })}
                />
              </Field>
              <Field
                id="settle-account"
                label={t("paymentSettlement.fields.receivingAccount")}
                required
              >
                <SearchableSelect
                  id="settle-account"
                  value={form.receivingAccountId}
                  onValueChange={(value) => update({ receivingAccountId: value })}
                  options={accountOptions}
                  placeholder={t("paymentSettlement.dialog.receivingAccountPlaceholder")}
                />
              </Field>
              <Field id="settle-reference" label={t("paymentSettlement.fields.providerReference")}>
                <Input
                  id="settle-reference"
                  dir="ltr"
                  inputSize="compact-md"
                  value={form.providerReference}
                  placeholder={t("paymentSettlement.dialog.referencePlaceholder")}
                  onChange={(e) => update({ providerReference: e.target.value })}
                />
              </Field>
              <Field id="settle-notes" label={t("paymentSettlement.fields.notes")}>
                <Textarea
                  id="settle-notes"
                  rows={1}
                  value={form.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </Field>
            </ModalSection>

            {crossCurrency && claimCurrency ? (
              <ModalSection
                title={t("paymentSettlement.dialog.feeSection")}
                description={t("paymentSettlement.dialog.feeHint", {
                  currency: claimCurrency.code,
                })}
              >
                <Field
                  id="settle-fee"
                  label={t("paymentSettlement.dialog.feeLabel", { currency: claimCurrency.code })}
                >
                  <MoneyInput
                    id="settle-fee"
                    value={form.feeAmount}
                    onChange={(e) => update({ feeAmount: e.target.value })}
                  />
                </Field>
                {preview?.suggestedFee ? (
                  <p className="self-end text-caption text-muted-foreground">
                    {t("paymentSettlement.dialog.feeSuggested", {
                      amount: formatMoney(preview.suggestedFee, claimCurrency.code),
                    })}
                  </p>
                ) : null}
              </ModalSection>
            ) : null}

            <ModalSection
              title={t("paymentSettlement.dialog.claimsSection")}
              description={t("paymentSettlement.dialog.claimsHint")}
              optional
              collapsible
              defaultOpen={false}
              columns={2}
            >
              {claims.map((claim) => (
                <Field
                  key={claim.id}
                  id={`settle-partial-${claim.id}`}
                  label={`${claim.paymentNumber}${
                    claim.storeOrder ? ` · ${claim.storeOrder.internalOrderId}` : ""
                  } · ${formatMoney(claim.remainingAmount, claim.currency.code)}`}
                >
                  <MoneyInput
                    id={`settle-partial-${claim.id}`}
                    value={form.partialAmounts[claim.id] ?? ""}
                    placeholder={claim.remainingAmount}
                    max={claim.remainingAmount}
                    onChange={(e) =>
                      update({
                        partialAmounts: { ...form.partialAmounts, [claim.id]: e.target.value },
                      })
                    }
                  />
                </Field>
              ))}
            </ModalSection>
          </div>
        )}
      </EnterpriseModal>
      {fx.dialog}
    </>
  );
}
