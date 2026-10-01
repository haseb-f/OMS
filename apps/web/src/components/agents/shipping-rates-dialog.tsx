"use client";

import { useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/shared/money-input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { MoneyValue } from "@/components/shared/money-value";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import {
  agentsService,
  type AgentAgreement,
  type AgentShippingRate,
  type TariffDeliveryChannel,
  type TariffPaymentType,
} from "@/services/agents-service";
import { TARIFF_CELLS, tariffMatrix, type TariffMatrixRow } from "@/config/agents/shipping-tariffs";
import { useCountries } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, toast } from "@/lib/toast";

const CHANNELS: TariffDeliveryChannel[] = ["ANY", "CARRIER", "INTERNAL_COURIER"];
const PAYMENT_TYPES: TariffPaymentType[] = ["ANY", "PREPAID", "CASH_ON_DELIVERY"];

/**
 * Agent shipping tariffs of one agreement (spec-2-agent-pricing.md 2B):
 * destination (country + optional city) x delivery channel x payment type.
 * The matrix shows the fee each combination resolves to (most specific row
 * wins) so a missing combination is visible before Shipping meets it.
 * Editable only while the agreement is a DRAFT; read-only afterwards.
 */
export function ShippingRatesDialog({
  agentId,
  agreement,
  canManage,
  onOpenChange,
  onChanged,
}: {
  agentId: string;
  agreement: AgentAgreement;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (agreement: AgentAgreement) => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const countries = useCountries();
  const [rates, setRates] = useState<AgentShippingRate[]>(agreement.shippingRates);
  const [countryId, setCountryId] = useState("");
  const [city, setCity] = useState("");
  const [amount, setAmount] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState<TariffDeliveryChannel>("ANY");
  const [paymentType, setPaymentType] = useState<TariffPaymentType>("ANY");
  const [isSaving, setIsSaving] = useState(false);
  const editable = canManage && agreement.status === "DRAFT";
  const currency = agreement.currency?.code ?? "";

  const countryOptions = useMemo(
    () =>
      countries.map((country) => ({
        value: country.id,
        label: country.name,
        searchText: `${country.code} ${(country as { nameEn?: string | null }).nameEn ?? ""}`,
      })),
    [countries],
  );

  const apply = (updated: AgentAgreement) => {
    setRates(updated.shippingRates);
    onChanged(updated);
  };

  const add = async () => {
    const value = Number(amount);
    if (!countryId || amount.trim() === "" || !Number.isFinite(value) || value < 0) return;
    setIsSaving(true);
    try {
      const updated = await agentsService.agreements.upsertRate(agentId, agreement.id, {
        countryId,
        city: city.trim() || undefined,
        deliveryChannel,
        paymentType,
        amount: value,
      });
      apply(updated);
      setAmount("");
      toast.success(t("agentPricing.tariffs.saved"));
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (rate: AgentShippingRate) => {
    try {
      const updated = await agentsService.agreements.removeRate(agentId, agreement.id, rate.id);
      apply(updated);
      toast.success(t("agents.agreements.toasts.rateRemoved"));
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    }
  };

  const countryName = (countryIdValue: string) => {
    const row = rates.find((rate) => rate.countryId === countryIdValue)?.country;
    return (locale === "en" ? row?.nameEn : null) ?? row?.name ?? countryIdValue;
  };
  const destination = (row: { countryId: string; city: string }) => (
    <span className="flex flex-col">
      <span>{countryName(row.countryId)}</span>
      <span className="text-caption text-muted-foreground">
        {row.city || t("agents.agreements.rates.wholeCountry")}
      </span>
    </span>
  );
  const matrix = useMemo(() => tariffMatrix(rates), [rates]);
  const matrixColumns: CompactDetailColumn<TariffMatrixRow<AgentShippingRate>>[] = [
    { id: "destination", header: t("agentPricing.tariffs.destination"), cell: destination },
    ...TARIFF_CELLS.map((cell) => ({
      id: cell.key,
      align: "end" as const,
      header: (
        <span className="flex flex-col items-end leading-tight">
          <span>{t(`agentPricing.tariffs.channels.${cell.channel}`)}</span>
          <span className="text-micro font-normal text-muted-foreground">
            {t(`agentPricing.tariffs.paymentTypes.${cell.paymentType}`)}
          </span>
        </span>
      ),
      cell: (row: TariffMatrixRow<AgentShippingRate>) => {
        const resolved = row.cells[cell.key];
        return resolved ? (
          <MoneyValue value={resolved.amount} currency={currency} />
        ) : (
          <span className="text-caption text-warning-soft-foreground">
            {t("agentPricing.tariffs.notConfigured")}
          </span>
        );
      },
    })),
  ];

  const columns: CompactDetailColumn<AgentShippingRate>[] = [
    { id: "destination", header: t("agentPricing.tariffs.destination"), cell: destination },
    {
      id: "channel",
      header: t("agentPricing.tariffs.channel"),
      cell: (rate) => t(`agentPricing.tariffs.channels.${rate.deliveryChannel}`),
    },
    {
      id: "paymentType",
      header: t("agentPricing.tariffs.paymentType"),
      cell: (rate) => t(`agentPricing.tariffs.paymentTypes.${rate.paymentType}`),
    },
    {
      id: "amount",
      header: t("agents.agreements.rates.amount"),
      align: "end",
      cell: (rate) => <MoneyValue value={rate.amount} currency={currency} />,
    },
    ...(editable
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (rate: AgentShippingRate) => (
              <IconActionButton label={t("common.remove")} onClick={() => void remove(rate)}>
                <Trash2 className="size-3.5" />
              </IconActionButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={t("agentPricing.tariffs.title")}
      description={`${agreement.agreementNumber} · ${t("agentPricing.tariffs.description")}`}
      footer={
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          {t("common.close")}
        </EnterpriseButton>
      }
    >
      <FormCardStack>
        {editable ? (
          <FormCardSection title={t("agentPricing.tariffs.add")}>
            <FormCardRow>
              <FormCardField
                size="md"
                required
                label={t("agents.agreements.rates.country")}
                htmlFor={`${fieldId}-country`}
              >
                <SearchableSelect
                  id={`${fieldId}-country`}
                  value={countryId}
                  onValueChange={setCountryId}
                  options={countryOptions}
                  placeholder={t("agents.agreements.choose")}
                />
              </FormCardField>
              <FormCardField
                size="sm"
                label={t("agents.agreements.rates.city")}
                htmlFor={`${fieldId}-city`}
                message={
                  <p className="text-caption text-muted-foreground">
                    {t("agents.agreements.rates.cityHint")}
                  </p>
                }
              >
                <Input
                  id={`${fieldId}-city`}
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                />
              </FormCardField>
              <FormCardField
                size="sm"
                required
                label={`${t("agents.agreements.rates.amount")} (${currency})`}
                htmlFor={`${fieldId}-amount`}
              >
                <MoneyInput
                  id={`${fieldId}-amount`}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormCardField>
            </FormCardRow>
            <FormCardRow>
              <FormCardField size="md" label={t("agentPricing.tariffs.channel")}>
                <SegmentedRadioGroup
                  aria-label={t("agentPricing.tariffs.channel")}
                  value={deliveryChannel}
                  onValueChange={setDeliveryChannel}
                  options={CHANNELS.map((value) => ({
                    value,
                    label: t(`agentPricing.tariffs.channels.${value}`),
                  }))}
                />
              </FormCardField>
              <FormCardField size="md" label={t("agentPricing.tariffs.paymentType")}>
                <SegmentedRadioGroup
                  aria-label={t("agentPricing.tariffs.paymentType")}
                  value={paymentType}
                  onValueChange={setPaymentType}
                  options={PAYMENT_TYPES.map((value) => ({
                    value,
                    label: t(`agentPricing.tariffs.paymentTypes.${value}`),
                  }))}
                />
              </FormCardField>
            </FormCardRow>
            <div>
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                isLoading={isSaving}
                disabled={isSaving || !countryId || amount.trim() === ""}
                onClick={() => void add()}
              >
                {t("agentPricing.tariffs.add")}
              </EnterpriseButton>
            </div>
          </FormCardSection>
        ) : (
          <p className="text-caption text-muted-foreground">
            {t("agents.agreements.rates.readOnly")}
          </p>
        )}
        {matrix.length > 0 ? (
          <FormCardSection title={t("agentPricing.tariffs.matrixTitle")}>
            <p className="text-caption text-muted-foreground">
              {t("agentPricing.tariffs.matrixHint")}
            </p>
            <CompactDetailTable
              columns={matrixColumns}
              rows={matrix}
              rowKey={(row) => row.key}
              stacked
            />
          </FormCardSection>
        ) : null}
        <FormCardSection title={t("agentPricing.tariffs.rowsTitle")}>
          <CompactDetailTable
            columns={columns}
            rows={rates}
            rowKey={(rate) => rate.id}
            empty={t("agents.agreements.rates.empty")}
            stacked
          />
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
