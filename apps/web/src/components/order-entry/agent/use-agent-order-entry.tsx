"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, UserCog } from "lucide-react";
import { FormSection } from "@/components/documents/form-section";
import {
  applyServerFieldErrors,
  formErrorsFromRhf,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { CreateOperationSummary } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import { ComboboxFormField, TextFormField } from "@/components/shared/form-fields";
import { CustomerIdentitySummary } from "@/components/business/customer-identity-summary";
import { EnterpriseButton } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import type { ReceiptUploadItem } from "@/components/business/payment-receipts-field";
import { stagingIdsOf } from "@/components/business/payment-receipts-field";
import { newIdempotencyKey } from "@/components/payments/declaration/declaration-logic";
import {
  buildAgentDeclarationPayload,
  emptyAgentDeclaration,
  validateAgentDeclaration,
  type AgentDeclarationState,
} from "@/config/agent-portal/declaration";
import { localizedName } from "@/config/agent-portal/labels";
import {
  AGENT_ORDER_STEP_FIELDS,
  agentDestinationId,
  agentLineErrors,
  agentOrderEntryDefaults,
  agentOrderStepRouting,
  buildAgentConvertInput,
  buildAgentCreateInput,
  buildAgentOrderEntrySchema,
  buildAgentPricingInput,
  newAgentLine,
  parseQuantity,
  type AgentLineDraft,
  type AgentOrderEntryValues,
} from "@/config/orders/agent-order-entry";
import type { OrderCreateStepId } from "@/config/orders/order-create-steps";
import { availabilityShortfalls } from "@/config/orders/line-availability";
import type { CurrencyRef, FulfillmentMethod, PortalLead } from "@/services/agent-portal-service";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDuplicateCheck } from "@/hooks/use-duplicate-check";
import { duplicateFromError } from "@/services/order-duplicates-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, reportSuccess, toast } from "@/lib/toast";
import { shippingBlockerKey } from "@/components/shipping/shipping-handoff-notice";
import type { MessageKey } from "@/i18n/translate";
import type { OrderEntryAdapter, OrderEntryFlowState } from "../order-entry-flow";
import { useEntryCountry } from "../use-entry-country";
import { useLineAvailability } from "../use-line-availability";
import {
  AvailabilityNotice,
  CustomerContactFields,
  DuplicateGate,
  EntryMoneyField,
  NotesDisclosure,
  OrderChoiceField,
  OrderDeliveryFields,
  OrderTermsFields,
  type EntryCountryOption,
} from "../entry-fields";
import { AgentDeclarationFields } from "./agent-declaration-fields";
import { AgentOrderLines } from "./agent-order-lines";
import { AgentQuoteSummary, type AgentQuoteState } from "./agent-quote-summary";
import type {
  AgentEntryDestination,
  AgentEntryProduct,
  AgentEntryResult,
  AgentEntrySource,
} from "./agent-entry-source";

const QUOTE_DEBOUNCE_MS = 400;

const FIELD_LABEL_KEY: Partial<Record<keyof AgentOrderEntryValues, MessageKey>> = {
  customerName: "storeOrders.createDialog.fields.customerName",
  countryId: "storeOrders.createDialog.fields.country",
  customerPhone: "storeOrders.fields.phone",
  agreedTotal: "agentPortal.orderForm.fields.agreedTotal",
  serviceCharge: "agentPortal.orderForm.fields.serviceCharge",
  fulfillmentMethod: "storeOrders.createDialog.entry.method",
  paymentType: "storeOrders.fields.paymentType",
  deliveryCountryId: "storeOrders.createDialog.fields.deliveryCountry",
  city: "storeOrders.createDialog.fields.city",
  address: "storeOrders.createDialog.fields.address",
  shippingOverride: "agentPortal.orderForm.fields.shippingOverrideAmount",
  shippingOverrideReason: "agentPortal.orderForm.fields.shippingOverrideReason",
  ownerUserId: "orderEntry.agent.owner",
  notes: "storeOrders.createDialog.fields.notes",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL_KEY);

