"use client";

import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { FormSection } from "@/components/documents/form-section";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  findFieldElement,
  focusElement,
  formErrorsFromRhf,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { StepFlow, StepFlowFooter } from "@/components/shared/step-flow";
import {
  ORDER_CREATE_STEPS,
  ORDER_CREATE_STEP_FIELDS,
  ORDER_CREATE_STEP_LABEL_KEY,
  firstStepWithError,
  orderCreateStepIndex,
  stepForField,
  type OrderCreateStepId,
} from "@/config/orders/order-create-steps";
import { ApiError } from "@/services/api-client";
import { formatDate } from "@/lib/date";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CreateOperationSummary } from "@/components/shared/create-operation";
import { MoneyValue } from "@/components/shared/money-value";
import {
  ComboboxFormField,
  DateFormField,
  FileDropField,
  FileUrlField,
  PhoneFormField,
  SelectFormField,
  TextareaFormField,
  TextFormField,
} from "@/components/shared/form-fields";
import {
  ProductLineItemsGrid,
  createEmptyLine,
  isLinePriceMissing,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import { FieldMessage, Form } from "@/components/ui/form";
import { PartnerPicker } from "@/components/business/partner-picker";
import { CustomerIdentitySummary } from "@/components/business/customer-identity-summary";
import { DeliveryFields } from "@/components/shared/delivery-fields";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EnterpriseButton } from "@/components/ui/button";
import { defaultPhoneCountry, parsePhone } from "@/services/phone-service";
import { proposeForCountry } from "@/config/orders/country-entry-defaults";
import { localizedName } from "@/lib/localized-name";
import { Globe } from "lucide-react";
import { storeOrdersService, type StoreOrderRow } from "@/services/store-orders-service";
import {
  PaymentDeclarationFields,
  declarationErrorItem,
} from "@/components/payments/declaration/payment-declaration-fields";
import {
  buildDeclarationPayload,
  declarationAmount,
  emptyDeclaration,
  newIdempotencyKey,
  validateDeclaration,
  type DeclarationFormState,
} from "@/components/payments/declaration/declaration-logic";
import { stagingIdsOf, type ReceiptUploadItem } from "@/components/business/payment-receipts-field";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import {
  buildStoreOrderCreateSchema,
  storeOrderCreateDefaultValues,
  type StoreOrderCreateFormValues,
} from "@/config/store-orders/store-order-create-schema";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { useCountries, useCurrencies } from "@/hooks/use-reference-data";
import { toast, reportApiError, reportSuccess } from "@/lib/toast";
import { PAYMENT_TYPE_LABEL_KEY } from "@/config/store-orders/status";
import type { MessageKey } from "@/i18n/translate";
import { DuplicateCustomerPanel } from "@/components/business/duplicate-customer-panel";
import { useDuplicateCheck } from "@/hooks/use-duplicate-check";
import { duplicateFromError, orderDuplicatesService } from "@/services/order-duplicates-service";
import type { DuplicateChoice } from "@/config/orders/duplicate-panel";

/** Field order + label keys for the error summary (matches the form's visual order). */
const FIELD_LABEL_KEY: Record<string, MessageKey> = {
  customerName: "storeOrders.createDialog.fields.customerName",
  customerPhone: "storeOrders.fields.phone",
  countryId: "storeOrders.createDialog.fields.country",
  deliveryCountryId: "storeOrders.createDialog.fields.deliveryCountry",
  city: "storeOrders.createDialog.fields.city",
  fulfillmentMethod: "storeOrders.createDialog.entry.method",
  customerEmail: "storeOrders.createDialog.fields.customerEmail",
  address: "storeOrders.createDialog.fields.address",
  externalOrderId: "storeOrders.fields.externalOrderId",
  orderDate: "storeOrders.fields.orderDate",
  currencyId: "storeOrders.createDialog.fields.currency",
  paymentType: "storeOrders.fields.paymentType",
  notes: "storeOrders.createDialog.fields.notes",
};
const FIELD_ORDER = Object.keys(FIELD_LABEL_KEY);

export interface StoreOrderCreatePrefillCustomer {
  /** The existing customer (e.g. from Global Lookup) — its duplicate match needs no second answer. */
  id?: string | null;
  name: string;
  phone?: string | null;
  countryId?: string | null;
  city?: string | null;
  address?: string | null;
}

