"use client";

import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Globe } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ModalFieldFullWidth } from "@/components/shared/modal-section";
import { FormSection } from "@/components/documents/form-section";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  formErrorsFromRhf,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CreateOperationFooter,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
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
import { FieldLabel, FieldMessage, Form } from "@/components/ui/form";
import { PartnerPicker } from "@/components/business/partner-picker";
import { PhoneCountrySelector } from "@/components/shared/phone-country-selector";
import { defaultPhoneCountry, parsePhone } from "@/services/phone-service";
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
import {
  partnersService,
  type CustomerGlobalLookupResult,
  type PartnerPickerRow,
} from "@/services/partners-service";
import {
  buildStoreOrderCreateSchema,
  storeOrderCreateDefaultValues,
  type StoreOrderCreateFormValues,
} from "@/config/store-orders/store-order-create-schema";
import { useLocale } from "@/providers/locale-provider";
import { localizedName } from "@/lib/localized-name";
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
  city: "storeOrders.createDialog.fields.city",
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

  // Phone country ≠ shipping destination (phone-field.md): the phone country
  // follows the shipping country until the user picks one explicitly
  // (`phoneCountryOverride`), and a legitimate difference is kept. Not a form
  // field — the committed E.164 value already carries its country.
  const [phoneCountryOverride, setPhoneCountryOverride] = useState<string | null>(null);
  const phoneCountryCodeRef = useRef<string | null>(null);
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
    setPhoneCountryOverride(
      prefillCustomer
        ? phoneCountryOverrideFor(prefillCustomer.phone, prefillCustomer.countryId)
        : null,
    );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
  const phoneCountryId = phoneCountryOverride ?? (countryId || defaultPhoneCountryId);
  const phoneCountryCode = countries.find((country) => country.id === phoneCountryId)?.code ?? null;
  useEffect(() => {
    phoneCountryCodeRef.current = phoneCountryCode;
  }, [phoneCountryCode]);

  /** The phone's own country (from a stored E.164) when it differs from the customer's shipping country — otherwise follow the shipping country. */
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
    // Vice versa: an empty shipping country defaults to the phone country.
    if (id && !form.getValues("countryId")) {
      form.setValue("countryId", id, { shouldDirty: true });
    }
  };
  const defaultCurrencyId =
    currencies.find((currency) => currency.code === "SAR")?.id ?? currencies[0]?.id ?? "";

  useEffect(() => {
    if (defaultCurrencyId && !selectedCurrencyId) {
      form.setValue("currencyId", defaultCurrencyId, { shouldDirty: false });
    }
  }, [defaultCurrencyId, selectedCurrencyId, form]);
  const currencyCode =
    currencies.find((currency) => currency.id === (selectedCurrencyId || defaultCurrencyId))
      ?.code ?? "";

  const itemsTotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const declares =
    canDeclarePayment && paymentType !== "CASH_ON_DELIVERY" && declaration.kind !== "UNPAID";
  const declarationError = declares
    ? validateDeclaration(declaration, { total: itemsTotal, remaining: itemsTotal })
    : null;
  const paidAmount = declares ? declarationAmount(declaration, itemsTotal) : 0;
  const namedLines = lines.filter((line) => line.product);
  const summaryProduct =
    namedLines.map((line) => line.product!.displayName || line.product!.name).join(" · ") || "—";
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
    form.setValue("city", customer.city || "", { shouldDirty: true });
    form.setValue("address", customer.address || "", { shouldDirty: true });
    setPhoneCountryOverride(
      phoneCountryOverrideFor(customer.phone || customer.mobile, customer.countryId),
    );
  };

  const applyExistingCustomer = (customer: CustomerGlobalLookupResult) => {
    form.setValue("customerName", customer.name, { shouldDirty: true, shouldValidate: true });
    form.setValue("customerPhone", customer.phone || customer.mobile || "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("countryId", customer.countryId || "", { shouldDirty: true });
    form.setValue("city", customer.city || "", { shouldDirty: true });
    form.setValue("address", customer.address || "", { shouldDirty: true });
    setPhoneCountryOverride(
      phoneCountryOverrideFor(customer.phone || customer.mobile, customer.countryId),
    );
    toast.success(t("storeOrders.createDialog.existingCustomer.applied"));
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
          if (customer?.id === choice.customerId) applyExistingCustomer(customer);
        })
        .catch(() => undefined);
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
          ? [{ fieldId: "customerPhone", message: t("orderDuplicates.required") }]
          : []),
        ...serverErrors,
      ]
    : [];

  const onValid = async (values: StoreOrderCreateFormValues) => {
    const validLines = lines.filter((line) => line.product && line.quantity > 0);
    if (validLines.length === 0) {
      setItemsError(t("storeOrders.createDialog.items.required"));
      focusFirstInvalid();
      return;
    }
    setItemsError(null);
    // The agreed price is required — a blank or 0 price is never sent as a 0.00 order.
    if (validLines.some((line) => isLinePriceMissing(line))) {
      setShowLineErrors(true);
      focusFirstInvalid();
      return;
    }

    if (declarationError) {
      setShowDeclarationError(true);
      focusFirstInvalid();
      return;
    }
    if (declarationReceipts.some((item) => item.status === "uploading")) return;

    const hasReceiptName = Boolean(values.receiptName?.trim());
    const hasReceiptUrl = Boolean(values.receiptUrl?.trim());
    if (hasReceiptName !== hasReceiptUrl) {
      setReceiptError(t("storeOrders.createDialog.receiptIncomplete"));
      return;
    }
    setReceiptError(null);
    if (duplicates.blocked) {
      focusFirstInvalid();
      return;
    }

    try {
      const created = await storeOrdersService.create({
        externalOrderId: values.externalOrderId || undefined,
        partner: {
          name: values.customerName,
          phone: values.customerPhone || undefined,
          email: values.customerEmail || undefined,
          countryId: values.countryId || undefined,
          city: values.city || undefined,
          address: values.address || undefined,
        },
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
      // The server found a customer the panel had not answered — reopen it.
      const duplicate = duplicateFromError(error);
      if (duplicate) {
        duplicates.applyServerResult(duplicate);
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
      focusFirstInvalid();
      reportApiError(error, "common.failedToSave");
    }
  };

  const submit = () => {
    setSubmitAttempted(true);
    setServerErrors([]);
    return form.handleSubmit(onValid, () => focusFirstInvalid())();
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("storeOrders.createDialog.title")}
      description={t("storeOrders.createDialog.description")}
      isDirty={isDirty}
      errorSummary={<FormErrorSummary errors={summaryErrors} />}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSubmitting}
          submitDisabled={duplicates.blocked}
          submitLabel={t("storeOrders.createDialog.submit")}
        />
      )}
    >
      <Form {...form}>
        <div ref={bodyRef} className="flex flex-col gap-4">
          <FormSection title={t("storeOrders.createDialog.sections.customer")}>
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2 @2xl:grid-cols-3 items-start">
              <ModalFieldFullWidth>
                <div className="flex flex-col gap-1">
                  <FieldLabel>{t("storeOrders.createDialog.fields.customer")}</FieldLabel>
                  <PartnerPicker
                    role="CUSTOMER"
                    value={selectedCustomer}
                    onChange={applyCustomer}
                    className="max-w-none"
                  />
                </div>
              </ModalFieldFullWidth>
              <TextFormField
                control={form.control}
                name="customerName"
                label={t("storeOrders.createDialog.fields.customerName")}
                required
              />
              <div className="flex flex-col gap-1">
                <FieldLabel>{t("phone.phoneCountryLabel")}</FieldLabel>
                <PhoneCountrySelector
                  value={phoneCountryId}
                  onChange={selectPhoneCountry}
                  countries={countries}
                />
              </div>
              <PhoneFormField
                control={form.control}
                name="customerPhone"
                label={t("storeOrders.fields.phone")}
                required
                countryCode={phoneCountryCode}
                availableCountryCodes={countries.map((country) => country.code)}
                onCountryChange={(iso2) => {
                  const match = countries.find((country) => country.code === iso2);
                  if (match) selectPhoneCountry(match.id);
                }}
              />
              <ModalFieldFullWidth>
                <DuplicateCustomerPanel
                  state={duplicates.state}
                  onChoose={chooseDuplicate}
                  orderHref={(id) => `/store-orders/${id}`}
                  onEditDetails={() => form.setFocus("customerPhone")}
                />
              </ModalFieldFullWidth>
              <ComboboxFormField
                control={form.control}
                name="countryId"
                label={t("storeOrders.createDialog.fields.country")}
                optional
                items={countries}
                getId={(country) => country.id}
                getTitle={(country) => localizedName(country, locale)}
                getSearchText={(country) =>
                  [country.name, country.nameEn, country.code, country.iso3, country.callingCode]
                    .filter(Boolean)
                    .join(" ")
                }
                allowClear
                icon={<Globe className="size-3.5 shrink-0 text-muted-foreground" />}
              />
              <TextFormField
                control={form.control}
                name="city"
                label={t("storeOrders.createDialog.fields.city")}
                optional
              />
              <TextFormField
                control={form.control}
                name="customerEmail"
                label={t("storeOrders.createDialog.fields.customerEmail")}
                optional
                dir="ltr"
                inputMode="email"
              />
              <ModalFieldFullWidth>
                <TextFormField
                  control={form.control}
                  name="address"
                  label={t("storeOrders.createDialog.fields.address")}
                  optional
                />
              </ModalFieldFullWidth>
            </div>
          </FormSection>

          <FormSection title={t("storeOrders.createDialog.sections.orderInfo")}>
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2 @2xl:grid-cols-4">
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
            <Collapsible>
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
            <Collapsible>
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

          <CreateOperationSummary
            title={t("storeOrders.createDialog.summary.title")}
            rows={[
              {
                label: t("storeOrders.createDialog.fields.customer"),
                value: customerName?.trim() || "—",
              },
              {
                label: t("storeOrders.createDialog.summary.product"),
                value: summaryProduct,
              },
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
        </div>
      </Form>
    </EnterpriseModal>
  );
}
