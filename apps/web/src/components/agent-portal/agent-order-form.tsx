"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Banknote,
  CreditCard,
  Loader2,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Plus,
  Store,
  Trash2,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FieldMessage, RequiredMark } from "@/components/ui/form";
import { FormSection } from "@/components/documents/form-section";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Field, FieldGrid, FormCardField } from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { OMSPhoneInput } from "@/components/shared/phone-input";
import { DEFAULT_PHONE_COUNTRY } from "@/services/phone-service";
import { MoneyInput } from "@/components/shared/money-input";
import { MoneyValue } from "@/components/shared/money-value";
import { IconActionButton } from "@/components/shared/icon-action-button";
import { Label } from "@/components/ui/label";
import { newIdempotencyKey } from "@/components/payments/declaration/declaration-logic";
import {
  buildConvertLeadInput,
  buildCreateOrderInput,
  buildPricingInput,
  emptyOrderForm,
  localizedApiMessage,
  newLineDraft,
  orderFormErrors,
  workedHint,
  type OrderFormError,
  type OrderFormState,
  type OrderLineDraft,
  type WorkedHintKind,
} from "@/config/agent-portal/order-form";
import type { MessageKey } from "@/i18n/translate";
import { localizedName } from "@/config/agent-portal/labels";
import {
  agentPortalService,
  type CountryRef,
  type CurrencyRef,
  type FulfillmentMethod,
  type OrderQuote,
  type PaymentType,
  type PortalLead,
  type PortalProduct,
  type PricingMode,
} from "@/services/agent-portal-service";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocale } from "@/providers/locale-provider";
import { formatMoney } from "@/lib/money";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { shippingBlockerKey } from "@/components/shipping/shipping-handoff-notice";
import { OrderBreakdown } from "./order-breakdown";
import { DuplicateCustomerPanel } from "@/components/business/duplicate-customer-panel";
import { useDuplicateCheck } from "@/hooks/use-duplicate-check";
import { duplicateFromError, orderDuplicatesService } from "@/services/order-duplicates-service";

const QUOTE_DEBOUNCE_MS = 400;

const PRICING_MODES: PricingMode[] = ["SHIPPING_ADDED", "SHIPPING_INCLUDED"];
/** Leading icons of the segmented choices (design-system §12.12). */
const CHOICE_ICON: Record<FulfillmentMethod | PaymentType | PricingMode, LucideIcon> = {
  SHIPPING: Truck,
  PICKUP: Store,
  PREPAID: CreditCard,
  CASH_ON_DELIVERY: Banknote,
  SHIPPING_ADDED: PackagePlus,
  SHIPPING_INCLUDED: PackageCheck,
};

const HINT_KEYS: Record<WorkedHintKind, MessageKey> = {
  included: "agentPortal.orderForm.breakdown.hintIncluded",
  includedService: "agentPortal.orderForm.breakdown.hintIncludedService",
  added: "agentPortal.orderForm.breakdown.hintAdded",
  addedService: "agentPortal.orderForm.breakdown.hintAddedService",
};

type QuoteState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; quote: OrderQuote }
  | { status: "failed"; key: string; message: string };

function formFromLead(lead: PortalLead, method: FulfillmentMethod): OrderFormState {
  const base = emptyOrderForm();
  return {
    ...base,
    customerName: lead.customerName,
    mobile: lead.mobileNumber,
    countryId: lead.country?.id ?? "",
    city: lead.city ?? "",
    address: lead.address ?? "",
    fulfillmentMethod: method,
    lines: lead.product
      ? [
          newLineDraft(
            lead.product.id,
            String(lead.quantity && lead.quantity > 0 ? lead.quantity : 1),
          ),
        ]
      : base.lines,
  };
}

/**
 * Agent order entry (spec §5): customer, fulfillment, payment type, product
 * lines and the two pricing modes — "Shipping added" (line amounts; the
 * configured shipping rate is added) and "Shipping included" (the agreed
 * total; shipping comes out of it). A live breakdown from
 * `POST /agent-portal/orders/quote` (debounced) shows every figure and the
 * server's issues; saving is disabled until the quote is valid and current.
 * With a `lead`, the customer comes from the lead and saving converts it.
 */
