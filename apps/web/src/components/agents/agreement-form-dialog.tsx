"use client";

import { useId, useState } from "react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyInput } from "@/components/shared/money-input";
import {
  agreementFormFrom,
  emptyAgreementForm,
  validateAgreementForm,
  withShippingPolicy,
  type AgreementFieldError,
  type AgreementFormField,
  type AgreementFormState,
} from "@/config/agents/agreement-form";
import { agentsService, type AgentAgreement } from "@/services/agents-service";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { FieldNote } from "./field-note";

/**
 * Create / edit a DRAFT agreement (spec §2, decision D3). Every term is
 * explicit — nothing is pre-selected; ACTIVE and ENDED agreements never open
 * here (their terms are immutable).
 */
export function AgreementFormDialog({
  agentId,
  currencyCode,
  agreement,
  onOpenChange,
  onSaved,
}: {
  agentId: string;
  currencyCode: string;
  /** null = new draft. */
  agreement: AgentAgreement | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [initial] = useState<AgreementFormState>(() =>
    agreement ? agreementFormFrom(agreement) : emptyAgreementForm(),
  );
  const [form, setForm] = useState<AgreementFormState>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { errors, payload } = validateAgreementForm(form);

  const set =
    <K extends AgreementFormField>(key: K) =>
    (value: AgreementFormState[K]) =>
      setForm((current) => ({ ...current, [key]: value }));
  const errorText = (field: AgreementFormField) => {
    const error: AgreementFieldError | undefined = showErrors ? errors[field] : undefined;
    return error ? t(`agents.agreements.errors.${error}` as MessageKey) : null;
  };
  const invalid = (field: AgreementFormField) => showErrors && !!errors[field];

  const ownerOptions = (["COMPANY", "AGENT"] as const).map((value) => ({
    value,
    label: t(`agents.agreements.owner.${value}`),
  }));

  const submit = async () => {
    if (!payload) {
      setShowErrors(true);
      toast.error(t("agents.agreements.validation"));
      return;
    }
    setIsSaving(true);
    try {
      if (agreement) {
        await agentsService.agreements.update(agentId, agreement.id, payload);
        toast.success(t("agents.agreements.toasts.saved"));
      } else {
        const created = await agentsService.agreements.create(agentId, payload);
        toast.success(t("agents.agreements.toasts.created", { number: created.agreementNumber }));
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const money = (field: AgreementFormField, label: string) => (
    <FormCardField
      size="sm"
      required
      label={`${label} (${currencyCode})`}
      htmlFor={`${fieldId}-${field}`}
      message={<FieldNote error={errorText(field)} />}
    >
      <MoneyInput
        id={`${fieldId}-${field}`}
        value={form[field] as string}
        aria-invalid={invalid(field)}
        onChange={(event) => set(field)(event.target.value as never)}
      />
    </FormCardField>
  );

  const rateField = (field: AgreementFormField, label: string) => (
    <FormCardField
      size="sm"
      required
      label={`${label} (%)`}
      htmlFor={`${fieldId}-${field}`}
      message={<FieldNote error={errorText(field)} />}
    >
      <Input
        id={`${fieldId}-${field}`}
        dir="ltr"
        inputMode="decimal"
        value={form[field] as string}
        aria-invalid={invalid(field)}
        onChange={(event) => set(field)(event.target.value as never)}
      />
    </FormCardField>
  );

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={agreement ? t("agents.agreements.formTitleEdit") : t("agents.agreements.formTitleNew")}
      description={agreement?.agreementNumber}
      isDirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.agreements.sections.period")}>
          <FormCardRow>
            <FormCardField
              size="sm"
              required
              label={t("agents.agreements.fields.effectiveFrom")}
              htmlFor={`${fieldId}-from`}
              message={<FieldNote error={errorText("effectiveFrom")} />}
            >
              <EnterpriseDatePicker
                id={`${fieldId}-from`}
                value={fromISODate(form.effectiveFrom)}
                aria-invalid={invalid("effectiveFrom")}
                onChange={(date) => set("effectiveFrom")(date ? toISODate(date) : "")}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              label={t("agents.agreements.fields.effectiveTo")}
              htmlFor={`${fieldId}-to`}
              message={
                <FieldNote
                  error={errorText("effectiveTo")}
                  hint={t("agents.agreements.fields.effectiveToHint")}
                />
              }
            >
              <EnterpriseDatePicker
                id={`${fieldId}-to`}
                value={fromISODate(form.effectiveTo)}
                aria-invalid={invalid("effectiveTo")}
                onChange={(date) => set("effectiveTo")(date ? toISODate(date) : "")}
              />
            </FormCardField>
          </FormCardRow>
        </FormCardSection>

        <FormCardSection
          title={t("agents.agreements.sections.commission")}
          description={t("agents.agreements.fields.commissionRateHint")}
        >
          <FormCardRow>
            {rateField("productCommissionRatePercent", t("agents.agreements.fields.productRate"))}
            {rateField("serviceCommissionRatePercent", t("agents.agreements.fields.serviceRate"))}
          </FormCardRow>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.agreements.fields.earningEvent")}
              htmlFor={`${fieldId}-event`}
              message={<FieldNote error={errorText("commissionEarningEvent")} />}
            >
              <SearchableSelect
                id={`${fieldId}-event`}
                value={form.commissionEarningEvent}
                placeholder={t("agents.agreements.choose")}
                error={invalid("commissionEarningEvent")}
                onValueChange={(value) =>
                  set("commissionEarningEvent")(
                    value as AgreementFormState["commissionEarningEvent"],
                  )
                }
                options={(["DELIVERED", "PAYMENT_VERIFIED"] as const).map((value) => ({
                  value,
                  label: t(`agents.agreements.earningEvent.${value}`),
                }))}
              />
            </FormCardField>
            <FormCardField
              size="md"
              required
              label={t("agents.agreements.fields.returnTreatment")}
              htmlFor={`${fieldId}-return`}
              message={<FieldNote error={errorText("returnCommissionTreatment")} />}
            >
              <SearchableSelect
                id={`${fieldId}-return`}
                value={form.returnCommissionTreatment}
                placeholder={t("agents.agreements.choose")}
                error={invalid("returnCommissionTreatment")}
                onValueChange={(value) =>
                  set("returnCommissionTreatment")(
                    value as AgreementFormState["returnCommissionTreatment"],
                  )
                }
                options={(["REVERSE", "RETAIN"] as const).map((value) => ({
                  value,
                  label: t(`agents.agreements.returnTreatment.${value}`),
                }))}
              />
            </FormCardField>
          </FormCardRow>
        </FormCardSection>

        <FormCardSection
          title={t("agents.agreements.sections.charges")}
          description={t("agents.agreements.fields.feesHint")}
        >
          <FormCardField
            size="lg"
            required
            label={t("agents.agreements.fields.shippingPolicy")}
            htmlFor={`${fieldId}-shipPolicy`}
            message={
              <FieldNote
                error={errorText("shippingPolicy")}
                hint={
                  form.shippingPolicy
                    ? t(`agents.agreements.shippingPolicyHint.${form.shippingPolicy}`)
                    : null
                }
              />
            }
          >
            <SearchableSelect
              id={`${fieldId}-shipPolicy`}
              value={form.shippingPolicy}
              placeholder={t("agents.agreements.choose")}
              error={invalid("shippingPolicy")}
              onValueChange={(value) =>
                setForm((current) =>
                  withShippingPolicy(current, value as AgreementFormState["shippingPolicy"]),
                )
              }
              options={(["PREDETERMINED_CHARGE", "FLAT_FEE_PER_SHIPMENT", "NONE"] as const).map(
                (value) => ({ value, label: t(`agents.agreements.shippingPolicy.${value}`) }),
              )}
            />
          </FormCardField>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.agreements.fields.shippingChargeOwner")}
              htmlFor={`${fieldId}-shipOwner`}
              message={<FieldNote error={errorText("customerShippingChargeOwner")} />}
            >
              <SearchableSelect
                id={`${fieldId}-shipOwner`}
                value={form.customerShippingChargeOwner}
                placeholder={t("agents.agreements.choose")}
                error={invalid("customerShippingChargeOwner")}
                onValueChange={(value) =>
                  set("customerShippingChargeOwner")(
                    value as AgreementFormState["customerShippingChargeOwner"],
                  )
                }
                options={ownerOptions}
              />
            </FormCardField>
            <FormCardField
              size="md"
              required
              label={t("agents.agreements.fields.providerFeesBorneBy")}
              htmlFor={`${fieldId}-providerFees`}
              message={<FieldNote error={errorText("providerFeesBorneBy")} />}
            >
              <SearchableSelect
                id={`${fieldId}-providerFees`}
                value={form.providerFeesBorneBy}
                placeholder={t("agents.agreements.choose")}
                error={invalid("providerFeesBorneBy")}
                onValueChange={(value) =>
                  set("providerFeesBorneBy")(value as AgreementFormState["providerFeesBorneBy"])
                }
                options={ownerOptions}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardRow>
            {money("shippingFeePerShipment", t("agents.agreements.fields.shippingFee"))}
            {money("returnFeePerShipment", t("agents.agreements.fields.returnFee"))}
            {money("serviceFeePerOrder", t("agents.agreements.fields.serviceFee"))}
          </FormCardRow>
        </FormCardSection>

        <FormCardSection title={t("agents.agreements.sections.payments")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.agreements.fields.allowAgentDestinations")}
              htmlFor={`${fieldId}-allow`}
              message={<FieldNote error={errorText("allowAgentDestinations")} />}
            >
              <SearchableSelect
                id={`${fieldId}-allow`}
                value={form.allowAgentDestinations}
                placeholder={t("agents.agreements.choose")}
                error={invalid("allowAgentDestinations")}
                onValueChange={(value) =>
                  set("allowAgentDestinations")(
                    value as AgreementFormState["allowAgentDestinations"],
                  )
                }
                options={[
                  { value: "yes", label: t("agents.agreements.yes") },
                  { value: "no", label: t("agents.agreements.no") },
                ]}
              />
            </FormCardField>
            <FormCardField
              size="sm"
              required
              label={t("agents.agreements.fields.payoutHoldDays")}
              htmlFor={`${fieldId}-hold`}
              message={
                <FieldNote
                  error={errorText("payoutHoldDays")}
                  hint={t("agents.agreements.fields.holdHint")}
                />
              }
            >
              <Input
                id={`${fieldId}-hold`}
                dir="ltr"
                inputMode="numeric"
                value={form.payoutHoldDays}
                aria-invalid={invalid("payoutHoldDays")}
                onChange={(event) => set("payoutHoldDays")(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
        </FormCardSection>

        <FormCardSection title={t("agents.agreements.sections.notes")}>
          <FormCardField label={t("agents.agreements.fields.notes")} htmlFor={`${fieldId}-notes`}>
            <Textarea
              id={`${fieldId}-notes`}
              rows={2}
              value={form.notes}
              onChange={(event) => set("notes")(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