export function StoreOrderCreateDialog({
  open,
  onOpenChange,
  onCreated,
  prefillCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: StoreOrderRow) => void;
  /** Set when opened from the Global Lookup dialog's "Add New Order" action — reuses this Customer instead of prompting for one. */
  prefillCustomer?: StoreOrderCreatePrefillCustomer | null;
}) {
  const { t, locale } = useLocale();
  const listSeparator = locale === "ar" ? "، " : ", ";
  const { hasPermission } = useUserContext();
  // Same any-of rule the API applies to payment declarations.
  const canDeclarePayment =
    hasPermission("store-orders.edit") || hasPermission("sales.receipts.create");
  const currencies = useCurrencies();
  const countries = useCountries();
  const [selectedCustomer, setSelectedCustomer] = useState<PartnerPickerRow | null>(null);
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([createEmptyLine()]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [showLineErrors, setShowLineErrors] = useState(false);
  // Optional Sales payment declaration (never a voucher / receiving account).
  const [declaration, setDeclaration] = useState<DeclarationFormState>(() =>
    emptyDeclaration("UNPAID"),
  );
  const [declarationReceipts, setDeclarationReceipts] = useState<ReceiptUploadItem[]>([]);
  const [showDeclarationError, setShowDeclarationError] = useState(false);
  const [declarationKey, setDeclarationKey] = useState("");
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Spec 1B — one key per dialog instance: a double submit or a retry after
  // a lost response returns the first order instead of creating another.
  const [creationKey, setCreationKey] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
  // R13 A4 — four steps over ONE form: the steps only decide what is shown; every value
  // (form fields and the dialog's own state) survives Back / Next.
  const [stepIndex, setStepIndex] = useState(0);
  const step: OrderCreateStepId = ORDER_CREATE_STEPS[stepIndex];
  const [checkingStep, setCheckingStep] = useState(false);
  // Leaving step 1 was attempted: an unanswered duplicate match is now explained in place.
  const [customerGateAttempted, setCustomerGateAttempted] = useState(false);
  // An existing customer's stored phone failed validation: show it so it can be corrected.
  const [existingPhoneEditable, setExistingPhoneEditable] = useState(false);
  const stepPanelRef = useRef<HTMLDivElement>(null);
  const stepFocusPendingRef = useRef(false);
  const submittingRef = useRef(false);

  // Phone country ≠ shipping destination (phone-field.md): the phone country
  // follows the shipping country until the user picks one explicitly
  // (`phoneCountryOverride`), and a legitimate difference is kept. Not a form
  // field — the committed E.164 value already carries its country.
  const [phoneCountryOverride, setPhoneCountryOverride] = useState<string | null>(null);
  // Existing / New customer — the customer is entered ONCE: an existing one is
  // shown as a summary (its details are never re-asked); a new one is name + phone.
  const [customerMode, setCustomerMode] = useState<"new" | "existing">("new");
  // The delivery country follows the phone country unless the user says otherwise.
  const [differentCountry, setDifferentCountry] = useState(false);
  // Existing customer only: deliver this order somewhere other than the customer's address.
  const [differentAddress, setDifferentAddress] = useState(false);
  const phoneCountryCodeRef = useRef<string | null>(null);
  // R12: the country proposes the calling code and the currency; a manual choice of either
  // (the user picked it, or an existing record supplied it) is never overwritten afterwards.
  const currencyTouchedRef = useRef(false);
  const schema = useMemo(
    () => buildStoreOrderCreateSchema(t, () => phoneCountryCodeRef.current),
    [t],
  );

  const form = useForm<StoreOrderCreateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: storeOrderCreateDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingFiles([]);
    setCreationKey(newIdempotencyKey());
    currencyTouchedRef.current = false;
    setPhoneCountryOverride(
      prefillCustomer
        ? phoneCountryOverrideFor(prefillCustomer.phone, prefillCustomer.countryId)
        : null,
    );
    setCustomerMode(prefillCustomer?.id ? "existing" : "new");
    setSelectedCustomer(
      prefillCustomer?.id
        ? ({
            id: prefillCustomer.id,
            name: prefillCustomer.name,
            phone: prefillCustomer.phone ?? null,
            mobile: null,
            email: null,
            countryId: prefillCustomer.countryId ?? null,
            city: prefillCustomer.city ?? null,
            address: prefillCustomer.address ?? null,
          } as unknown as PartnerPickerRow)
        : null,
    );
    setDifferentCountry(false);
    setDifferentAddress(false);
    if (prefillCustomer) {
      form.setValue("customerName", prefillCustomer.name, { shouldDirty: true });
      form.setValue("customerPhone", prefillCustomer.phone || "", { shouldDirty: true });
      form.setValue("countryId", prefillCustomer.countryId || "", { shouldDirty: true });
      form.setValue("city", prefillCustomer.city || "", { shouldDirty: true });
      form.setValue("address", prefillCustomer.address || "", { shouldDirty: true });
    }
    setDeclarationKey(newIdempotencyKey());
    setDeclaration(emptyDeclaration("UNPAID"));
    setDeclarationReceipts([]);
    setShowDeclarationError(false);
    setSubmitAttempted(false);
    setServerErrors([]);
    setStepIndex(0);
    setCustomerGateAttempted(false);
    setExistingPhoneEditable(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A step change moves focus to the new step (screen readers announce it) and shows its top.
  useEffect(() => {
    if (!stepFocusPendingRef.current) return;
    stepFocusPendingRef.current = false;
    stepPanelRef.current?.focus({ preventScroll: true });
    stepPanelRef.current?.scrollIntoView?.({ block: "start" });
  }, [stepIndex]);

  const isDirty = form.formState.isDirty;
  const isSubmitting = form.formState.isSubmitting;
  const countryId = useWatch({ control: form.control, name: "countryId" });
  const selectedCurrencyId = useWatch({ control: form.control, name: "currencyId" });
  const receiptName = useWatch({ control: form.control, name: "receiptName" });
  const receiptUrl = useWatch({ control: form.control, name: "receiptUrl" });
  const customerName = useWatch({ control: form.control, name: "customerName" });
  const customerPhone = useWatch({ control: form.control, name: "customerPhone" });
  const paymentType = useWatch({ control: form.control, name: "paymentType" });
  // O2 default (Saudi Arabia) — used only until the user picks a phone or
  // shipping country, and never marks the form dirty, so closing an
  // untouched dialog stays silent.
  const defaultPhoneCountryId = useMemo(() => {
    const code = defaultPhoneCountry(countries.map((country) => country.code));
    return code ? (countries.find((country) => country.code === code)?.id ?? "") : "";
  }, [countries]);
  // The customer's country: Saudi Arabia (O2 default) until chosen. It proposes the calling code
  // and the order currency; it never marks the form dirty. Existing customers keep their own
  // saved country (possibly none) - nothing is invented for them.
  useEffect(() => {
    if (customerMode !== "new" || countryId || !defaultPhoneCountryId) return;
    form.setValue("countryId", defaultPhoneCountryId, { shouldDirty: false });
  }, [customerMode, countryId, defaultPhoneCountryId, form]);
  const proposal = useMemo(
    () => proposeForCountry(countryId, countries, currencies),
    [countryId, countries, currencies],
  );
  // The calling code follows the country until the user picks one (or a number is already typed).
  const phoneCountryId = phoneCountryOverride ?? proposal.phoneCountryId ?? defaultPhoneCountryId;
  const phoneCountryCode = countries.find((country) => country.id === phoneCountryId)?.code ?? null;
  useEffect(() => {
    phoneCountryCodeRef.current = phoneCountryCode;
  }, [phoneCountryCode]);

  /** The phone's own country (from a stored E.164) when it differs from the customer's country - otherwise the calling code simply follows the country. */
  function phoneCountryOverrideFor(
    phone: string | null | undefined,
    shippingCountryId?: string | null,
  ) {
    const region = parsePhone(phone, null).detectedRegion;
    const match = region ? countries.find((country) => country.code === region) : undefined;
    return match && match.id !== shippingCountryId ? match.id : null;
  }

  const selectPhoneCountry = (id: string) => {
    setPhoneCountryOverride(id || null);
  };
  /** The user chose a country: a number already typed keeps the calling code it was read with. */
  const onCountryChosen = () => {
    if (phoneCountryOverride === null && form.getValues("customerPhone")?.trim()) {
      setPhoneCountryOverride(phoneCountryId || null);
    }
  };
  // The currency follows the country's configured default (Master data -> Countries) until the
  // user chooses one. No configured default, or no country yet, leaves it empty: asked, never
  // guessed - and never the system's base currency by assumption.
  useEffect(() => {
    if (currencyTouchedRef.current || currencies.length === 0) return;
    const next = proposal.currencyId ?? "";
    if (form.getValues("currencyId") !== next) {
      form.setValue("currencyId", next, { shouldDirty: false });
    }
  }, [proposal.currencyId, currencies.length, form]);
  const noCurrencyDefault = !selectedCurrencyId && !!countryId && currencies.length > 0;
  const currencyCode =
    currencies.find((currency) => currency.id === selectedCurrencyId)?.code ?? "";

  const itemsTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const declares =
    canDeclarePayment && paymentType !== "CASH_ON_DELIVERY" && declaration.kind !== "UNPAID";
  const declarationError = declares
    ? validateDeclaration(declaration, { total: itemsTotal, remaining: itemsTotal })
    : null;
  const paidAmount = declares ? declarationAmount(declaration, itemsTotal) : 0;
  const namedLines = lines.filter((line) => line.product);
  const fulfillmentMethod = useWatch({ control: form.control, name: "fulfillmentMethod" });
  // A service never ships — the delivery address is asked unless every chosen line is a service.
  const hasPhysicalLine =
    namedLines.length === 0 || namedLines.some((line) => line.product!.itemType !== "SERVICE");
  const needsDelivery = fulfillmentMethod !== "PICKUP" && hasPhysicalLine;
  const existingCustomer = customerMode === "existing" ? selectedCustomer : null;
  const existingMissingAddress =
    !!existingCustomer && !existingCustomer.city?.trim() && !existingCustomer.address?.trim();
  const showDeliveryFields =
    needsDelivery && (customerMode === "new" || differentAddress || existingMissingAddress);
  // Delivery goes to the customer's country unless "Different delivery country" names another.
  const deliveryCountryFieldValue = useWatch({ control: form.control, name: "deliveryCountryId" });
  const effectiveDeliveryCountryId = differentCountry
    ? deliveryCountryFieldValue || countryId || ""
    : countryId || "";
  const existingNeedsPhone =
    !!existingCustomer && !(existingCustomer.phone || existingCustomer.mobile);
  const summaryQuantity = namedLines.reduce((sum, line) => sum + line.quantity, 0);

  const applyCustomer = (customer: PartnerPickerRow) => {
    setSelectedCustomer(customer);
    form.setValue("customerName", customer.name, { shouldDirty: true, shouldValidate: true });
    form.setValue("customerPhone", customer.phone || customer.mobile || "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("customerEmail", customer.email || "", { shouldDirty: true });
    form.setValue("countryId", customer.countryId || "", { shouldDirty: true });
    form.setValue("deliveryCountryId", "", { shouldDirty: false });
    form.setValue("city", customer.city || "", { shouldDirty: true });
    form.setValue("address", customer.address || "", { shouldDirty: true });
    // A phone read with another calling code than the customer's country (international phone,
    // local delivery) keeps its own code; the customer's address is the default destination.
    setPhoneCountryOverride(
      phoneCountryOverrideFor(customer.phone || customer.mobile, customer.countryId),
    );
    setDifferentCountry(false);
    setDifferentAddress(false);
    setExistingPhoneEditable(false);
  };

  // Spec 1B duplicate warning — debounced check of the typed phone / name.
  // A customer picked explicitly (picker or Global Lookup) answers its own
  // match; any other match must be answered before saving.
  const duplicates = useDuplicateCheck({
    phone: customerPhone,
    name: customerName,
    countryId: phoneCountryId,
    enabled: open,
    check: orderDuplicatesService.check,
    knownCustomerId: selectedCustomer?.id ?? prefillCustomer?.id ?? null,
  });
  const canLookupCustomers = hasPermission("customers.lookup_global");
  const chooseDuplicate = (choice: DuplicateChoice | null) => {
    duplicates.choose(choice);
    // "New order for this customer": reuse the stored contact details too —
    // only for users who may read them (the audited global lookup).
    if (choice?.kind === "NEW_ORDER" && canLookupCustomers && customerPhone) {
      partnersService
        .globalLookupByPhone(customerPhone)
        .then((customer) => {
          if (customer && !customer.restricted && customer.id === choice.customerId) {
            // The recognised customer becomes THE customer of this order: the form shows
            // who they are and asks only for what is missing or order-specific.
            applyCustomer({
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              mobile: customer.mobile,
              email: null,
              countryId: customer.countryId,
              city: customer.city,
              address: customer.address,
            } as unknown as PartnerPickerRow);
            setCustomerMode("existing");
            toast.success(t("storeOrders.createDialog.existingCustomer.applied"));
          }
        })
        .catch(() => undefined);
    }
  };

  const clearCustomerFields = () => {
    for (const name of [
      "customerName",
      "customerPhone",
      "customerEmail",
      "countryId",
      "deliveryCountryId",
      "city",
      "address",
    ] as const) {
      form.setValue(name, "", { shouldDirty: false });
    }
  };
  const switchCustomerMode = (mode: "new" | "existing") => {
    if (mode === customerMode) return;
    setCustomerMode(mode);
    setSelectedCustomer(null);
    setPhoneCountryOverride(null);
    setDifferentCountry(false);
    setDifferentAddress(false);
    setExistingPhoneEditable(false);
    clearCustomerFields();
  };
  const clearExistingCustomer = () => {
    setSelectedCustomer(null);
    setPhoneCountryOverride(null);
    setDifferentCountry(false);
    setDifferentAddress(false);
    setExistingPhoneEditable(false);
    clearCustomerFields();
  };
  /** Existing customer: deliver to this order's own address, or back to the customer's. */
  const toggleDifferentAddress = (on: boolean) => {
    setDifferentAddress(on);
    if (!on && selectedCustomer) {
      form.setValue("city", selectedCustomer.city || "", { shouldDirty: true });
      form.setValue("address", selectedCustomer.address || "", { shouldDirty: true });
      form.setValue("deliveryCountryId", "", { shouldDirty: false });
      setDifferentCountry(false);
    }
  };

  const labelFor = (name: string) => {
    const key = FIELD_LABEL_KEY[name];
    return key ? t(key) : undefined;
  };
  const priceMissing = showLineErrors && lines.some((line) => isLinePriceMissing(line));
  // Recomputed from live state, so each item disappears as the user fixes it.
  const summaryErrors: FormErrorItem[] = submitAttempted
    ? [
        ...formErrorsFromRhf(form.formState.errors, { labelFor, order: FIELD_ORDER }),
        ...(itemsError || priceMissing
          ? [
              {
                fieldId: "lines",
                label: t("storeOrders.createDialog.items.title"),
                message: itemsError ?? t("docFlow.lines.priceRequired"),
              },
            ]
          : []),
        ...(showDeclarationError && declarationError
          ? [declarationErrorItem(declarationError, t)]
          : []),
        ...(receiptError ? [{ fieldId: "receipts", message: receiptError }] : []),
        ...(duplicates.blocked && duplicates.state.status === "ready"
          ? [{ fieldId: "duplicates", message: t("orderDuplicates.required") }]
          : []),
        ...serverErrors,
      ]
    : [];

  const stepItems = ORDER_CREATE_STEPS.map((id) => ({
    id,
    label: t(ORDER_CREATE_STEP_LABEL_KEY[id]),
  }));

  /** Shows a step. `focusInvalid` (a failed check) moves focus to its first invalid field instead of the step itself. */
  const goToStep = (target: OrderCreateStepId, options: { focusInvalid?: boolean } = {}) => {
    const index = orderCreateStepIndex(target);
    if (options.focusInvalid) {
      setStepIndex(index);
      focusFirstInvalid();
      return;
    }
    if (index === stepIndex) return;
    stepFocusPendingRef.current = true;
    setStepIndex(index);
  };

  // Shown under the duplicate panel once the user tried to leave step 1 with it unanswered.
  const duplicateGateMessage =
    customerGateAttempted && duplicates.blocked
      ? duplicates.state.status === "ready"
        ? t("orderDuplicates.required")
        : t("storeOrders.createDialog.existingCustomer.checking")
      : null;

  /** Line items are dialog state, not form fields — checked here (step 2 and Create). */
  const validateLines = () => {
    const validLines = lines.filter((line) => line.product && line.quantity > 0);
    if (validLines.length === 0) {
      setItemsError(t("storeOrders.createDialog.items.required"));
      return false;
    }
    setItemsError(null);
    // The agreed price is required — a blank or 0 price is never sent as a 0.00 order.
    if (validLines.some((line) => isLinePriceMissing(line))) {
      setShowLineErrors(true);
      return false;
    }
    return true;
  };

  /** A link attachment needs both its name and its URL. */
  const validateReceiptPair = () => {
    const hasReceiptName = Boolean(form.getValues("receiptName")?.trim());
    const hasReceiptUrl = Boolean(form.getValues("receiptUrl")?.trim());
    if (hasReceiptName !== hasReceiptUrl) {
      setReceiptError(t("storeOrders.createDialog.receiptIncomplete"));
      return false;
    }
    setReceiptError(null);
    return true;
  };

  /** "Next" checks only the current step's fields. */
  const validateStep = async (current: OrderCreateStepId) => {
    if (current === "customer") {
      const valid = await form.trigger([...ORDER_CREATE_STEP_FIELDS.customer]);
      if (!valid && existingCustomer && form.getFieldState("customerPhone").invalid) {
        setExistingPhoneEditable(true);
      }
      setCustomerGateAttempted(true);
      // An unanswered duplicate match (or a check still running) keeps the user on step 1.
      return valid && !duplicates.blocked;
    }
    if (current === "products") return validateLines();
    if (current === "deliveryPayment") {
      const valid = await form.trigger([...ORDER_CREATE_STEP_FIELDS.deliveryPayment]);
      const receiptsValid = validateReceiptPair();
      if (declarationError) setShowDeclarationError(true);
      return valid && receiptsValid && !declarationError;
    }
    return true;
  };

  const goNext = async () => {
    if (checkingStep || stepIndex >= ORDER_CREATE_STEPS.length - 1) return;
    setCheckingStep(true);
    let valid = false;
    try {
      valid = await validateStep(step);
    } finally {
      setCheckingStep(false);
    }
    if (!valid) {
      focusFirstInvalid();
      return;
    }
    goToStep(ORDER_CREATE_STEPS[stepIndex + 1]);
  };

  const goBack = () => {
    if (stepIndex > 0) goToStep(ORDER_CREATE_STEPS[stepIndex - 1]);
  };

  /** An error-summary item: open the step holding the field, then focus it. */
  const focusSummaryField = (fieldId: string) => {
    const target = stepForField(fieldId);
    if (target) setStepIndex(orderCreateStepIndex(target));
    let attempts = 0;
    const tryFocus = () => {
      const element = findFieldElement(fieldId, bodyRef.current ?? document);
      if (element) {
        focusElement(element);
        return;
      }
      if (++attempts < 10) window.requestAnimationFrame(tryFocus);
    };
    window.requestAnimationFrame(tryFocus);
  };

  const onValid = async (values: StoreOrderCreateFormValues) => {
    if (!validateLines()) {
      goToStep("products", { focusInvalid: true });
      return;
    }
    if (declarationError) {
      setShowDeclarationError(true);
      goToStep("deliveryPayment", { focusInvalid: true });
      return;
    }
    if (declarationReceipts.some((item) => item.status === "uploading")) return;
    if (!validateReceiptPair()) {
      goToStep("deliveryPayment", { focusInvalid: true });
      return;
    }
    const hasReceiptName = Boolean(values.receiptName?.trim());
    const hasReceiptUrl = Boolean(values.receiptUrl?.trim());
    if (duplicates.blocked) {
      setCustomerGateAttempted(true);
      goToStep("customer", { focusInvalid: true });
      return;
    }
    const validLines = lines.filter((line) => line.product && line.quantity > 0);

    try {
      const created = await storeOrdersService.create({
        externalOrderId: values.externalOrderId || undefined,
        // An existing customer is reused as-is by the server (never rewritten by an order);
        // a new one is created with the address entered here.
        partner: existingCustomer
          ? {
              name: existingCustomer.name,
              phone: values.customerPhone || undefined,
              email: existingCustomer.email || undefined,
              countryId: existingCustomer.countryId || undefined,
              city: existingCustomer.city || undefined,
              address: existingCustomer.address || undefined,
            }
          : {
              name: values.customerName,
              phone: values.customerPhone || undefined,
              email: values.customerEmail || undefined,
              countryId: values.countryId || undefined,
              // The delivery address belongs to the customer only while it is in the customer's own
              // country; a different delivery country is this order's destination alone.
              city: needsDelivery && !differentCountry ? values.city || undefined : undefined,
              address: needsDelivery && !differentCountry ? values.address || undefined : undefined,
            },
        fulfillmentMethod: values.fulfillmentMethod,
        // This order's own destination (stored on the order only — never on the customer master).
        ...(needsDelivery && (values.city || values.address || effectiveDeliveryCountryId)
          ? {
              delivery: {
                countryId: effectiveDeliveryCountryId || undefined,
                city: values.city || undefined,
                address: values.address || undefined,
              },
            }
          : {}),
        orderDate: values.orderDate || undefined,
        source: "MANUAL",
        currencyId: values.currencyId,
        paymentType: values.paymentType,
        notes: values.notes || undefined,
        items: validLines.map((line) => ({
          productId: line.product!.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
        ...(declares
          ? {
              declaration: {
                ...buildDeclarationPayload(
                  { ...declaration, stagedAttachmentIds: stagingIdsOf(declarationReceipts) },
                  values.currencyId,
                ),
                idempotencyKey: declarationKey,
              },
            }
          : {}),
        creationIdempotencyKey: creationKey,
        ...(duplicates.resolution ? { duplicateResolution: duplicates.resolution } : {}),
      });

      const uploadedKeys: string[] = [];
      try {
        for (const file of pendingFiles) {
          const receipt = await storeOrdersService.receipts.upload(created.id, file);
          uploadedKeys.push(receipt.id);
        }
        if (hasReceiptName && hasReceiptUrl) {
          await storeOrdersService.receipts.attach(created.id, {
            fileName: values.receiptName!.trim(),
            fileUrl: values.receiptUrl!.trim(),
          });
        }
      } catch (error) {
        for (const receiptId of uploadedKeys) {
          await storeOrdersService.receipts.archive(created.id, receiptId).catch(() => undefined);
        }
        reportApiError(error, "common.failedToSave");
      }

      setSubmitAttempted(false);
      reportSuccess(t("storeOrders.createDialog.success"), {
        href: `/store-orders/${created.id}`,
      });
      onOpenChange(false);
      onCreated(created);
    } catch (error) {
      // The server found a customer the panel had not answered — reopen it on step 1.
      const duplicate = duplicateFromError(error);
      if (duplicate) {
        duplicates.applyServerResult(duplicate);
        setCustomerGateAttempted(true);
        goToStep("customer", { focusInvalid: true });
        toast.warning(t("orderDuplicates.conflictToast"));
        return;
      }
      setServerErrors(
        applyServerFieldErrors(error, form.setError, {
          knownFields: FIELD_ORDER,
          labelFor,
          fallback: "common.failedToSave",
        }),
      );
      // Back to the step holding the (first) field the server rejected.
      const target =
        error instanceof ApiError
          ? firstStepWithError((error.fields ?? []).map((detail) => detail.field))
          : null;
      if (target) goToStep(target, { focusInvalid: true });
      else focusFirstInvalid();
      reportApiError(error, "common.failedToSave");
    }
  };

  const submit = async () => {
    // One Create at a time; a retry of the same form reuses `creationKey`.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitAttempted(true);
    setServerErrors([]);
    try {
      await form.handleSubmit(onValid, (errors) => {
        if (existingCustomer && errors.customerPhone) setExistingPhoneEditable(true);
        const target = firstStepWithError(Object.keys(errors));
        if (target) goToStep(target, { focusInvalid: true });
        else focusFirstInvalid();
      })();
    } finally {
      submittingRef.current = false;
    }
  };

  const countryLabel = (id?: string | null) => {
    const country = id ? countries.find((item) => item.id === id) : undefined;
    return country ? localizedName(country, locale) : "";
  };
  const reviewValues = form.getValues();
  const deliveryDestination = needsDelivery
    ? [
        reviewValues.address,
        reviewValues.city,
        countryLabel(effectiveDeliveryCountryId || existingCustomer?.countryId),
      ]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(listSeparator)
    : fulfillmentMethod === "PICKUP"
      ? t("storeOrders.createDialog.entry.pickupNote")
      : t("storeOrders.createDialog.entry.nonPhysicalNote");
  const attachmentCount = pendingFiles.length + (receiptName?.trim() && receiptUrl?.trim() ? 1 : 0);
  const showCustomerPhone =
    customerMode === "new" || existingNeedsPhone || (!!existingCustomer && existingPhoneEditable);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("storeOrders.createDialog.title")}
      description={t("storeOrders.createDialog.description")}
      isDirty={isDirty}
      testId="store-order-create-dialog"
      subheader={
        <StepFlow
          steps={stepItems}
          currentIndex={stepIndex}
          onStepSelect={(index) => goToStep(ORDER_CREATE_STEPS[index])}
        />
      }
      errorSummary={<FormErrorSummary errors={summaryErrors} onFocusField={focusSummaryField} />}
      footer={(requestClose) => (
        <StepFlowFooter
          currentIndex={stepIndex}
          stepCount={ORDER_CREATE_STEPS.length}
          onBack={goBack}
          onNext={() => void goNext()}
          requestClose={requestClose}
          finalLabel={t("storeOrders.createDialog.submit")}
          onFinal={() => void submit()}
          isSubmitting={isSubmitting}
          isBusy={checkingStep}
        />
      )}
    >
      <Form {...form}>
        <div ref={bodyRef}>
          <div
            ref={stepPanelRef}
            tabIndex={-1}
            role="group"
            aria-label={stepItems[stepIndex].label}
            data-step={step}
            className="flex scroll-mt-4 flex-col gap-4 outline-none"
          >
            {step === "customer" ? (
              <FormSection title={t("storeOrders.createDialog.sections.customer")}>
                <div className="flex flex-col gap-3">
                  <ToggleGroup
                    type="single"
                    value={customerMode}
                    onValueChange={(value) =>
                      value && switchCustomerMode(value as "new" | "existing")
                    }
                    aria-label={t("storeOrders.createDialog.entry.modeLabel")}
                    data-testid="customer-mode"
                  >
                    <ToggleGroupItem value="new" size="default">
                      {t("storeOrders.createDialog.entry.modeNew")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="existing" size="default">
                      {t("storeOrders.createDialog.entry.modeExisting")}
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {customerMode === "existing" && !existingCustomer ? (
                    <div
                      className="flex max-w-xl flex-col gap-1"
                      data-field-name="customerName"
                      data-invalid={form.formState.errors.customerName ? "true" : undefined}
                    >
                      <PartnerPicker
                        role="CUSTOMER"
                        value={selectedCustomer}
                        onChange={applyCustomer}
                        className="max-w-none"
                      />
                      <p className="text-caption text-muted-foreground">
                        {t("storeOrders.createDialog.entry.findExisting")}
                      </p>
                      <FieldMessage>
                        {form.formState.errors.customerName
                          ? t("storeOrders.createDialog.steps.chooseCustomer")
                          : null}
                      </FieldMessage>
                    </div>
                  ) : null}

                  {existingCustomer ? (
                    <CustomerIdentitySummary
                      name={existingCustomer.name}
                      phone={existingCustomer.phone || existingCustomer.mobile}
                      location={[existingCustomer.address, existingCustomer.city]
                        .filter(Boolean)
                        .join(listSeparator)}
                      changeLabel={t("storeOrders.createDialog.entry.changeCustomer")}
                      onChange={clearExistingCustomer}
                    />
                  ) : null}

                  {showCustomerPhone ? (
                    <div
                      className={
                        customerMode === "new"
                          ? "grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-2 @xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,6fr)]"
                          : "max-w-md"
                      }
                    >
                      {customerMode === "new" ? (
                        <>
                          <TextFormField
                            control={form.control}
                            name="customerName"
                            label={t("storeOrders.createDialog.fields.customerName")}
                            required
                          />
                          <ComboboxFormField
                            control={form.control}
                            name="countryId"
                            label={t("storeOrders.createDialog.fields.country")}
                            required
                            items={countries}
                            getId={(country) => country.id}
                            getTitle={(country) => localizedName(country, locale)}
                            getSearchText={(country) =>
                              [country.name, country.nameEn, country.code, country.iso3]
                                .filter(Boolean)
                                .join(" ")
                            }
                            icon={<Globe className="size-3.5 shrink-0 text-muted-foreground" />}
                            onValueChange={onCountryChosen}
                          />
                        </>
                      ) : null}
                      <div
                        className={customerMode === "new" ? "@md:col-span-2 @xl:col-span-1" : ""}
                      >
                        <PhoneFormField
                          control={form.control}
                          name="customerPhone"
                          label={t("storeOrders.fields.phone")}
                          required
                          countryCode={phoneCountryCode}
                          availableCountryCodes={countries.map((country) => country.code)}
                          countries={countries}
                          onCountryChange={(iso2) => {
                            const match = countries.find((country) => country.code === iso2);
                            if (match) selectPhoneCountry(match.id);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {customerMode === "new" ||
                  existingNeedsPhone ||
                  (duplicates.blocked && duplicates.state.status === "ready") ? (
                    <div
                      className="flex flex-col gap-1"
                      data-field-name="duplicates"
                      data-invalid={duplicateGateMessage ? "true" : undefined}
                    >
                      <DuplicateCustomerPanel
                        state={duplicates.state}
                        onChoose={chooseDuplicate}
                        orderHref={(id) => `/store-orders/${id}`}
                        onEditDetails={() => form.setFocus("customerPhone")}
                        onCancel={() => onOpenChange(false)}
                      />
                      <FieldMessage>{duplicateGateMessage}</FieldMessage>
                    </div>
                  ) : duplicateGateMessage ? (
                    <FieldMessage>{duplicateGateMessage}</FieldMessage>
                  ) : null}

                  {customerMode === "new" ? (
                    <Collapsible defaultOpen={Boolean(form.getValues("customerEmail"))}>
                      <CollapsibleTrigger asChild>
                        <DisclosureTrigger>
                          {t("storeOrders.createDialog.entry.moreDetails")}
                          <span className="font-normal">({t("common.optional")})</span>
                        </DisclosureTrigger>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="max-w-md">
                          <TextFormField
                            control={form.control}
                            name="customerEmail"
                            label={t("storeOrders.createDialog.fields.customerEmail")}
                            optional
                            dir="ltr"
                            inputMode="email"
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </div>
              </FormSection>
            ) : null}

            {step === "products" ? (
              <FormSection
                title={t("storeOrders.createDialog.items.title")}
                data-field-name="lines"
                data-invalid={itemsError || priceMissing ? "true" : undefined}
              >
                <div className="flex flex-col gap-2">
                  <ProductLineItemsGrid
                    lines={lines}
                    onChange={(next) => {
                      setLines(next);
                      setItemsError(null);
                    }}
                    requireWarehouse={false}
                    showWarehouse={false}
                    showUnit={false}
                    showDiscount={false}
                    showTax={false}
                    showDescription={false}
                    unitPriceLabel={t("storeOrders.createDialog.items.agreedUnitPrice")}
                    requirePrice
                    showErrors={showLineErrors}
                    totalLabel={t("storeOrders.fields.total")}
                    currencyCode={currencyCode}
                  />
                  <FieldMessage>{itemsError}</FieldMessage>
                </div>
              </FormSection>
            ) : null}

            {step === "deliveryPayment" ? (
              <>
                <FormSection title={t("storeOrders.createDialog.entry.deliveryTitle")}>
                  <div className="flex flex-col gap-3">
                    <div className="max-w-xs">
                      <SelectFormField
                        control={form.control}
                        name="fulfillmentMethod"
                        label={t("storeOrders.createDialog.entry.method")}
                        options={[
                          {
                            value: "SHIPPING",
                            label: t("storeOrders.createDialog.entry.methodShipping"),
                          },
                          {
                            value: "PICKUP",
                            label: t("storeOrders.createDialog.entry.methodPickup"),
                          },
                        ]}
                      />
                    </div>

                    {existingCustomer && needsDelivery && !existingMissingAddress ? (
                      <div className="flex flex-col gap-1">
                        {!differentAddress ? (
                          <p className="text-caption text-muted-foreground">
                            {t("storeOrders.createDialog.entry.deliverTo")}:{" "}
                            <span className="text-foreground">
                              {[existingCustomer.address, existingCustomer.city]
                                .filter(Boolean)
                                .join(listSeparator)}
                            </span>
                          </p>
                        ) : null}
                        <EnterpriseButton
                          type="button"
                          variant="link"
                          size="inline"
                          className="self-start"
                          aria-pressed={differentAddress}
                          onClick={() => toggleDifferentAddress(!differentAddress)}
                          data-testid="different-address-toggle"
                        >
                          {differentAddress
                            ? t("storeOrders.createDialog.entry.customerAddress")
                            : t("storeOrders.createDialog.entry.differentAddress")}
                        </EnterpriseButton>
                      </div>
                    ) : null}

                    {showDeliveryFields ? (
                      <div className="flex flex-col gap-1.5">
                        {existingCustomer ? (
                          <p className="text-caption font-medium text-muted-foreground">
                            {existingMissingAddress
                              ? t("storeOrders.createDialog.entry.missingAddress")
                              : t("storeOrders.createDialog.entry.orderOnlyNote")}
                          </p>
                        ) : null}
                        <DeliveryFields
                          control={form.control}
                          names={{
                            countryId: "deliveryCountryId",
                            city: "city",
                            address: "address",
                          }}
                          labels={{
                            country: t("storeOrders.createDialog.fields.deliveryCountry"),
                            city: t("storeOrders.createDialog.fields.city"),
                            address: t("storeOrders.createDialog.fields.address"),
                          }}
                          countries={countries}
                          differentCountry={differentCountry}
                          onDifferentCountryChange={setDifferentCountry}
                        />
                      </div>
                    ) : !needsDelivery ? (
                      <p
                        className="text-caption text-muted-foreground"
                        data-testid="no-delivery-note"
                      >
                        {fulfillmentMethod === "PICKUP"
                          ? t("storeOrders.createDialog.entry.pickupNote")
                          : t("storeOrders.createDialog.entry.nonPhysicalNote")}
                      </p>
                    ) : null}
                  </div>
                </FormSection>

                <FormSection title={t("storeOrders.createDialog.sections.orderInfo")}>
                  <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-2 @xl:grid-cols-4">
                    <TextFormField
                      control={form.control}
                      name="externalOrderId"
                      label={t("storeOrders.fields.externalOrderId")}
                      optional
                      dir="ltr"
                    />
                    <DateFormField
                      control={form.control}
                      name="orderDate"
                      label={t("storeOrders.fields.orderDate")}
                    />
                    <ComboboxFormField
                      control={form.control}
                      name="currencyId"
                      label={t("storeOrders.createDialog.fields.currency")}
                      description={
                        noCurrencyDefault
                          ? t("storeOrders.createDialog.entry.noCurrencyDefault")
                          : undefined
                      }
                      onValueChange={() => {
                        currencyTouchedRef.current = true;
                      }}
                      required
                      items={currencies}
                      getId={(currency) => currency.id}
                      getTitle={(currency) => currency.code}
                      getSubtitle={(currency) => currency.name}
                      getSearchText={(currency) => `${currency.code} ${currency.name}`}
                      subtitleDir="ltr"
                      icon={<Banknote className="size-3.5 shrink-0 text-muted-foreground" />}
                    />
                    <SelectFormField
                      control={form.control}
                      name="paymentType"
                      label={t("storeOrders.fields.paymentType")}
                      options={[
                        { value: "PREPAID", label: t("storeOrders.paymentType.PREPAID") },
                        {
                          value: "CASH_ON_DELIVERY",
                          label: t("storeOrders.paymentType.CASH_ON_DELIVERY"),
                        },
                      ]}
                    />
                  </div>
                </FormSection>

                {canDeclarePayment && paymentType !== "CASH_ON_DELIVERY" ? (
                  <PaymentDeclarationFields
                    value={declaration}
                    onChange={(next) => {
                      setDeclaration(next);
                      setShowDeclarationError(false);
                    }}
                    receipts={declarationReceipts}
                    onReceiptsChange={setDeclarationReceipts}
                    total={itemsTotal}
                    remaining={itemsTotal}
                    currency={currencyCode}
                    error={showDeclarationError ? declarationError : null}
                    disabled={isSubmitting}
                  />
                ) : null}

                {/* Optional extras: progressive disclosure, no bordered boxes. */}
                <div className="flex flex-col gap-1 border-t border-border pt-2">
                  <Collapsible defaultOpen={Boolean(form.getValues("notes"))}>
                    <CollapsibleTrigger asChild>
                      <DisclosureTrigger>
                        {t("storeOrders.createDialog.sections.notes")}
                        <span className="font-normal">({t("common.optional")})</span>
                      </DisclosureTrigger>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <TextareaFormField
                        control={form.control}
                        name="notes"
                        label={t("storeOrders.createDialog.fields.notes")}
                        optional
                      />
                    </CollapsibleContent>
                  </Collapsible>
                  <Collapsible defaultOpen={attachmentCount > 0 || Boolean(receiptError)}>
                    <CollapsibleTrigger asChild>
                      <DisclosureTrigger>
                        {t("storeOrders.createDialog.sections.receipts")}
                        <span className="font-normal">({t("common.optional")})</span>
                      </DisclosureTrigger>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div
                        className="flex flex-col gap-3"
                        data-field-name="receipts"
                        data-invalid={receiptError ? "true" : undefined}
                      >
                        <FileDropField files={pendingFiles} onFilesChange={setPendingFiles} />
                        <FileUrlField
                          fileName={receiptName ?? ""}
                          fileUrl={receiptUrl ?? ""}
                          onFileNameChange={(value) =>
                            form.setValue("receiptName", value, { shouldDirty: true })
                          }
                          onFileUrlChange={(value) =>
                            form.setValue("receiptUrl", value, { shouldDirty: true })
                          }
                          onClear={() => {
                            form.setValue("receiptName", "", { shouldDirty: true });
                            form.setValue("receiptUrl", "", { shouldDirty: true });
                          }}
                          namePlaceholder={t("storeOrders.createDialog.fields.receiptName")}
                          urlPlaceholder={t("storeOrders.createDialog.fields.receiptUrl")}
                          error={receiptError}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </>
            ) : null}

            {step === "review" ? (
              <div className="flex flex-col gap-4" data-testid="order-review">
                <p className="text-caption text-muted-foreground">
                  {t("storeOrders.createDialog.steps.reviewDescription")}
                </p>
                <CreateOperationSummary
                  title={t("storeOrders.createDialog.steps.customer")}
                  rows={[
                    {
                      label: t("storeOrders.createDialog.fields.customerName"),
                      value: customerName?.trim() || "—",
                    },
                    {
                      label: t("storeOrders.fields.phone"),
                      value: customerPhone ? <span dir="ltr">{customerPhone}</span> : "—",
                    },
                    {
                      label: t("storeOrders.createDialog.fields.country"),
                      value: countryLabel(countryId),
                    },
                    {
                      label: t("storeOrders.createDialog.fields.customerEmail"),
                      value: existingCustomer
                        ? existingCustomer.email || ""
                        : reviewValues.customerEmail?.trim() || "",
                    },
                  ]}
                />
                <CreateOperationSummary
                  title={t("storeOrders.createDialog.items.title")}
                  rows={namedLines.map((line, index) => ({
                    label: `${index + 1}. ${line.product!.displayName || line.product!.name}`,
                    value: (
                      <span dir="ltr" className="inline-flex flex-wrap justify-end gap-x-1">
                        <span>{line.quantity} ×</span>
                        <MoneyValue value={line.unitPrice} currency={currencyCode} />
                        <span>=</span>
                        <MoneyValue
                          value={line.quantity * line.unitPrice}
                          currency={currencyCode}
                        />
                      </span>
                    ),
                  }))}
                />
                <CreateOperationSummary
                  title={t("storeOrders.createDialog.steps.deliveryPayment")}
                  rows={[
                    {
                      label: t("storeOrders.createDialog.entry.method"),
                      value:
                        fulfillmentMethod === "PICKUP"
                          ? t("storeOrders.createDialog.entry.methodPickup")
                          : t("storeOrders.createDialog.entry.methodShipping"),
                    },
                    {
                      label: t("storeOrders.createDialog.entry.deliverTo"),
                      value: deliveryDestination,
                    },
                    {
                      label: t("storeOrders.fields.externalOrderId"),
                      value: reviewValues.externalOrderId?.trim() ? (
                        <span dir="ltr">{reviewValues.externalOrderId.trim()}</span>
                      ) : (
                        ""
                      ),
                    },
                    {
                      label: t("storeOrders.fields.orderDate"),
                      value: reviewValues.orderDate ? formatDate(reviewValues.orderDate) : "",
                    },
                    {
                      label: t("storeOrders.createDialog.fields.currency"),
                      value: currencyCode,
                    },
                    {
                      label: t("storeOrders.createDialog.fields.notes"),
                      value: reviewValues.notes?.trim() || "",
                    },
                    {
                      label: t("storeOrders.createDialog.sections.receipts"),
                      value:
                        attachmentCount > 0
                          ? t("storeOrders.createDialog.steps.attachmentsCount", {
                              count: attachmentCount,
                            })
                          : "",
                    },
                  ]}
                />
                <div className="flex flex-col gap-1">
                  <CreateOperationSummary
                    title={t("storeOrders.createDialog.summary.title")}
                    rows={[
                      {
                        label: t("storeOrders.createDialog.summary.quantity"),
                        value: <span dir="ltr">{summaryQuantity || "—"}</span>,
                      },
                      {
                        label: t("storeOrders.createDialog.totals.total"),
                        value: <MoneyValue value={itemsTotal} currency={currencyCode} />,
                      },
                      ...(paidAmount > 0
                        ? [
                            {
                              label: t("storeOrders.createDialog.totals.paid"),
                              value: <MoneyValue value={paidAmount} currency={currencyCode} />,
                            },
                            {
                              label: t("storeOrders.createDialog.totals.balance"),
                              value: (
                                <MoneyValue
                                  value={Math.max(itemsTotal - paidAmount, 0)}
                                  currency={currencyCode}
                                />
                              ),
                            },
                          ]
                        : []),
                      {
                        label: t("storeOrders.fields.paymentType"),
                        value: t(PAYMENT_TYPE_LABEL_KEY[paymentType ?? "PREPAID"]),
                      },
                      {
                        label: t("storeOrders.fields.payment"),
                        value:
                          paidAmount > 0
                            ? t("paymentDeclaration.gate.readyDeclared")
                            : paymentType === "CASH_ON_DELIVERY"
                              ? t("storeOrders.paymentStatus.AWAITING_COLLECTION")
                              : t("storeOrders.paymentStatus.AWAITING_RECONCILIATION"),
                      },
                    ]}
                  />
                  <p className="text-caption text-muted-foreground" data-testid="pricing-note">
                    {t("storeOrders.createDialog.steps.pricingNote", {
                      currency: currencyCode || "—",
                    })}
                    {paidAmount > 0
                      ? ` ${t("storeOrders.createDialog.steps.pricingPaidNote")}`
                      : ""}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Form>
    </EnterpriseModal>
  );
}
