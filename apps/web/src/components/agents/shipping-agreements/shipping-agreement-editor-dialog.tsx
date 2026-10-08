"use client";

import { useId, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
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
import { MoneyValue } from "@/components/shared/money-value";
import { IconActionButton } from "@/components/shared/icon-action-button";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCountries } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { reportApiError, toast } from "@/lib/toast";
import { FieldNote } from "../field-note";
import {
  shippingAgreementsApi,
  type ShippingAgreementDetail,
  type ShippingAgreementRate,
} from "./shipping-agreements-api";
import {
  EMPTY_RATE_FORM,
  SHIPPING_SERVICES,
  calendarDay,
  destinationName,
  rateInputFrom,
  type RateFormState,
} from "./shipping-agreement-view";

interface PeriodForm {
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
}

const periodOf = (draft: ShippingAgreementDetail): PeriodForm => ({
  effectiveFrom: calendarDay(draft.effectiveFrom),
  effectiveTo: draft.effectiveTo ? calendarDay(draft.effectiveTo) : "",
  notes: draft.notes ?? "",
});

/**
 * New / edit a DRAFT shipping agreement (R15 D15-13): its period and notes
 * (saved with the footer action — a new draft is created by it, with a
 * generated number), then its charges, each added / changed / removed at
 * once by the API (validated, audited). The draft stays a draft until it is
 * activated from the section.
 */