function leadDefaults(lead: PortalLead | null | undefined, method: FulfillmentMethod) {
  return agentOrderEntryDefaults({
    fulfillmentMethod: method,
    ...(lead
      ? {
          customerName: lead.customerName,
          customerPhone: lead.mobileNumber,
          countryId: lead.country?.id ?? "",
          city: lead.city ?? "",
          address: lead.address ?? "",
        }
      : {}),
  });
}

function leadLines(lead: PortalLead | null | undefined): AgentLineDraft[] {
  if (!lead?.product) return [newAgentLine()];
  const quantity = lead.quantity && lead.quantity > 0 ? lead.quantity : 1;
  return [newAgentLine(lead.product.id, String(quantity))];
}

/**
 * The agent adapter of the order-entry flow (R15 W1, D15-19): agent users in
 * the portal, agent lead conversions, and company staff entering an order for
 * an agent. The agent's own catalog with available-to-sell, the two pricing
 * modes (Shipping added / included) checked live against the agreement by
 * `/orders/quote`, the shipping override where the server allows it, the
 * delivery destination as the tariff destination, and the payment declaration
 * at create with the agent's destinations. Every rule is the server's.
 */
export function useAgentOrderEntry({
  source,
  open,
  lead,
  onOpenLead,
  initialMethod = "SHIPPING",
  countries,
  currency,
  flow,
  onCreated,
  onCancel,
}: {
  source: AgentEntrySource;
  open: boolean;
  /** A lead conversion: the customer comes from the lead. */
  lead?: PortalLead | null;
  /** Opens the lead (its customer details are edited there). */
  onOpenLead?: () => void;
  initialMethod?: FulfillmentMethod;
  countries: readonly EntryCountryOption[];
  /** The agent's settlement currency (every agent order is in it). */
  currency: CurrencyRef | null;
  flow: OrderEntryFlowState;
  onCreated: (result: AgentEntryResult) => void;
  onCancel: () => void;
}): OrderEntryAdapter<AgentOrderEntryValues> {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const canDeclare = source.declarePermissions.some((name) => hasPermission(name));
  const listSeparator = locale === "ar" ? "، " : ", ";
  const phoneCountryCodeRef = useRef<string | null>(null);
  // The delivery (tariff) destination follows the customer's country until another is chosen;
  // a lead without a country asks for the destination directly.
  const [differentCountry, setDifferentCountry] = useState(() => Boolean(lead && !lead.country));
  const differentCountryRef = useRef(differentCountry);
  useEffect(() => {
    differentCountryRef.current = differentCountry;
  }, [differentCountry]);

  // The schema is built at validation time, so it reads the current calling code / destination choice.
  const customerRequired = !lead;
  const resolver = useCallback<Resolver<AgentOrderEntryValues>>(
    (formValues, context, options) =>
      zodResolver(
        buildAgentOrderEntrySchema(t, {
          getPhoneCountryCode: () => phoneCountryCodeRef.current,
          customerRequired,
          getDifferentCountry: () => differentCountryRef.current,
        }),
      )(formValues, context, options),
    [t, customerRequired],
  );
  const form = useForm<AgentOrderEntryValues>({
    resolver,
    defaultValues: leadDefaults(lead, initialMethod),
  });
  const watched = useWatch({ control: form.control });
  const values = useMemo(
    () => ({ ...agentOrderEntryDefaults(), ...watched }) as AgentOrderEntryValues,
    [watched],
  );

  const [lines, setLines] = useState<AgentLineDraft[]>(() => leadLines(lead));
  const [linesTouched, setLinesTouched] = useState(false);
  const [products, setProducts] = useState<AgentEntryProduct[] | null>(null);
  const [destinations, setDestinations] = useState<AgentEntryDestination[] | null>(null);
  const [owners, setOwners] = useState<Array<{ id: string; fullName: string }>>([]);
  const [quote, setQuote] = useState<AgentQuoteState>({ status: "idle" });
  const [declaration, setDeclaration] = useState<AgentDeclarationState>(() => ({
    ...emptyAgentDeclaration(),
    kind: "UNPAID",
  }));
  const [declarationReceipts, setDeclarationReceipts] = useState<ReceiptUploadItem[]>([]);
  const [showDeclarationError, setShowDeclarationError] = useState(false);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
  const [customerGateAttempted, setCustomerGateAttempted] = useState(false);
  // One key per form instance: a retried or double submit returns the first order.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [declarationKey] = useState(() => newIdempotencyKey());
  const requestSeq = useRef(0);

  const setDefaultCountry = useCallback(
    (id: string) => form.setValue("countryId", id, { shouldDirty: false }),
    [form],
  );
  const entry = useEntryCountry({
    countryId: values.countryId,
    phoneCountryCodeRef,
    countries,
    getPhone: () => form.getValues("customerPhone"),
    // A single destination country is a safe default (never guessed among several).
    defaultCountryId: !lead && countries.length === 1 ? countries[0].id : null,
    onDefaultCountry: setDefaultCountry,
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    source
      .products()
      .then((rows) => {
        if (!cancelled) setProducts(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        setProducts([]);
        reportApiError(error, "agentPortal.common.loadFailed");
      });
    if (source.owners) {
      source
        .owners()
        .then((rows) => {
          if (!cancelled) setOwners(rows);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [open, source]);

  const declarationShown = canDeclare && values.paymentType === "PREPAID";
  useEffect(() => {
    if (!open || !declarationShown || destinations !== null) return;
    source
      .destinations()
      .then(setDestinations)
      .catch(() => setDestinations([]));
  }, [open, declarationShown, destinations, source]);

  // ── Live quote ────────────────────────────────────────────────────────
  const pricingInput = useMemo(
    () => buildAgentPricingInput(values, lines, { differentCountry }),
    [values, lines, differentCountry],
  );
  const pricingKey = pricingInput ? JSON.stringify(pricingInput) : "";
  const debouncedKey = useDebouncedValue(pricingKey, QUOTE_DEBOUNCE_MS);
  useEffect(() => {
    if (!debouncedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote((prev) => (prev.status === "idle" ? prev : { status: "idle" }));
      return;
    }
    const seq = ++requestSeq.current;
    setQuote({ status: "loading", key: debouncedKey });
    source
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
          message: error instanceof Error && error.message ? error.message : null,
        });
      });
  }, [debouncedKey, source]);
  const readyQuote = quote.status === "ready" ? quote.quote : null;
  const quoteCurrent = quote.status === "ready" && quote.key === pricingKey;
  const payableTotal = readyQuote?.breakdown?.payableTotal ?? 0;

  // ── Derived ───────────────────────────────────────────────────────────
  const shipping = values.fulfillmentMethod === "SHIPPING";
  const needsDelivery = shipping && !readyQuote?.digitalOnly;
  const overrideAllowed = Boolean(readyQuote?.shipping.overrideAllowed) && shipping;
  const lineErrors = agentLineErrors(lines, values.pricingMode);
  const declares = declarationShown && declaration.kind !== "UNPAID";
  const declarationError = declares
    ? validateAgentDeclaration(declaration, { total: payableTotal, remaining: payableTotal })
    : null;

  const productById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );
  const chosen = useMemo(
    () =>
      lines
        .map((line) => productById.get(line.productId))
        .filter((product): product is AgentEntryProduct => Boolean(product)),
    [lines, productById],
  );
  // Staff: availability from the inventory API for the agent; portal: the catalog's own figure.
  const inventoryAvailable = useLineAvailability(
    source.availabilityOwner ? chosen : [],
    source.availabilityOwner ?? "",
  );
  const available = useMemo(
    () =>
      source.availabilityOwner
        ? inventoryAvailable
        : new Map((products ?? []).map((product) => [product.id, product.available])),
    [source.availabilityOwner, inventoryAvailable, products],
  );
  const shortfalls = availabilityShortfalls(
    lines.map((line) => ({
      productId: line.productId,
      quantity: parseQuantity(line.quantity) ?? 0,
    })),
    available,
  );
  const productName = (productId: string) => {
    const product = productById.get(productId);
    return product ? localizedName(product, locale) : productId;
  };

  // ── Duplicate customer (Spec 1B) ──────────────────────────────────────
  const duplicates = useDuplicateCheck({
    phone: lead ? lead.mobileNumber : values.customerPhone,
    name: lead ? lead.customerName : values.customerName,
    countryId: entry.phoneCountryId,
    enabled: open,
    check: source.checkDuplicates,
  });
  const duplicateGateMessage =
    customerGateAttempted && duplicates.blocked
      ? duplicates.state.status === "ready"
        ? t("orderDuplicates.required")
        : t("storeOrders.createDialog.existingCustomer.checking")
      : null;

  // ── Errors ────────────────────────────────────────────────────────────
  const labelFor = (name: string) => {
    const key = FIELD_LABEL_KEY[name as keyof AgentOrderEntryValues];
    return key ? t(key) : undefined;
  };
  const quoteProblem = !pricingInput
    ? null
    : !quoteCurrent
      ? t("orderEntry.agent.quotePending")
      : !readyQuote?.valid
        ? t("orderEntry.agent.quoteInvalid")
        : null;
  const summaryErrors: FormErrorItem[] = submitAttempted
    ? [
        ...formErrorsFromRhf(form.formState.errors, { labelFor, order: FIELD_ORDER }),
        ...lineErrors.map((error) => ({
          fieldId: "lines",
          label: t("agentPortal.orderForm.sections.lines"),
          message: t(`agentPortal.orderForm.errors.${error}`),
        })),
        ...(quoteProblem ? [{ fieldId: "quote", message: quoteProblem }] : []),
        ...(showDeclarationError && declarationError
          ? [
              {
                fieldId: "declaration",
                message: t(`agentPortal.declare.errors.${declarationError}`),
              },
            ]
          : []),
        ...(duplicates.blocked && duplicates.state.status === "ready"
          ? [{ fieldId: "duplicates", message: t("orderDuplicates.required") }]
          : []),
        ...serverErrors,
      ]
    : [];

  // ── Steps ─────────────────────────────────────────────────────────────
  const validateStep = async (current: OrderCreateStepId) => {
    if (current === "customer") {
      const valid = lead ? true : await form.trigger([...AGENT_ORDER_STEP_FIELDS.customer]);
      setCustomerGateAttempted(true);
      return valid && !duplicates.blocked;
    }
    if (current === "products") {
      const valid = await form.trigger([...AGENT_ORDER_STEP_FIELDS.products]);
      setShowLineErrors(true);
      return valid && lineErrors.length === 0;
    }
    if (current === "deliveryPayment") {
      const valid = await form.trigger([...AGENT_ORDER_STEP_FIELDS.deliveryPayment]);
      if (declarationError) setShowDeclarationError(true);
      return valid && !declarationError;
    }
    return true;
  };

  const onValid = async (formValues: AgentOrderEntryValues) => {
    if (duplicates.blocked) {
      setCustomerGateAttempted(true);
      flow.goToStep("customer", { focusInvalid: true });
      return;
    }
    if (lineErrors.length > 0 || quoteProblem) {
      setShowLineErrors(true);
      flow.goToStep("products", { focusInvalid: true });
      return;
    }
    if (declarationError) {
      setShowDeclarationError(true);
      flow.goToStep("deliveryPayment", { focusInvalid: true });
      return;
    }
    if (declarationReceipts.some((item) => item.status === "uploading")) return;
    const declarationPayload = declares
      ? buildAgentDeclarationPayload(declaration, stagingIdsOf(declarationReceipts), declarationKey)
      : undefined;
    const resolution = duplicates.resolution ? { duplicateResolution: duplicates.resolution } : {};
    try {
      const created = lead
        ? await source.convert(lead.id, {
            ...buildAgentConvertInput(formValues, lines, {
              differentCountry,
              idempotencyKey,
              declaration: declarationPayload,
            })!,
            ...resolution,
          })
        : await source.create({
            ...buildAgentCreateInput(formValues, lines, {
              differentCountry,
              idempotencyKey,
              declaration: declarationPayload,
            })!,
            ...resolution,
          });
      setSubmitAttempted(false);
      reportSuccess(
        t("agentPortal.orderForm.toasts.created", { number: created.internalOrderId }),
        {
          href: source.orderHref(created.id),
          // R6 SHIP — sent to the company Shipping team, or why not yet.
          description: created.fulfillment?.shippingBlocker
            ? t(shippingBlockerKey(created.fulfillment.shippingBlocker))
            : created.fulfillment && created.fulfillment.shipments.length > 0
              ? t("shippingHandoff.sentToShipping")
              : created.paymentType === "PREPAID" && !declares
                ? t("agentPortal.orderForm.toasts.prepaidHint")
                : undefined,
        },
      );
      onCreated(created);
    } catch (error) {
      // A customer the panel had not answered — reopen it on step 1.
      const duplicate = duplicateFromError(error);
      if (duplicate) {
        duplicates.applyServerResult(duplicate);
        setCustomerGateAttempted(true);
        flow.goToStep("customer", { focusInvalid: true });
        toast.warning(t("orderDuplicates.conflictToast"));
        return;
      }
      const fieldErrors = applyServerFieldErrors(error, form.setError, {
        knownFields: FIELD_ORDER,
        labelFor,
        fallback: "agentPortal.orderForm.toasts.createFailed",
      });
      setServerErrors(fieldErrors);
      const target = agentOrderStepRouting.firstStepWithError(
        fieldErrors.map((item) => item.fieldId ?? ""),
      );
      if (target) flow.goToStep(target, { focusInvalid: true });
      else flow.focusFirstInvalid();
      reportApiError(error, "agentPortal.orderForm.toasts.createFailed");
    }
  };

  const submit = async () => {
    setSubmitAttempted(true);
    setServerErrors([]);
    await form.handleSubmit(onValid, (errors) => {
      setShowLineErrors(true);
      const target = agentOrderStepRouting.firstStepWithError(Object.keys(errors));
      if (target) flow.goToStep(target, { focusInvalid: true });
      else flow.focusFirstInvalid();
    })();
  };

  // ── Rendering ─────────────────────────────────────────────────────────
  const countryLabel = (id?: string | null) => {
    const country = id ? countries.find((item) => item.id === id) : undefined;
    return country ? localizedName(country, locale) : "";
  };
  const destinationId = agentDestinationId(values, differentCountry);

  const customerStep = (
    <FormSection title={t("storeOrders.createDialog.sections.customer")}>
      <div className="flex flex-col gap-3">
        {lead ? (
          <>
            <p className="text-caption text-muted-foreground">
              {t("orderEntry.agent.leadCustomer", { number: lead.leadNumber })}
            </p>
            <CustomerIdentitySummary
              name={lead.customerName}
              phone={lead.mobileNumber}
              location={[countryLabel(lead.country?.id), lead.city, lead.address]
                .filter(Boolean)
                .join(listSeparator)}
              changeLabel={t("orderEntry.agent.openLead")}
              onChange={onOpenLead ?? onCancel}
            />
          </>
        ) : (
          <CustomerContactFields
            control={form.control}
            names={{ name: "customerName", countryId: "countryId", phone: "customerPhone" }}
            countries={countries}
            phoneCountryCode={entry.phoneCountryCode}
            onPhoneCode={entry.selectPhoneCode}
            onCountryChosen={entry.onCountryChosen}
          />
        )}
        <DuplicateGate
          state={duplicates.state}
          onChoose={duplicates.choose}
          orderHref={source.orderHref}
          onEditDetails={lead ? undefined : () => form.setFocus("customerPhone")}
          onCancel={onCancel}
          gateMessage={duplicateGateMessage}
          showPanel
        />
      </div>
    </FormSection>
  );

  const productsStep = (
    <>
      <FormSection title={t("agentPortal.orderForm.sections.pricing")}>
        <div className="flex flex-col gap-2">
          <OrderChoiceField<AgentOrderEntryValues, "SHIPPING_ADDED" | "SHIPPING_INCLUDED">
            control={form.control}
            name="pricingMode"
            label={t("agentPortal.orderForm.sections.pricing")}
            options={(["SHIPPING_ADDED", "SHIPPING_INCLUDED"] as const).map((value) => ({
              value,
              label: t(`agentPortal.orderForm.modes.${value}`),
            }))}
          />
          <p className="text-caption text-muted-foreground">
            {t(`agentPortal.orderForm.modeHints.${values.pricingMode}`)}
          </p>
          {values.pricingMode === "SHIPPING_INCLUDED" ? (
            <div className="max-w-xs">
              <EntryMoneyField
                control={form.control}
                name="agreedTotal"
                label={t("agentPortal.orderForm.fields.agreedTotal")}
                required
              />
            </div>
          ) : null}
        </div>
      </FormSection>
      <FormSection title={t("agentPortal.orderForm.sections.lines")}>
        <div className="flex flex-col gap-2">
          <AgentOrderLines
            lines={lines}
            onChange={(next) => {
              setLines(next);
              setLinesTouched(true);
            }}
            products={products}
            available={available}
            pricingMode={values.pricingMode}
            errors={lineErrors}
            showErrors={showLineErrors}
            quote={quoteCurrent ? readyQuote : null}
            currency={currency}
          />
          {values.serviceChargeEnabled ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="max-w-xs">
                <EntryMoneyField
                  control={form.control}
                  name="serviceCharge"
                  label={t("agentPortal.orderForm.fields.serviceCharge")}
                  optional
                />
              </div>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  form.setValue("serviceChargeEnabled", false, { shouldDirty: true });
                  form.setValue("serviceCharge", "", { shouldDirty: true });
                }}
              >
                {t("agentPortal.orderForm.removeServiceCharge")}
              </EnterpriseButton>
            </div>
          ) : (
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => form.setValue("serviceChargeEnabled", true, { shouldDirty: true })}
            >
              <Plus />
              {t("agentPortal.orderForm.addServiceCharge")}
            </EnterpriseButton>
          )}
          <AvailabilityNotice shortfalls={shortfalls} productName={productName} />
        </div>
      </FormSection>
      <FormSection title={t("agentPortal.orderForm.sections.breakdown")}>
        <AgentQuoteSummary state={quote} current={quoteCurrent} currency={currency} />
      </FormSection>
    </>
  );

  const deliveryPaymentStep = (
    <>
      <FormSection title={t("storeOrders.createDialog.entry.deliveryTitle")}>
        <div className="flex flex-col gap-3">
          <OrderTermsFields
            control={form.control}
            names={{ method: "fulfillmentMethod", paymentType: "paymentType" }}
          />
          <OrderDeliveryFields
            control={form.control}
            names={{ countryId: "deliveryCountryId", city: "city", address: "address" }}
            countries={countries}
            needsDelivery={needsDelivery}
            showFields
            pickup={!shipping}
            differentCountry={differentCountry}
            onDifferentCountryChange={setDifferentCountry}
          />
          {overrideAllowed || values.overrideShipping ? (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <FormField
                control={form.control}
                name="overrideShipping"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (!checked) {
                            form.setValue("shippingOverride", "", { shouldDirty: true });
                            form.setValue("shippingOverrideReason", "", { shouldDirty: true });
                          }
                        }}
                      />
                    </FormControl>
                    <FormLabel>{t("agentPortal.orderForm.fields.shippingOverride")}</FormLabel>
                  </FormItem>
                )}
              />
              {values.overrideShipping ? (
                <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-[10rem_minmax(0,1fr)]">
                  <EntryMoneyField
                    control={form.control}
                    name="shippingOverride"
                    label={t("agentPortal.orderForm.fields.shippingOverrideAmount")}
                  />
                  <TextFormField
                    control={form.control}
                    name="shippingOverrideReason"
                    label={t("agentPortal.orderForm.fields.shippingOverrideReason")}
                    required
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </FormSection>

      {source.owners ? (
        <FormSection title={t("storeOrders.createDialog.sections.orderInfo")}>
          <div className="max-w-md">
            <ComboboxFormField
              control={form.control}
              name="ownerUserId"
              label={t("orderEntry.agent.owner")}
              description={t("orderEntry.agent.ownerHint")}
              optional
              allowClear
              items={owners}
              getId={(owner) => owner.id}
              getTitle={(owner) => owner.fullName}
              icon={<UserCog className="size-3.5 shrink-0 text-muted-foreground" />}
            />
          </div>
        </FormSection>
      ) : null}

      {declarationShown ? (
        <div data-field-name="declaration">
          <AgentDeclarationFields
            value={declaration}
            onChange={(next) => {
              setDeclaration(next);
              setShowDeclarationError(false);
            }}
            receipts={declarationReceipts}
            onReceiptsChange={setDeclarationReceipts}
            destinations={destinations}
            total={payableTotal}
            currency={currency}
            error={showDeclarationError ? declarationError : null}
            disabled={form.formState.isSubmitting}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <NotesDisclosure
          control={form.control}
          name="notes"
          defaultOpen={Boolean(form.getValues("notes"))}
        />
      </div>
    </>
  );

  const reviewStep = () => {
    const quotedLines = quoteCurrent ? (readyQuote?.lines ?? []) : [];
    const owner = owners.find((row) => row.id === values.ownerUserId);
    return (
      <div className="flex flex-col gap-4" data-testid="order-review">
        <p className="text-caption text-muted-foreground">
          {t("storeOrders.createDialog.steps.reviewDescription")}
        </p>
        <CreateOperationSummary
          title={t("storeOrders.createDialog.steps.customer")}
          rows={[
            {
              label: t("storeOrders.createDialog.fields.customerName"),
              value: (lead ? lead.customerName : values.customerName.trim()) || "—",
            },
            {
              label: t("storeOrders.fields.phone"),
              value: (
                <span dir="ltr">{(lead ? lead.mobileNumber : values.customerPhone) || "—"}</span>
              ),
            },
            {
              label: t("storeOrders.createDialog.fields.country"),
              value: countryLabel(values.countryId),
            },
          ]}
        />
        <CreateOperationSummary
          title={t("agentPortal.orderForm.sections.lines")}
          rows={lines
            .filter((line) => line.productId)
            .map((line, index) => ({
              label: `${index + 1}. ${productName(line.productId)}`,
              value: (
                <span dir="ltr" className="inline-flex flex-wrap justify-end gap-x-1">
                  <span>{parseQuantity(line.quantity) ?? "—"} ×</span>
                  {quotedLines[index]?.lineAmount != null ? (
                    <MoneyValue value={quotedLines[index].lineAmount!} currency={currency} />
                  ) : (
                    <span>—</span>
                  )}
                </span>
              ),
            }))}
        />
        <AvailabilityNotice shortfalls={shortfalls} productName={productName} />
        <CreateOperationSummary
          title={t("storeOrders.createDialog.steps.deliveryPayment")}
          rows={[
            {
              label: t("storeOrders.createDialog.entry.method"),
              value: shipping
                ? t("storeOrders.createDialog.entry.methodShipping")
                : t("storeOrders.createDialog.entry.methodPickup"),
            },
            {
              label: t("storeOrders.createDialog.entry.deliverTo"),
              value: needsDelivery
                ? [values.address, values.city, countryLabel(destinationId)]
                    .map((part) => part?.trim())
                    .filter(Boolean)
                    .join(listSeparator)
                : shipping
                  ? t("storeOrders.createDialog.entry.nonPhysicalNote")
                  : t("storeOrders.createDialog.entry.pickupNote"),
            },
            {
              label: t("storeOrders.fields.paymentType"),
              value: t(`storeOrders.paymentType.${values.paymentType}`),
            },
            {
              label: t("orderEntry.agent.declarationTitle"),
              value: declares ? t(`agentPortal.declare.kinds.${declaration.kind}`) : "",
            },
            ...(source.owners
              ? [{ label: t("orderEntry.agent.owner"), value: owner?.fullName ?? "" }]
              : []),
            {
              label: t("storeOrders.createDialog.fields.notes"),
              value: values.notes.trim(),
            },
          ]}
        />
        <AgentQuoteSummary state={quote} current={quoteCurrent} currency={currency} />
      </div>
    );
  };

  return {
    form,
    routing: agentOrderStepRouting,
    renderStep: (step) =>
      step === "customer"
        ? customerStep
        : step === "products"
          ? productsStep
          : step === "deliveryPayment"
            ? deliveryPaymentStep
            : reviewStep(),
    validateStep,
    submit,
    summaryErrors,
    isSubmitting: form.formState.isSubmitting,
    isDirty: form.formState.isDirty || linesTouched,
    finalLabel: lead ? t("agentPortal.orderForm.convertSubmit") : t("agentPortal.orderForm.submit"),
    finalDisabled: declarationReceipts.some((item) => item.status === "uploading"),
  };
}
