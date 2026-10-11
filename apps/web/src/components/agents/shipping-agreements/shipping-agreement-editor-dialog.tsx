"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { MoneyInput } from "@/components/shared/money-input";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { EnterpriseButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCountries } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import type { AgentShippingRateService } from "@/services/agents-service";
import { FieldNote } from "../field-note";
import { AgreementVersionNotice } from "../agreement-version-notice";
import { shippingAgreementsApi, type ShippingAgreementDetail } from "./shipping-agreements-api";
import { SHIPPING_SERVICES, calendarDay } from "./shipping-agreement-view";
import {
  newExtraRate,
  pricesCod,
  termsFormFrom,
  termsInputFrom,
  type ExtraRateForm,
  type ShippingTermsForm,
} from "./shipping-terms-form";
import { ChargePreviewLine } from "./charge-preview-line";

interface PeriodForm {
  effectiveFrom: string;
  effectiveTo: string;
}

const periodOf = (agreement: ShippingAgreementDetail): PeriodForm => ({
  effectiveFrom: calendarDay(agreement.effectiveFrom),
  effectiveTo: agreement.effectiveTo ? calendarDay(agreement.effectiveTo) : "",
});

/** What the dialog edits: a new draft, a draft, or the ACTIVE agreement (a new version). */
export type ShippingEditorTarget =
  | { kind: "new" }
  | { kind: "draft"; agreement: ShippingAgreementDetail }
  | { kind: "version"; agreement: ShippingAgreementDetail };

/** The form's content without the rows' list keys (dirty check). */
const termsSignature = (form: ShippingTermsForm) =>
  JSON.stringify([
    form.defaultAmount,
    form.defaultIncludesCodFee,
    form.codCollectionFee,
    form.notes,
    form.extras.map((row) => [
      row.service,
      row.countryId,
      row.city,
      row.amount,
      row.includesCodFee,
    ]),
  ]);

const RATE_SERVICES: readonly AgentShippingRateService[] = ["ANY", ...SHIPPING_SERVICES];

/**
 * The compact shipping-terms form (R17 §3): the default rate (all services ×
 * all destinations) first, "Add rate" for optional rows by service and/or
 * destination, the COD collection fee (agreement currency) and — per row —
 * the explicit "amount includes the COD collection fee" choice, with a live
 * prepaid / COD preview. One footer action saves everything: a new draft
 * (number generated), the draft, or — on the ACTIVE agreement (R17 §2) — a
 * new version in force from the save instant (the API validates and audits).
 */
