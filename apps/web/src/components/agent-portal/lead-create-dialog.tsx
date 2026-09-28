"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { OMSPhoneInput } from "@/components/shared/phone-input";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { FieldMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { localizedName } from "@/config/agent-portal/labels";
import {
  agentPortalService,
  type CountryRef,
  type FulfillmentMethod,
  type PortalLead,
  type PortalProduct,
} from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError } from "@/lib/toast";

/**
 * New agent lead (spec §6.1): customer, mobile, country, city/address, the
 * product the customer wants and how they want to receive it (the
 * conversion form defaults from it). The lead stays inside the agent — the
 * server sets the agent, owner and source.
 */
export function LeadCreateDialog({
  open,
  onOpenChange,
  countries,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  countries: Array<CountryRef & { code: string }>;
  onCreated: (lead: PortalLead) => void;
}) {
  const { t, locale } = useLocale();
  const fieldId = useId();
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [countryId, setCountryId] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [method, setMethod] = useState<FulfillmentMethod>("SHIPPING");
  const [products, setProducts] = useState<PortalProduct[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomerName("");
    setMobile("");
    setCountryId(countries.length === 1 ? countries[0].id : "");
    setCity("");
    setAddress("");
    setProductId("");
    setQuantity("1");
    setMethod("SHIPPING");
    setShowErrors(false);
    agentPortalService
      .products({ pageSize: 200 })
      .then((page) => setProducts(page.items))
      .catch(() => setProducts([]));
  }, [open, countries]);

  const countryCode = countries.find((country) => country.id === countryId)?.code ?? null;
  const quantityValue = Number(quantity);
  const quantityValid = !productId || (Number.isInteger(quantityValue) && quantityValue > 0);
  const valid = !!customerName.trim() && !!mobile.trim() && !!countryId && quantityValid;
  const required = t("agentPortal.leads.errors.required");

  const productOptions = useMemo(
    () =>
      (products ?? []).map((product) => ({
        value: product.id,
        label: localizedName(product, locale),
        description: product.sku,
        searchText: [product.name, product.nameEn, product.sku].filter(Boolean).join(" "),
      })),
    [products, locale],
  );

  const submit = async () => {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const lead = await agentPortalService.leads.create({
        customerName: customerName.trim(),
        mobileNumber: mobile.trim(),
        countryId,
        city: city.trim() || undefined,
        address: address.trim() || undefined,
        productId: productId || undefined,
        quantity: productId ? quantityValue : undefined,
        fulfillmentMethod: method,
      });
      // The host confirms (toast with the follow-up link) and refreshes its list.
      onCreated(lead);
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "agentPortal.leads.toasts.createFailed");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      icon={UserPlus}
      title={t("agentPortal.leads.createTitle")}
      description={t("agentPortal.leads.createDescription")}
      isDirty={!!(customerName || mobile || city || address || productId)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agentPortal.leads.detail.customer")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agentPortal.leads.fields.customerName")}
              htmlFor={`${fieldId}-name`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !customerName.trim() ? required : null}
                </FieldMessage>
              }
            >
              <Input
                id={`${fieldId}-name`}
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </FormCardField>
            <FormCardField
              size="md"
              required
              label={t("agentPortal.leads.fields.country")}
              htmlFor={`${fieldId}-country`}
              message={
                <FieldMessage announce={false}>
                  {countries.length === 0
                    ? t("agentPortal.leads.noCountries")
                    : showErrors && !countryId
                      ? required
                      : null}
                </FieldMessage>
              }
            >
              <SearchableSelect
                id={`${fieldId}-country`}
                value={countryId}
                onValueChange={setCountryId}
                placeholder={t("agentPortal.leads.choose")}
                error={showErrors && !countryId}
                options={countries.map((country) => ({
                  value: country.id,
                  label: localizedName(country, locale),
                  searchText: [country.name, country.nameEn, country.code]
                    .filter(Boolean)
                    .join(" "),
                }))}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agentPortal.leads.fields.mobile")}
              htmlFor={`${fieldId}-mobile`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !mobile.trim() ? required : null}
                </FieldMessage>
              }
            >
              <OMSPhoneInput
                id={`${fieldId}-mobile`}
                value={mobile}
                onChange={setMobile}
                countryCode={countryCode}
                aria-invalid={(showErrors && !mobile.trim()) || undefined}
              />
            </FormCardField>
            <FormCardField
              size="md"
              label={t("agentPortal.leads.fields.city")}
              htmlFor={`${fieldId}-city`}
            >
              <Input
                id={`${fieldId}-city`}
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardField
            label={t("agentPortal.leads.fields.address")}
            htmlFor={`${fieldId}-address`}
          >
            <Input
              id={`${fieldId}-address`}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
        <FormCardSection title={t("agentPortal.leads.detail.interest")}>
          <FormCardRow>
            <FormCardField
              size="lg"
              label={t("agentPortal.leads.fields.product")}
              htmlFor={`${fieldId}-product`}
            >
              <SearchableSelect
                id={`${fieldId}-product`}
                value={productId}
                onValueChange={setProductId}
                allowClear
                loading={products === null}
                placeholder={t("agentPortal.orderForm.chooseProduct")}
                emptyText={t("agentPortal.orderForm.noProducts")}
                options={productOptions}
              />
            </FormCardField>
            <FormCardField
              size="xs"
              label={t("agentPortal.leads.fields.quantity")}
              htmlFor={`${fieldId}-qty`}
              message={
                <FieldMessage announce={false}>
                  {showErrors && !quantityValid ? t("agentPortal.leads.errors.quantity") : null}
                </FieldMessage>
              }
            >
              <Input
                id={`${fieldId}-qty`}
                dir="ltr"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className="text-end tabular-nums"
                value={quantity}
                disabled={!productId}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </FormCardField>
          </FormCardRow>
          <FormCardField label={t("agentPortal.leads.fields.fulfillmentMethod")}>
            <SegmentedRadioGroup
              value={method}
              onValueChange={setMethod}
              options={(["SHIPPING", "PICKUP"] as const).map((value) => ({
                value,
                label: t(`agentPortal.status.method.${value}`),
              }))}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
