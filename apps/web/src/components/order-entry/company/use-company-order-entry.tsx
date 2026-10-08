"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote } from "lucide-react";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { FormSection } from "@/components/documents/form-section";
import {
  applyServerFieldErrors,
  formErrorsFromRhf,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
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
  TextFormField,
} from "@/components/shared/form-fields";
import {
  ProductLineItemsGrid,
  createEmptyLine,
  isLinePriceMissing,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import { FieldMessage } from "@/components/ui/form";
import { PartnerPicker } from "@/components/business/partner-picker";
import { CustomerIdentitySummary } from "@/components/business/customer-identity-summary";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EnterpriseButton } from "@/components/ui/button";
import { localizedName } from "@/lib/localized-name";
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
import {
  ORDER_CREATE_STEP_FIELDS,
  firstStepWithError,
  stepForField,
  type OrderCreateStepId,
} from "@/config/orders/order-create-steps";
import { availabilityShortfalls } from "@/config/orders/line-availability";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { useCountries, useCurrencies } from "@/hooks/use-reference-data";
import { toast, reportApiError, reportSuccess } from "@/lib/toast";
import { PAYMENT_TYPE_LABEL_KEY } from "@/config/store-orders/status";
import type { MessageKey } from "@/i18n/translate";
import { useDuplicateCheck } from "@/hooks/use-duplicate-check";
import { duplicateFromError, orderDuplicatesService } from "@/services/order-duplicates-service";
import type { DuplicateChoice } from "@/config/orders/duplicate-panel";
import type { OrderEntryAdapter, OrderEntryFlowState } from "../order-entry-flow";
import { defaultEntryCountryId, useEntryCountry } from "../use-entry-country";
import { useLineAvailability } from "../use-line-availability";
import {
  AvailabilityNotice,
  CustomerContactFields,
  DuplicateGate,
  NotesDisclosure,
  OrderDeliveryFields,
  OrderTermsFields,
} from "../entry-fields";

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
const COMPANY_ROUTING = { stepForField, firstStepWithError };

export interface StoreOrderCreatePrefillCustomer {
  /** The existing customer (e.g. from Global Lookup) — its duplicate match needs no second answer. */
  id?: string | null;
  name: string;
  phone?: string | null;
  countryId?: string | null;
  city?: string | null;
  address?: string | null;
}

/**
 * The company adapter of the order-entry flow (`POST /store-orders`): New /
 * Existing customer (PartnerPicker + identity summary), company catalog lines
 * with the agreed unit price, delivery, order terms, the optional Sales payment
 * declaration and attachments. One creation key per open — a double submit or
 * a retry after a lost response returns the first order.
 */