export function AgentOrderForm({
  lead,
  initialMethod = "SHIPPING",
  countries,
  currency,
}: {
  lead?: PortalLead | null;
  initialMethod?: FulfillmentMethod;
  countries: Array<CountryRef & { code: string }>;
  currency: CurrencyRef | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const fieldId = useId();
  const [state, setState] = useState<OrderFormState>(() =>
    lead
      ? formFromLead(lead, initialMethod)
      : { ...emptyOrderForm(), fulfillmentMethod: initialMethod },
  );
  const [products, setProducts] = useState<PortalProduct[] | null>(null);
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // R12: the destination country proposes the calling code; the calling code is a separate choice
  // (a foreign number for a local customer) - once picked, or once a number is typed, it stays.
  const [phoneCodeOverride, setPhoneCodeOverride] = useState<string | null>(null);
  // One idempotency key per form instance: a retried or double submit returns the first order.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const requestSeq = useRef(0);
  // Round 5 Spec 1B — duplicate customer warning inside the caller's agent.
  const phoneRegionCountryId = phoneCodeOverride
    ? (countries.find((country) => country.code === phoneCodeOverride)?.id ?? null)
    : null;
  const duplicates = useDuplicateCheck({
    phone: lead ? lead.mobileNumber : state.mobile,
    name: lead ? lead.customerName : state.customerName,
    countryId: lead ? (lead.country?.id ?? null) : (phoneRegionCountryId ?? state.countryId),
    enabled: true,
    check: orderDuplicatesService.checkAsAgent,
  });

  useEffect(() => {
    agentPortalService
      .products({ pageSize: 200 })
      .then((page) => setProducts(page.items))
      .catch((error) => {
        setProducts([]);
        reportApiError(error, "agentPortal.common.loadFailed");
      });
  }, []);

  useEffect(() => {
    // A single destination country is a safe default (never guessed among several).
    if (!state.countryId && countries.length === 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((prev) => ({ ...prev, countryId: countries[0].id }));
    }
  }, [countries, state.countryId]);

  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );
  const pricingInput = useMemo(() => buildPricingInput(state), [state]);
  const pricingKey = pricingInput ? JSON.stringify(pricingInput) : "";
  const debouncedKey = useDebouncedValue(pricingKey, QUOTE_DEBOUNCE_MS);

  useEffect(() => {
    if (!debouncedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote({ status: "idle" });
      return;
    }
    const seq = ++requestSeq.current;
    setQuote({ status: "loading", key: debouncedKey });
    agentPortalService.orders
      .quote(JSON.parse(debouncedKey))
      .then((result) => {
        if (seq === requestSeq.current)
          setQuote({ status: "ready", key: debouncedKey, quote: result });
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current) return;
        setQuote({
          status: "failed",
          key: debouncedKey,
          message:
            error instanceof Error && error.message
              ? error.message
              : t("agentPortal.orderForm.breakdown.failed"),
        });
      });
  }, [debouncedKey, t]);

  const set = (patch: Partial<OrderFormState>) => setState((prev) => ({ ...prev, ...patch }));
  const setLine = (key: string, patch: Partial<OrderLineDraft>) =>
    setState((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));

  const errors = orderFormErrors(state, { requireCustomer: !lead });
  const has = (error: OrderFormError) => showErrors && errors.includes(error);
  const readyQuote = quote.status === "ready" ? quote.quote : null;
  const quoteCurrent = quote.status === "ready" && quote.key === pricingKey;
  const quoteIssues = readyQuote?.issues ?? [];
  const lineIssues = (index: number) =>
    quoteIssues.filter((issue) => issue.lineKey === String(index));
  const shippingApplies = state.fulfillmentMethod === "SHIPPING" && !readyQuote?.digitalOnly;
  const overrideAllowed = !!readyQuote?.shipping.overrideAllowed && shippingApplies;
  const canSubmit =
    errors.length === 0 && quoteCurrent && !!readyQuote?.valid && !isSaving && !duplicates.blocked;
  const hint = quoteCurrent ? workedHint(readyQuote) : null;
  const money = (value: number) => formatMoney(value, currency?.code ?? null);

  const countryCode = countries.find((country) => country.id === state.countryId)?.code ?? null;
  const phoneRegion = phoneCodeOverride ?? countryCode;
  const productOptions = useMemo(
    () =>
      (products ?? []).map((product) => ({
        value: product.id,
        label: localizedName(product, locale),
        description: product.sku,
        searchText: [product.name, product.nameEn, product.displayName, product.sku]
          .filter(Boolean)
          .join(" "),
      })),
    [products, locale],
  );

  const submit = async () => {
    setShowErrors(true);
    if (!canSubmit) return;
    setIsSaving(true);
    try {
      const resolution = duplicates.resolution
        ? { duplicateResolution: duplicates.resolution }
        : {};
      const created = lead
        ? await agentPortalService.leads.convert(lead.id, {
            ...buildConvertLeadInput(state, idempotencyKey)!,
            ...resolution,
          })
        : await agentPortalService.orders.create({
            ...buildCreateOrderInput(state, idempotencyKey)!,
            ...resolution,
          });
      const href = `/agent/orders/${created.id}`;
      reportSuccess(
        t("agentPortal.orderForm.toasts.created", { number: created.internalOrderId }),
        {
          // R6 SHIP — sent to the company Shipping team, or why not yet.
          description: created.fulfillment.shippingBlocker
            ? t(shippingBlockerKey(created.fulfillment.shippingBlocker))
            : created.fulfillment.shipments.length > 0
              ? t("shippingHandoff.sentToShipping")
              : created.paymentType === "PREPAID"
                ? t("agentPortal.orderForm.toasts.prepaidHint")
                : undefined,
        },
      );
      router.push(href);
    } catch (error) {
      // A customer the panel had not answered — reopen it.
      const duplicate = duplicateFromError(error);
      if (duplicate) duplicates.applyServerResult(duplicate);
      reportApiError(error, "agentPortal.orderForm.toasts.createFailed");
      setIsSaving(false);
    }
  };

  const breakdownPanel = (
    <EnterpriseCard size="sm" className="lg:sticky lg:top-3">
      <EnterpriseCardContent className="flex flex-col gap-3">
        <h2 className="text-body font-semibold">{t("agentPortal.orderForm.sections.breakdown")}</h2>
        {quote.status === "idle" ? (
          <p className="text-caption text-muted-foreground">
            {t("agentPortal.orderForm.breakdown.waiting")}
          </p>
        ) : null}
        {quote.status === "loading" ||
        (pricingKey && quote.status !== "idle" && quote.key !== pricingKey) ? (
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            {t("agentPortal.orderForm.breakdown.checking")}
          </p>
        ) : null}
        {quote.status === "failed" ? (
          <p className="text-caption text-destructive" role="alert">
            {quote.message}
          </p>
        ) : null}
        {readyQuote?.breakdown ? (
          <OrderBreakdown
            figures={readyQuote.breakdown}
            currency={currency}
            shippingSource={readyQuote.shipping.source}
            shippingRate={readyQuote.shipping.rate}
            rateScope={readyQuote.shipping.rateScope}
            provisional={readyQuote.shippingPricingStatus === "PENDING_METHOD"}
            mode={readyQuote.breakdown.mode}
          />
        ) : null}
        {hint ? (
          <p
            className="rounded-sm bg-muted/50 px-2 py-1.5 text-caption text-muted-foreground"
            dir="auto"
          >
            {t(HINT_KEYS[hint.kind], {
              total: money(hint.total),
              shipping: money(hint.shipping),
              merchandise: money(hint.merchandise),
              service: money(hint.service),
            })}
          </p>
        ) : null}
        {quoteIssues.length > 0 ? (
          <div
            className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2"
            role="alert"
          >
            <p className="text-caption font-medium text-destructive-soft-foreground">
              {t("agentPortal.orderForm.breakdown.issues")}
            </p>
            <ul className="flex flex-col gap-0.5">
              {quoteIssues.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className="flex items-start gap-1.5 text-caption text-destructive-soft-foreground"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{localizedApiMessage(issue.message, locale)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <EnterpriseButton
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="w-full"
        >
          {isSaving ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {lead ? t("agentPortal.orderForm.convertSubmit") : t("agentPortal.orderForm.submit")}
        </EnterpriseButton>
        {duplicates.blocked && duplicates.state.status === "ready" ? (
          <p className="text-caption text-destructive">{t("orderDuplicates.required")}</p>
        ) : null}
        {showErrors && errors.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {errors.map((error) => (
              <li key={error} className="text-caption text-destructive">
                {t(`agentPortal.orderForm.errors.${error}`)}
              </li>
            ))}
          </ul>
        ) : null}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <EnterpriseCard size="sm" className="min-w-0">
        <EnterpriseCardContent className="flex min-w-0 flex-col gap-4">
          {lead ? (
            <FormSection title={t("agentPortal.orderForm.sections.customer")}>
              <p className="text-body">
                <span className="font-medium">{lead.customerName}</span>{" "}
                <span className="num text-muted-foreground" dir="ltr">
                  {lead.mobileNumber}
                </span>
              </p>
              <p className="text-caption text-muted-foreground">
                {[localizedName(lead.country, locale), lead.city, lead.address]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <DuplicateCustomerPanel
                state={duplicates.state}
                onChoose={duplicates.choose}
                orderHref={(id) => `/agent/orders/${id}`}
              />
            </FormSection>
          ) : (
            <FormSection title={t("agentPortal.orderForm.sections.customer")}>
              <FieldGrid className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-2 @xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,6fr)]">
                <div>
                  <Field size="md" data-invalid={has("customerName") ? "true" : undefined}>
                    <Label htmlFor={`${fieldId}-name`}>
                      {t("agentPortal.orderForm.fields.customerName")}{" "}
                      <RequiredMark className="ms-0.5" />
                    </Label>
                    <Input
                      id={`${fieldId}-name`}
                      value={state.customerName}
                      aria-invalid={has("customerName") || undefined}
                      onChange={(event) => set({ customerName: event.target.value })}
                    />
                    <FieldMessage announce={false}>
                      {has("customerName") ? t("agentPortal.orderForm.errors.customerName") : null}
                    </FieldMessage>
                  </Field>
                </div>
                <div>
                  <Field size="md" data-invalid={has("country") ? "true" : undefined}>
                    <Label htmlFor={`${fieldId}-country`}>
                      {t("agentPortal.orderForm.fields.country")}
                      {state.fulfillmentMethod === "SHIPPING" ? (
                        <RequiredMark className="ms-0.5" />
                      ) : null}
                    </Label>
                    <SearchableSelect
                      id={`${fieldId}-country`}
                      value={state.countryId}
                      onValueChange={(countryId) => {
                        // A number already typed keeps the calling code it was read with.
                        if (!phoneCodeOverride && state.mobile.trim())
                          setPhoneCodeOverride(countryCode ?? DEFAULT_PHONE_COUNTRY);
                        set({ countryId });
                      }}
                      placeholder={t("agentPortal.leads.choose")}
                      emptyText={t("agentPortal.leads.noCountries")}
                      error={has("country")}
                      options={countries.map((country) => ({
                        value: country.id,
                        label: localizedName(country, locale),
                        searchText: [country.name, country.nameEn, country.code]
                          .filter(Boolean)
                          .join(" "),
                      }))}
                    />
                    <FieldMessage announce={false}>
                      {countries.length === 0
                        ? t("agentPortal.leads.noCountries")
                        : has("country")
                          ? t("agentPortal.orderForm.errors.country")
                          : null}
                    </FieldMessage>
                  </Field>
                </div>
                <div className="@md:col-span-2 @xl:col-span-1">
                  <Field size="md" data-invalid={has("mobile") ? "true" : undefined}>
                    <Label htmlFor={`${fieldId}-mobile`}>
                      {t("agentPortal.orderForm.fields.mobile")} <RequiredMark className="ms-0.5" />
                    </Label>
                    <OMSPhoneInput
                      id={`${fieldId}-mobile`}
                      value={state.mobile}
                      onChange={(mobile) => set({ mobile })}
                      countryCode={phoneRegion}
                      // The calling-code selector inside the field only changes how the number is
                      // read - the destination country (agent tariff) is chosen in its own field.
                      countries={countries}
                      availableCountryCodes={countries.map((country) => country.code)}
                      onCountryChange={(iso2) => {
                        const match = countries.find((country) => country.code === iso2);
                        if (match) setPhoneCodeOverride(match.code);
                      }}
                      forceValidation={showErrors}
                      aria-invalid={has("mobile") || undefined}
                    />
                    <FieldMessage announce={false}>
                      {has("mobile") ? t("agentPortal.orderForm.errors.mobile") : null}
                    </FieldMessage>
                  </Field>
                </div>
              </FieldGrid>
              <FieldGrid className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-[minmax(0,4fr)_minmax(0,11fr)]">
                <Field size="md">
                  <Label htmlFor={`${fieldId}-city`}>
                    {t("agentPortal.orderForm.fields.city")}
                  </Label>
                  <Input
                    id={`${fieldId}-city`}
                    value={state.city}
                    onChange={(event) => set({ city: event.target.value })}
                  />
                </Field>
                <Field size="md">
                  <Label htmlFor={`${fieldId}-address`}>
                    {t("agentPortal.orderForm.fields.address")}
                  </Label>
                  <Input
                    id={`${fieldId}-address`}
                    value={state.address}
                    onChange={(event) => set({ address: event.target.value })}
                  />
                </Field>
              </FieldGrid>
              <DuplicateCustomerPanel
                state={duplicates.state}
                onChoose={duplicates.choose}
                orderHref={(id) => `/agent/orders/${id}`}
                onEditDetails={() => document.getElementById(`${fieldId}-mobile`)?.focus()}
              />
            </FormSection>
          )}

          <FormSection title={t("agentPortal.orderForm.sections.fulfillment")}>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-caption text-muted-foreground" id={`${fieldId}-method`}>
                  {t("agentPortal.orderForm.fields.method")}
                </span>
                <SegmentedRadioGroup
                  aria-labelledby={`${fieldId}-method`}
                  value={state.fulfillmentMethod}
                  onValueChange={(fulfillmentMethod: FulfillmentMethod) =>
                    set({ fulfillmentMethod })
                  }
                  options={(["SHIPPING", "PICKUP"] as const).map((value) => ({
                    value,
                    label: t(`agentPortal.status.method.${value}`),
                    icon: CHOICE_ICON[value],
                  }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-caption text-muted-foreground" id={`${fieldId}-ptype`}>
                  {t("agentPortal.orderForm.fields.paymentType")}
                </span>
                <SegmentedRadioGroup
                  aria-labelledby={`${fieldId}-ptype`}
                  value={state.paymentType}
                  onValueChange={(paymentType: PaymentType) => set({ paymentType })}
                  options={(["PREPAID", "CASH_ON_DELIVERY"] as const).map((value) => ({
                    value,
                    label: t(`agentPortal.status.paymentType.${value}`),
                    icon: CHOICE_ICON[value],
                  }))}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title={t("agentPortal.orderForm.sections.pricing")}>
            <SegmentedRadioGroup
              value={state.pricingMode}
              onValueChange={(pricingMode: PricingMode) => set({ pricingMode })}
              options={PRICING_MODES.map((value) => ({
                value,
                label: t(`agentPortal.orderForm.modes.${value}`),
                icon: CHOICE_ICON[value],
              }))}
            />
            <p className="text-caption text-muted-foreground">
              {t(`agentPortal.orderForm.modeHints.${state.pricingMode}`)}
            </p>
            {state.pricingMode === "SHIPPING_INCLUDED" ? (
              <Field size="sm" data-invalid={has("agreedTotal") ? "true" : undefined}>
                <Label htmlFor={`${fieldId}-total`}>
                  {t("agentPortal.orderForm.fields.agreedTotal")}{" "}
                  <RequiredMark className="ms-0.5" />
                </Label>
                <MoneyInput
                  id={`${fieldId}-total`}
                  value={state.agreedTotal}
                  aria-invalid={has("agreedTotal") || undefined}
                  onChange={(event) => set({ agreedTotal: event.target.value })}
                />
                <FieldMessage announce={false}>
                  {has("agreedTotal") ? t("agentPortal.orderForm.errors.agreedTotal") : null}
                </FieldMessage>
              </Field>
            ) : null}
            {state.serviceChargeEnabled ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field size="sm">
                  <Label htmlFor={`${fieldId}-service`}>
                    {t("agentPortal.orderForm.fields.serviceCharge")}
                  </Label>
                  <MoneyInput
                    id={`${fieldId}-service`}
                    value={state.serviceCharge}
                    onChange={(event) => set({ serviceCharge: event.target.value })}
                  />
                </Field>
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ serviceChargeEnabled: false, serviceCharge: "" })}
                >
                  {t("agentPortal.orderForm.removeServiceCharge")}
                </EnterpriseButton>
              </div>
            ) : (
              <div>
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set({ serviceChargeEnabled: true })}
                >
                  <Plus />
                  {t("agentPortal.orderForm.addServiceCharge")}
                </EnterpriseButton>
              </div>
            )}
          </FormSection>

          <FormSection
            title={t("agentPortal.orderForm.sections.lines")}
            actions={
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ lines: [...state.lines, newLineDraft()] })}
              >
                <Plus />
                {t("agentPortal.orderForm.addLine")}
              </EnterpriseButton>
            }
          >
            {products && products.length === 0 ? (
              <Alert tone="info">
                <PackageOpen />
                <div className="flex flex-col gap-0.5">
                  <AlertTitle>{t("agentPricing.emptyCatalog.title")}</AlertTitle>
                  <AlertDescription>{t("agentPricing.emptyCatalog.agent")}</AlertDescription>
                </div>
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
              {state.lines.map((line, index) => {
                const product = productById.get(line.productId);
                const issues = lineIssues(index);
                const showAmount = state.pricingMode === "SHIPPING_ADDED";
                const amountMissing = has("lineAmount") && showAmount && !line.lineAmount.trim();
                return (
                  <li
                    key={line.key}
                    className="flex flex-col gap-2 rounded-md border border-border p-2 sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_9rem_auto] sm:items-start"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <SearchableSelect
                        aria-label={t("agentPortal.orderForm.fields.product")}
                        value={line.productId}
                        onValueChange={(productId) => setLine(line.key, { productId })}
                        options={productOptions}
                        loading={products === null}
                        placeholder={t("agentPortal.orderForm.chooseProduct")}
                        emptyText={t("agentPortal.orderForm.noProducts")}
                        error={has("lines") && !line.productId}
                      />
                      {product ? (
                        <span className="text-micro text-muted-foreground">
                          {product.listPrice != null
                            ? t("agentPortal.orderForm.fields.listPrice", {
                                amount: money(product.listPrice),
                              })
                            : null}
                          {product.listPrice != null && product.available != null ? " · " : null}
                          {product.available != null
                            ? t("agentPortal.orderForm.fields.available", {
                                count: product.available,
                              })
                            : null}
                        </span>
                      ) : null}
                    </div>
                    <Input
                      aria-label={t("agentPortal.orderForm.fields.quantity")}
                      dir="ltr"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      className="text-end tabular-nums"
                      value={line.quantity}
                      aria-invalid={(has("lines") && !(Number(line.quantity) > 0)) || undefined}
                      onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                    />
                    {showAmount ? (
                      <MoneyInput
                        aria-label={t("agentPortal.orderForm.fields.lineAmount")}
                        placeholder={t("agentPortal.orderForm.fields.lineAmount")}
                        value={line.lineAmount}
                        aria-invalid={amountMissing || undefined}
                        onChange={(event) => setLine(line.key, { lineAmount: event.target.value })}
                      />
                    ) : (
                      <span className="hidden text-end text-caption text-muted-foreground sm:block sm:pt-2">
                        {quoteCurrent && readyQuote?.lines[index]?.lineAmount != null ? (
                          <MoneyValue
                            value={readyQuote.lines[index].lineAmount!}
                            currency={currency}
                          />
                        ) : (
                          "—"
                        )}
                      </span>
                    )}
                    <IconActionButton
                      label={t("agentPortal.orderForm.removeLine")}
                      disabled={state.lines.length === 1}
                      className="self-end sm:self-start"
                      onClick={() =>
                        set({ lines: state.lines.filter((item) => item.key !== line.key) })
                      }
                    >
                      <Trash2 />
                    </IconActionButton>
                    {issues.length > 0 ? (
                      <p className="text-caption text-destructive sm:col-span-4">
                        {issues
                          .map((issue) => localizedApiMessage(issue.message, locale))
                          .join(" ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {has("lines") ? (
              <FieldMessage announce={false}>
                {t("agentPortal.orderForm.errors.lines")}
              </FieldMessage>
            ) : null}
            {has("lineAmount") ? (
              <FieldMessage announce={false}>
                {t("agentPortal.orderForm.errors.lineAmount")}
              </FieldMessage>
            ) : null}
          </FormSection>

          {overrideAllowed || state.overrideShipping ? (
            <FormSection title={t("agentPortal.orderForm.breakdown.shipping")}>
              <label className="flex items-center gap-2 text-body">
                <Switch
                  checked={state.overrideShipping}
                  onCheckedChange={(checked) =>
                    set({
                      overrideShipping: checked,
                      ...(checked ? {} : { shippingOverride: "", shippingOverrideReason: "" }),
                    })
                  }
                />
                {t("agentPortal.orderForm.fields.shippingOverride")}
              </label>
              {state.overrideShipping ? (
                <FieldGrid className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-[10rem_minmax(0,1fr)]">
                  <Field size="sm">
                    <Label htmlFor={`${fieldId}-ship`}>
                      {t("agentPortal.orderForm.fields.shippingOverrideAmount")}
                    </Label>
                    <MoneyInput
                      id={`${fieldId}-ship`}
                      value={state.shippingOverride}
                      onChange={(event) => set({ shippingOverride: event.target.value })}
                    />
                  </Field>
                  <Field size="full" data-invalid={has("overrideReason") ? "true" : undefined}>
                    <Label htmlFor={`${fieldId}-ship-reason`}>
                      {t("agentPortal.orderForm.fields.shippingOverrideReason")}{" "}
                      <RequiredMark className="ms-0.5" />
                    </Label>
                    <Input
                      id={`${fieldId}-ship-reason`}
                      value={state.shippingOverrideReason}
                      aria-invalid={has("overrideReason") || undefined}
                      onChange={(event) => set({ shippingOverrideReason: event.target.value })}
                    />
                    <FieldMessage announce={false}>
                      {has("overrideReason")
                        ? t("agentPortal.orderForm.errors.overrideReason")
                        : null}
                    </FieldMessage>
                  </Field>
                </FieldGrid>
              ) : null}
            </FormSection>
          ) : null}

          <FormSection title={t("agentPortal.orderForm.fields.notes")}>
            <Textarea
              aria-label={t("agentPortal.orderForm.fields.notes")}
              value={state.notes}
              rows={2}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </FormSection>
        </EnterpriseCardContent>
      </EnterpriseCard>
      {breakdownPanel}
    </div>
  );
}