export function ShippingAgreementEditorDialog({
  agentId,
  currencyCode,
  target,
  defaultFrom,
  onOpenChange,
  onChanged,
}: {
  agentId: string;
  currencyCode: string;
  target: ShippingEditorTarget;
  /** Start date proposed for a new draft ("YYYY-MM-DD"). */
  defaultFrom: string;
  onOpenChange: (open: boolean) => void;
  /** Saved — the section reloads and selects the returned agreement. */
  onChanged: (agreement: ShippingAgreementDetail) => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const countries = useCountries();
  const agreement = target.kind === "new" ? null : target.agreement;
  const [initialPeriod] = useState<PeriodForm>(() =>
    agreement ? periodOf(agreement) : { effectiveFrom: defaultFrom, effectiveTo: "" },
  );
  const [initialTerms] = useState<ShippingTermsForm>(() => termsFormFrom(agreement));
  const [period, setPeriod] = useState(initialPeriod);
  const [form, setForm] = useState(initialTerms);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const withPeriod = target.kind !== "version";
  const periodError = !withPeriod
    ? null
    : !period.effectiveFrom
      ? "from"
      : period.effectiveTo && period.effectiveTo < period.effectiveFrom
        ? "range"
        : null;
  // The simple form always carries the default rate for a new agreement.
  const terms = termsInputFrom(form, { requireDefault: target.kind === "new" });
  const errors = showErrors ? terms.errors : null;
  const dirty =
    JSON.stringify(period) !== JSON.stringify(initialPeriod) ||
    termsSignature(form) !== termsSignature(initialTerms);

  const countryOptions = useMemo(
    () =>
      countries.map((country) => ({
        value: country.id,
        label: (locale === "en" ? country.nameEn : null) ?? country.name,
        searchText: `${country.code} ${country.name} ${country.nameEn ?? ""}`,
      })),
    [countries, locale],
  );
  const serviceOptions = RATE_SERVICES.map((service) => ({
    value: service,
    label: t(`agentShippingAgreements.services.${service}`),
  }));

  const setExtra = (key: string, patch: Partial<ExtraRateForm>) =>
    setForm((current) => ({
      ...current,
      extras: current.extras.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));

  const submit = async () => {
    if (periodError || !terms.input) {
      setShowErrors(true);
      return;
    }
    const notes = form.notes.trim() || null;
    setIsSaving(true);
    try {
      if (target.kind === "version") {
        const saved = await shippingAgreementsApi.createVersion(agentId, target.agreement.id, {
          ...terms.input,
          notes,
        });
        toast.success(
          t("agentShippingAgreements.toasts.versioned", {
            number: saved.agreementNumber,
            version: saved.versionNumber,
          }),
        );
        onChanged(saved);
      } else {
        const dto = {
          effectiveFrom: period.effectiveFrom,
          effectiveTo: period.effectiveTo || null,
          notes,
          ...terms.input,
        };
        const saved =
          target.kind === "draft"
            ? await shippingAgreementsApi.update(agentId, target.agreement.id, dto)
            : await shippingAgreementsApi.create(agentId, dto);
        toast.success(
          target.kind === "draft"
            ? t("agentShippingAgreements.toasts.saved")
            : t("agentShippingAgreements.toasts.created", { number: saved.agreementNumber }),
        );
        onChanged(saved);
      }
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const errorText = (code: string | undefined) =>
    code ? t(`agentShippingAgreements.editor.errors.${code}` as MessageKey) : null;
  const money = (label: string) => `${label} (${currencyCode})`;

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={
        target.kind === "version"
          ? t("agentShippingAgreements.editor.versionTitle", {
              number: target.agreement.agreementNumber,
            })
          : target.kind === "draft"
            ? t("agentShippingAgreements.editor.editTitle", {
                number: target.agreement.agreementNumber,
              })
            : t("agentShippingAgreements.editor.newTitle")
      }
      description={t("agentShippingAgreements.description")}
      isDirty={dirty}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          // A new draft can be created as proposed; an existing one only when edited.
          submitDisabled={target.kind !== "new" && !dirty}
          submitLabel={
            target.kind === "version"
              ? t("agentShippingAgreements.editor.saveVersion")
              : target.kind === "draft"
                ? t("common.save")
                : t("agentShippingAgreements.editor.createDraft")
          }
        />
      )}
    >
      <FormCardStack>
        {target.kind === "version" ? (
          <AgreementVersionNotice
            agreementNumber={target.agreement.agreementNumber}
            versionNumber={target.agreement.versionNumber}
          />
        ) : null}

        {withPeriod ? (
          <FormCardSection title={t("agentShippingAgreements.editor.period")}>
            <FormCardRow>
              <FormCardField
                size="sm"
                required
                label={t("agentShippingAgreements.editor.from")}
                htmlFor={`${fieldId}-from`}
                message={
                  <FieldNote
                    error={
                      showErrors && periodError === "from"
                        ? t("agentShippingAgreements.editor.errors.from")
                        : null
                    }
                  />
                }
              >
                <EnterpriseDatePicker
                  id={`${fieldId}-from`}
                  value={fromISODate(period.effectiveFrom)}
                  onChange={(date) =>
                    setPeriod((current) => ({
                      ...current,
                      effectiveFrom: date ? toISODate(date) : "",
                    }))
                  }
                />
              </FormCardField>
              <FormCardField
                size="sm"
                label={t("agentShippingAgreements.editor.to")}
                htmlFor={`${fieldId}-to`}
                message={
                  <FieldNote
                    error={
                      showErrors && periodError === "range"
                        ? t("agentShippingAgreements.editor.errors.range")
                        : null
                    }
                    hint={t("agentShippingAgreements.editor.toHint")}
                  />
                }
              >
                <EnterpriseDatePicker
                  id={`${fieldId}-to`}
                  value={fromISODate(period.effectiveTo)}
                  onChange={(date) =>
                    setPeriod((current) => ({
                      ...current,
                      effectiveTo: date ? toISODate(date) : "",
                    }))
                  }
                />
              </FormCardField>
            </FormCardRow>
          </FormCardSection>
        ) : null}

        <FormCardSection
          title={t("agentShippingAgreements.editor.charges")}
          description={t("agentShippingAgreements.editor.chargesHint")}
        >
          <FormCardRow>
            <FormCardField
              size="sm"
              required={target.kind === "new"}
              label={money(t("agentShippingAgreements.editor.defaultRate"))}
              htmlFor={`${fieldId}-default`}
              message={
                <FieldNote
                  error={errorText(errors?.defaultAmount)}
                  hint={t("agentShippingAgreements.editor.defaultRateHint")}
                />
              }
            >
              <MoneyInput
                id={`${fieldId}-default`}
                value={form.defaultAmount}
                aria-invalid={!!errors?.defaultAmount}
                onChange={(event) =>
                  setForm((current) => ({ ...current, defaultAmount: event.target.value }))
                }
              />
            </FormCardField>
            <FormCardField
              size="sm"
              label={money(t("agentShippingAgreements.editor.codFee"))}
              htmlFor={`${fieldId}-codFee`}
              message={
                <FieldNote
                  error={errorText(errors?.codCollectionFee)}
                  hint={t("agentShippingAgreements.editor.codFeeHint")}
                />
              }
            >
              <MoneyInput
                id={`${fieldId}-codFee`}
                value={form.codCollectionFee}
                aria-invalid={!!errors?.codCollectionFee}
                onChange={(event) =>
                  setForm((current) => ({ ...current, codCollectionFee: event.target.value }))
                }
              />
            </FormCardField>
          </FormCardRow>
          <IncludesFeeChoice
            id={`${fieldId}-default-includes`}
            checked={form.defaultIncludesCodFee}
            onChange={(checked) =>
              setForm((current) => ({ ...current, defaultIncludesCodFee: checked }))
            }
          />
          <ChargePreviewLine
            service="ANY"
            amount={form.defaultAmount}
            fee={form.codCollectionFee}
            includesCodFee={form.defaultIncludesCodFee}
            currency={currencyCode}
          />

          {form.extras.map((row, index) => (
            <div
              key={row.key}
              className="flex flex-col gap-1.5 border-t border-border pt-2"
              data-testid="extra-rate"
            >
              <FormCardRow>
                <FormCardField
                  size="md"
                  required
                  label={t("agentShippingAgreements.editor.service")}
                  htmlFor={`${fieldId}-${row.key}-service`}
                >
                  <SearchableSelect
                    id={`${fieldId}-${row.key}-service`}
                    value={row.service}
                    onValueChange={(value) =>
                      setExtra(row.key, { service: value as AgentShippingRateService })
                    }
                    options={serviceOptions}
                  />
                </FormCardField>
                <FormCardField
                  size="md"
                  label={t("agentShippingAgreements.editor.country")}
                  htmlFor={`${fieldId}-${row.key}-country`}
                >
                  <SearchableSelect
                    id={`${fieldId}-${row.key}-country`}
                    value={row.countryId}
                    allowClear
                    onValueChange={(value) => setExtra(row.key, { countryId: value })}
                    options={countryOptions}
                    placeholder={t("agentShippingAgreements.allDestinations")}
                  />
                </FormCardField>
                <FormCardField
                  size="sm"
                  label={t("agentShippingAgreements.editor.city")}
                  htmlFor={`${fieldId}-${row.key}-city`}
                >
                  <Input
                    id={`${fieldId}-${row.key}-city`}
                    maxLength={120}
                    value={row.city}
                    onChange={(event) => setExtra(row.key, { city: event.target.value })}
                  />
                </FormCardField>
                <FormCardField
                  size="sm"
                  required
                  label={money(t("agentShippingAgreements.editor.amount"))}
                  htmlFor={`${fieldId}-${row.key}-amount`}
                  message={<FieldNote error={errorText(errors?.extras[row.key])} />}
                >
                  <MoneyInput
                    id={`${fieldId}-${row.key}-amount`}
                    value={row.amount}
                    aria-invalid={!!errors?.extras[row.key]}
                    onChange={(event) => setExtra(row.key, { amount: event.target.value })}
                  />
                </FormCardField>
              </FormCardRow>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  {pricesCod(row.service) ? (
                    <IncludesFeeChoice
                      id={`${fieldId}-${row.key}-includes`}
                      checked={row.includesCodFee}
                      onChange={(checked) => setExtra(row.key, { includesCodFee: checked })}
                    />
                  ) : null}
                  <ChargePreviewLine
                    service={row.service}
                    amount={row.amount}
                    fee={form.codCollectionFee}
                    includesCodFee={row.includesCodFee}
                    currency={currencyCode}
                  />
                </div>
                <IconActionButton
                  label={t("agentShippingAgreements.editor.removeRate", { index: index + 1 })}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      extras: current.extras.filter((item) => item.key !== row.key),
                    }))
                  }
                >
                  <Trash2 className="size-3.5" />
                </IconActionButton>
              </div>
            </div>
          ))}
          <div>
            <EnterpriseButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setForm((current) => ({ ...current, extras: [...current.extras, newExtraRate()] }))
              }
            >
              <Plus />
              {t("agentShippingAgreements.editor.addRate")}
            </EnterpriseButton>
          </div>
        </FormCardSection>

        <FormCardSection title={t("agentShippingAgreements.editor.notes")}>
          <FormCardField
            size="lg"
            label={t("agentShippingAgreements.editor.notes")}
            htmlFor={`${fieldId}-notes`}
          >
            <Textarea
              id={`${fieldId}-notes`}
              rows={2}
              maxLength={2000}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}

/** The explicit per-row choice: the amount already includes the COD collection fee. */
function IncludesFeeChoice({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-caption select-none">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {t("agentShippingAgreements.editor.includesCodFee")}
    </label>
  );
}