export function ShippingAgreementEditorDialog({
  agentId,
  currencyCode,
  draft: initialDraft,
  defaultFrom,
  onOpenChange,
  onChanged,
}: {
  agentId: string;
  currencyCode: string;
  /** null = a new draft. */
  draft: ShippingAgreementDetail | null;
  /** Start date proposed for a new draft ("YYYY-MM-DD"). */
  defaultFrom: string;
  onOpenChange: (open: boolean) => void;
  /** The draft was created or changed — the section reloads and selects it. */
  onChanged: (draft: ShippingAgreementDetail) => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const countries = useCountries();
  const [draft, setDraft] = useState(initialDraft);
  const [proposed] = useState<PeriodForm>(() => ({
    effectiveFrom: defaultFrom,
    effectiveTo: "",
    notes: "",
  }));
  const [period, setPeriod] = useState<PeriodForm>(() =>
    initialDraft ? periodOf(initialDraft) : proposed,
  );
  const [showPeriodErrors, setShowPeriodErrors] = useState(false);
  const [rateForm, setRateForm] = useState<RateFormState>(EMPTY_RATE_FORM);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [showRateErrors, setShowRateErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRate, setIsSavingRate] = useState(false);

  const periodError = !period.effectiveFrom
    ? "from"
    : period.effectiveTo && period.effectiveTo < period.effectiveFrom
      ? "range"
      : null;
  /** Unsaved period edits (vs the saved draft, or the proposed values of a new one). */
  const periodEdited =
    JSON.stringify(period) !== JSON.stringify(draft ? periodOf(draft) : proposed);
  const rate = rateInputFrom(rateForm);

  const countryOptions = useMemo(
    () =>
      countries.map((country) => ({
        value: country.id,
        label: (locale === "en" ? country.nameEn : null) ?? country.name,
        searchText: `${country.code} ${country.name} ${country.nameEn ?? ""}`,
      })),
    [countries, locale],
  );
  const serviceOptions = SHIPPING_SERVICES.map((service) => ({
    value: service,
    label: t(`agentShippingAgreements.services.${service}`),
  }));

  const applied = (updated: ShippingAgreementDetail) => {
    setDraft(updated);
    onChanged(updated);
  };

  const savePeriod = async () => {
    if (periodError) {
      setShowPeriodErrors(true);
      return;
    }
    const dto = {
      effectiveFrom: period.effectiveFrom,
      effectiveTo: period.effectiveTo || null,
      notes: period.notes.trim() || null,
    };
    setIsSaving(true);
    try {
      if (draft) {
        const updated = await shippingAgreementsApi.update(agentId, draft.id, dto);
        setPeriod(periodOf(updated));
        applied(updated);
        toast.success(t("agentShippingAgreements.toasts.saved"));
      } else {
        const created = await shippingAgreementsApi.create(agentId, dto);
        setPeriod(periodOf(created));
        applied(created);
        toast.success(
          t("agentShippingAgreements.toasts.created", { number: created.agreementNumber }),
        );
      }
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const resetRateForm = () => {
    setRateForm(EMPTY_RATE_FORM);
    setEditingRateId(null);
    setShowRateErrors(false);
  };

  const saveRate = async () => {
    if (!draft) return;
    if (!rate.input) {
      setShowRateErrors(true);
      return;
    }
    setIsSavingRate(true);
    try {
      const updated = editingRateId
        ? await shippingAgreementsApi.updateRate(agentId, draft.id, editingRateId, rate.input)
        : await shippingAgreementsApi.addRate(agentId, draft.id, rate.input);
      applied(updated);
      toast.success(
        t(
          editingRateId
            ? "agentShippingAgreements.toasts.rateUpdated"
            : "agentShippingAgreements.toasts.rateAdded",
        ),
      );
      resetRateForm();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSavingRate(false);
    }
  };

  const editRate = (row: ShippingAgreementRate) => {
    setEditingRateId(row.id);
    setShowRateErrors(false);
    setRateForm({
      service: row.service,
      countryId: row.countryId ?? "",
      city: row.city,
      amount: String(row.amount),
    });
  };

  const removeRate = async (row: ShippingAgreementRate) => {
    if (!draft) return;
    try {
      applied(await shippingAgreementsApi.removeRate(agentId, draft.id, row.id));
      if (editingRateId === row.id) resetRateForm();
      toast.success(t("agentShippingAgreements.toasts.rateRemoved"));
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  const rateError = showRateErrors ? rate.error : null;
  const rateColumns: CompactDetailColumn<ShippingAgreementRate>[] = [
    {
      id: "service",
      header: t("agentShippingAgreements.editor.service"),
      cell: (row) => t(`agentShippingAgreements.services.${row.service}`),
    },
    {
      id: "destination",
      header: t("agentShippingAgreements.destination"),
      cell: (row) => destinationName(row, locale) ?? t("agentShippingAgreements.allDestinations"),
    },
    {
      id: "amount",
      header: t("agentShippingAgreements.editor.amount"),
      align: "end",
      cell: (row) => <MoneyValue value={row.amount} currency={currencyCode} />,
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) => (
        <span className="inline-flex gap-1">
          <IconActionButton label={t("common.edit")} onClick={() => editRate(row)}>
            <Pencil className="size-3.5" />
          </IconActionButton>
          <IconActionButton label={t("common.remove")} onClick={() => void removeRate(row)}>
            <Trash2 className="size-3.5" />
          </IconActionButton>
        </span>
      ),
    },
  ];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={
        draft
          ? t("agentShippingAgreements.editor.editTitle", { number: draft.agreementNumber })
          : t("agentShippingAgreements.editor.newTitle")
      }
      description={t("agentShippingAgreements.description")}
      isDirty={periodEdited || rateForm.amount.trim() !== ""}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void savePeriod()}
          isSubmitting={isSaving}
          // A new draft can be created as proposed; a saved one only when edited.
          submitDisabled={!!draft && !periodEdited}
          submitLabel={draft ? t("common.save") : t("agentShippingAgreements.editor.createDraft")}
        />
      )}
    >
      <FormCardStack>
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
                    showPeriodErrors && periodError === "from"
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
                    showPeriodErrors && periodError === "range"
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
          <FormCardField
            size="lg"
            label={t("agentShippingAgreements.editor.notes")}
            htmlFor={`${fieldId}-notes`}
          >
            <Textarea
              id={`${fieldId}-notes`}
              rows={2}
              maxLength={2000}
              value={period.notes}
              onChange={(event) =>
                setPeriod((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </FormCardField>
        </FormCardSection>

        <FormCardSection
          title={t("agentShippingAgreements.editor.charges")}
          description={
            draft
              ? t("agentShippingAgreements.editor.chargesHint")
              : t("agentShippingAgreements.editor.afterCreate")
          }
        >
          {draft ? (
            <>
              <FormCardRow>
                <FormCardField
                  size="md"
                  required
                  label={t("agentShippingAgreements.editor.service")}
                  htmlFor={`${fieldId}-service`}
                  message={
                    <FieldNote
                      error={
                        rateError === "service"
                          ? t("agentShippingAgreements.editor.errors.service")
                          : null
                      }
                    />
                  }
                >
                  <SearchableSelect
                    id={`${fieldId}-service`}
                    value={rateForm.service}
                    error={rateError === "service"}
                    onValueChange={(value) =>
                      setRateForm((current) => ({
                        ...current,
                        service: value as RateFormState["service"],
                      }))
                    }
                    options={serviceOptions}
                    placeholder={t("common.select")}
                  />
                </FormCardField>
                <FormCardField
                  size="md"
                  label={t("agentShippingAgreements.editor.country")}
                  htmlFor={`${fieldId}-country`}
                  message={
                    <FieldNote
                      error={
                        rateError === "cityNeedsCountry"
                          ? t("agentShippingAgreements.editor.errors.cityNeedsCountry")
                          : null
                      }
                      hint={t("agentShippingAgreements.editor.countryHint")}
                    />
                  }
                >
                  <SearchableSelect
                    id={`${fieldId}-country`}
                    value={rateForm.countryId}
                    allowClear
                    error={rateError === "cityNeedsCountry"}
                    onValueChange={(value) =>
                      setRateForm((current) => ({ ...current, countryId: value }))
                    }
                    options={countryOptions}
                    placeholder={t("agentShippingAgreements.allDestinations")}
                  />
                </FormCardField>
              </FormCardRow>
              <FormCardRow>
                <FormCardField
                  size="md"
                  label={t("agentShippingAgreements.editor.city")}
                  htmlFor={`${fieldId}-city`}
                  message={<FieldNote hint={t("agentShippingAgreements.editor.cityHint")} />}
                >
                  <Input
                    id={`${fieldId}-city`}
                    maxLength={120}
                    value={rateForm.city}
                    onChange={(event) =>
                      setRateForm((current) => ({ ...current, city: event.target.value }))
                    }
                  />
                </FormCardField>
                <FormCardField
                  size="sm"
                  required
                  label={`${t("agentShippingAgreements.editor.amount")} (${currencyCode})`}
                  htmlFor={`${fieldId}-amount`}
                  message={
                    <FieldNote
                      error={
                        rateError === "amount"
                          ? t("agentShippingAgreements.editor.errors.amount")
                          : null
                      }
                    />
                  }
                >
                  <MoneyInput
                    id={`${fieldId}-amount`}
                    value={rateForm.amount}
                    aria-invalid={rateError === "amount"}
                    onChange={(event) =>
                      setRateForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                </FormCardField>
              </FormCardRow>
              <div className="flex flex-wrap gap-2">
                <EnterpriseButton
                  type="button"
                  size="sm"
                  variant="outline"
                  isLoading={isSavingRate}
                  disabled={isSavingRate}
                  onClick={() => void saveRate()}
                >
                  {editingRateId
                    ? t("agentShippingAgreements.editor.update")
                    : t("agentShippingAgreements.editor.add")}
                </EnterpriseButton>
                {editingRateId ? (
                  <EnterpriseButton type="button" size="sm" variant="ghost" onClick={resetRateForm}>
                    {t("agentShippingAgreements.editor.cancelEdit")}
                  </EnterpriseButton>
                ) : null}
              </div>
              <CompactDetailTable
                columns={rateColumns}
                rows={draft.rates}
                rowKey={(row) => row.id}
                empty={t("agentShippingAgreements.editor.noRates")}
                stacked
              />
            </>
          ) : null}
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