export function useCompanyOrderEntry({
  open,
  onOpenChange,
  onCreated,
  prefillCustomer,
  flow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: StoreOrderRow) => void;
  prefillCustomer?: StoreOrderCreatePrefillCustomer | null;
  flow: OrderEntryFlowState;
}): OrderEntryAdapter<StoreOrderCreateFormValues> {
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
  const [creationKey, setCreationKey] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
  // Leaving step 1 was attempted: an unanswered duplicate match is now explained in place.
  const [customerGateAttempted, setCustomerGateAttempted] = useState(false);
  // An existing customer's stored phone failed validation: show it so it can be corrected.
  const [existingPhoneEditable, setExistingPhoneEditable] = useState(false);
  // Existing / New customer — the customer is entered ONCE (design-system §12.22).
  const [customerMode, setCustomerMode] = useState<"new" | "existing">("new");
  // The delivery country follows the customer's country unless the user says otherwise.
  const [differentCountry, setDifferentCountry] = useState(false);
  // Existing customer only: deliver this order somewhere other than the customer's address.
  const [differentAddress, setDifferentAddress] = useState(false);

  // The calling code the phone is read with — the schema reads it at validation time.
  const phoneCountryCodeRef = useRef<string | null>(null);
  // The schema is built at validation time, so it always reads the current calling code.
  const resolver = useCallback<Resolver<StoreOrderCreateFormValues>>(
    (formValues, context, options) =>
      zodResolver(buildStoreOrderCreateSchema(t, () => phoneCountryCodeRef.current))(
        formValues,
        context,
        options,
      ),
    [t],
  );
  const form = useForm<StoreOrderCreateFormValues>({
    resolver,
    defaultValues: storeOrderCreateDefaultValues(),
  });
  const countryId = useWatch({ control: form.control, name: "countryId" });
  const selectedCurrencyId = useWatch({ control: form.control, name: "currencyId" });
  const receiptName = useWatch({ control: form.control, name: "receiptName" });
  const receiptUrl = useWatch({ control: form.control, name: "receiptUrl" });
  const customerName = useWatch({ control: form.control, name: "customerName" });
  const customerPhone = useWatch({ control: form.control, name: "customerPhone" });
  const paymentType = useWatch({ control: form.control, name: "paymentType" });
  const fulfillmentMethod = useWatch({ control: form.control, name: "fulfillmentMethod" });
  const deliveryCountryFieldValue = useWatch({ control: form.control, name: "deliveryCountryId" });

  const setDefaultCountry = useCallback(
    (id: string) => form.setValue("countryId", id, { shouldDirty: false }),
    [form],
  );
  const proposeCurrency = useCallback(
    (id: string) => form.setValue("currencyId", id, { shouldDirty: false }),
    [form],
  );
  const o2CountryId = useMemo(() => defaultEntryCountryId(countries), [countries]);
  const entry = useEntryCountry({
    countryId,
    phoneCountryCodeRef,
    countries,
    currencies,
    getPhone: () => form.getValues("customerPhone"),
    currencyId: selectedCurrencyId,
    onProposeCurrency: proposeCurrency,
    // New customers start in Saudi Arabia (O2) — existing ones keep their own saved country.
    defaultCountryId: customerMode === "new" ? o2CountryId || null : null,
    onDefaultCountry: setDefaultCountry,
  });
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingFiles([]);
    setCreationKey(newIdempotencyKey());
    entry.resetCurrencyTouched();
    entry.setPhoneCountryOverride(
      prefillCustomer
        ? entry.phoneCountryOverrideFor(prefillCustomer.phone, prefillCustomer.countryId)
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
    setCustomerGateAttempted(false);
    setExistingPhoneEditable(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
  // A service never ships — the delivery address is asked unless every chosen line is a service.
  const hasPhysicalLine =
    namedLines.length === 0 || namedLines.some((line) => line.product!.itemType !== "SERVICE");
  const needsDelivery = fulfillmentMethod !== "PICKUP" && hasPhysicalLine;
  const existingCustomer = customerMode === "existing" ? selectedCustomer : null;
  const existingMissingAddress =
    !!existingCustomer && !existingCustomer.city?.trim() && !existingCustomer.address?.trim();
  const showDeliveryFields =
    needsDelivery && (customerMode === "new" || differentAddress || existingMissingAddress);
  const effectiveDeliveryCountryId = differentCountry
    ? deliveryCountryFieldValue || countryId || ""
    : countryId || "";
  const existingNeedsPhone =
    !!existingCustomer && !(existingCustomer.phone || existingCustomer.mobile);
  const summaryQuantity = namedLines.reduce((sum, line) => sum + line.quantity, 0);

  // Spec 1.10 — available-to-sell of the chosen company products.
  const lineProducts = useMemo(
    () =>
      namedLines.map((line) => ({
        id: line.product!.id,
        isInventoryItem: line.product!.isInventoryItem,
        supplyMethod: line.product!.supplyMethod,
      })),
    [namedLines],
  );
  const available = useLineAvailability(lineProducts, "COMPANY");
  const shortfalls = availabilityShortfalls(
    namedLines.map((line) => ({ productId: line.product!.id, quantity: line.quantity })),
    available,
  );
  const productName = (productId: string) => {
    const product = namedLines.find((line) => line.product!.id === productId)?.product;
    return product ? product.displayName || product.name : productId;
  };

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
    // A phone read with another calling code than the customer's country keeps its own code.
    entry.setPhoneCountryOverride(
      entry.phoneCountryOverrideFor(customer.phone || customer.mobile, customer.countryId),
    );
    setDifferentCountry(false);
    setDifferentAddress(false);
    setExistingPhoneEditable(false);
  };

  // Spec 1B duplicate warning — a customer picked explicitly answers its own match.
  const duplicates = useDuplicateCheck({
    phone: customerPhone,
    name: customerName,
    countryId: entry.phoneCountryId,
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
  const resetCustomer = () => {
    setSelectedCustomer(null);
    entry.setPhoneCountryOverride(null);
    setDifferentCountry(false);
    setDifferentAddress(false);
    setExistingPhoneEditable(false);
    clearCustomerFields();
  };
  const switchCustomerMode = (mode: "new" | "existing") => {
    if (mode === customerMode) return;
    setCustomerMode(mode);
    resetCustomer();
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

  // Shown under the duplicate panel once the user tried to leave step 1 with it unanswered.
  const duplicateGateMessage =
    customerGateAttempted && duplicates.blocked
      ? duplicates.state.status === "ready"
        ? t("orderDuplicates.required")
        : t("storeOrders.createDialog.existingCustomer.checking")
      : null;

  /** Line items are flow state, not form fields — checked here (step 2 and Create). */
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

  const onValid = async (values: StoreOrderCreateFormValues) => {
    if (!validateLines()) {
      flow.goToStep("products", { focusInvalid: true });
      return;
    }
    if (declarationError) {
      setShowDeclarationError(true);
      flow.goToStep("deliveryPayment", { focusInvalid: true });
      return;
    }
    if (declarationReceipts.some((item) => item.status === "uploading")) return;
    if (!validateReceiptPair()) {
      flow.goToStep("deliveryPayment", { focusInvalid: true });
      return;
    }
    const hasReceiptName = Boolean(values.receiptName?.trim());
    const hasReceiptUrl = Boolean(values.receiptUrl?.trim());
    if (duplicates.blocked) {
      setCustomerGateAttempted(true);
      flow.goToStep("customer", { focusInvalid: true });
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
        flow.goToStep("customer", { focusInvalid: true });
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
      if (target) flow.goToStep(target, { focusInvalid: true });
      else flow.focusFirstInvalid();
      reportApiError(error, "common.failedToSave");
    }
  };

  const submit = async () => {
    setSubmitAttempted(true);
    setServerErrors([]);
    await form.handleSubmit(onValid, (errors) => {
      if (existingCustomer && errors.customerPhone) setExistingPhoneEditable(true);
      const target = firstStepWithError(Object.keys(errors));
      if (target) flow.goToStep(target, { focusInvalid: true });
      else flow.focusFirstInvalid();
    })();
  };

  const countryLabel = (id?: string | null) => {
    const country = id ? countries.find((item) => item.id === id) : undefined;
    return country ? localizedName(country, locale) : "";
  };
  const attachmentCount = pendingFiles.length + (receiptName?.trim() && receiptUrl?.trim() ? 1 : 0);
  const showCustomerPhone =
    customerMode === "new" || existingNeedsPhone || (!!existingCustomer && existingPhoneEditable);

  const customerStep = (
    <FormSection title={t("storeOrders.createDialog.sections.customer")}>
      <div className="flex flex-col gap-3">
        <ToggleGroup
          type="single"
          value={customerMode}
          onValueChange={(value) => value && switchCustomerMode(value as "new" | "existing")}
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
            onChange={resetCustomer}
          />
        ) : null}

        {showCustomerPhone ? (
          <CustomerContactFields
            control={form.control}
            names={{ name: "customerName", countryId: "countryId", phone: "customerPhone" }}
            countries={countries}
            phoneCountryCode={entry.phoneCountryCode}
            onPhoneCode={entry.selectPhoneCode}
            onCountryChosen={entry.onCountryChosen}
            phoneOnly={customerMode !== "new"}
          />
        ) : null}

        <DuplicateGate
          state={duplicates.state}
          onChoose={chooseDuplicate}
          orderHref={(id) => `/store-orders/${id}`}
          onEditDetails={() => form.setFocus("customerPhone")}
          onCancel={() => onOpenChange(false)}
          gateMessage={duplicateGateMessage}
          showPanel={
            customerMode === "new" ||
            existingNeedsPhone ||
            (duplicates.blocked && duplicates.state.status === "ready")
          }
        />

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
  );

  const productsStep = (
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
        <AvailabilityNotice shortfalls={shortfalls} productName={productName} />
      </div>
    </FormSection>
  );

  const existingAddressChoice =
    existingCustomer && needsDelivery && !existingMissingAddress ? (
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
    ) : null;

  const deliveryPaymentStep = (
    <>
      <FormSection title={t("storeOrders.createDialog.entry.deliveryTitle")}>
        <div className="flex flex-col gap-3">
          <OrderTermsFields
            control={form.control}
            names={{ method: "fulfillmentMethod", paymentType: "paymentType" }}
          />
          {existingAddressChoice}
          <OrderDeliveryFields
            control={form.control}
            names={{ countryId: "deliveryCountryId", city: "city", address: "address" }}
            countries={countries}
            needsDelivery={needsDelivery}
            showFields={showDeliveryFields}
            pickup={fulfillmentMethod === "PICKUP"}
            differentCountry={differentCountry}
            onDifferentCountryChange={setDifferentCountry}
            before={
              showDeliveryFields && existingCustomer ? (
                <p className="text-caption font-medium text-muted-foreground">
                  {existingMissingAddress
                    ? t("storeOrders.createDialog.entry.missingAddress")
                    : t("storeOrders.createDialog.entry.orderOnlyNote")}
                </p>
              ) : null
            }
          />
        </div>
      </FormSection>

      <FormSection title={t("storeOrders.createDialog.sections.orderInfo")}>
        <div className="grid grid-cols-1 items-start gap-x-3 gap-y-2 @md:grid-cols-3">
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
              entry.noCurrencyDefault
                ? t("storeOrders.createDialog.entry.noCurrencyDefault")
                : undefined
            }
            onValueChange={entry.markCurrencyTouched}
            required
            items={currencies}
            getId={(currency) => currency.id}
            getTitle={(currency) => currency.code}
            getSubtitle={(currency) => currency.name}
            getSearchText={(currency) => `${currency.code} ${currency.name}`}
            subtitleDir="ltr"
            icon={<Banknote className="size-3.5 shrink-0 text-muted-foreground" />}
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
          disabled={form.formState.isSubmitting}
        />
      ) : null}

      {/* Optional extras: progressive disclosure, no bordered boxes. */}
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <NotesDisclosure
          control={form.control}
          name="notes"
          defaultOpen={Boolean(form.getValues("notes"))}
        />
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
  );

  const reviewStep = () => {
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
              value: customerName?.trim() || "—",
            },
            {
              label: t("storeOrders.fields.phone"),
              value: customerPhone ? <span dir="ltr">{customerPhone}</span> : "—",
            },
            { label: t("storeOrders.createDialog.fields.country"), value: countryLabel(countryId) },
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
                <MoneyValue value={line.quantity * line.unitPrice} currency={currencyCode} />
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
              value:
                fulfillmentMethod === "PICKUP"
                  ? t("storeOrders.createDialog.entry.methodPickup")
                  : t("storeOrders.createDialog.entry.methodShipping"),
            },
            { label: t("storeOrders.createDialog.entry.deliverTo"), value: deliveryDestination },
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
            { label: t("storeOrders.createDialog.fields.currency"), value: currencyCode },
            {
              label: t("storeOrders.createDialog.fields.notes"),
              value: reviewValues.notes?.trim() || "",
            },
            {
              label: t("storeOrders.createDialog.sections.receipts"),
              value:
                attachmentCount > 0
                  ? t("storeOrders.createDialog.steps.attachmentsCount", { count: attachmentCount })
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
            {t("storeOrders.createDialog.steps.pricingNote", { currency: currencyCode || "—" })}
            {paidAmount > 0 ? ` ${t("storeOrders.createDialog.steps.pricingPaidNote")}` : ""}
          </p>
        </div>
      </div>
    );
  };

  return {
    form,
    routing: COMPANY_ROUTING,
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
    isDirty: form.formState.isDirty,
    finalLabel: t("storeOrders.createDialog.submit"),
    finalDisabled: declarationReceipts.some((item) => item.status === "uploading"),
  };
}
