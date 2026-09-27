"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
} from "@/components/shared/create-operation";
import {
  FormErrorSummary,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { AmountStrip, FormSection } from "@/components/documents/form-section";
import { EnterpriseButton } from "@/components/ui/button";
import { FieldMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ProductLineItemsGrid,
  createEmptyLine,
  isLinePriceMissing,
  type ProductLineItemsGridLine,
} from "@/components/sales/product-line-items-grid";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { useCurrencies, usePaymentMethods, useCountries } from "@/hooks/use-reference-data";
import {
  PaymentDeclarationFields,
  declarationErrorItem,
} from "@/components/payments/declaration/payment-declaration-fields";
import {
  buildDeclarationPayload,
  declarationAmount,
  emptyDeclaration,
  validateDeclaration,
  type DeclarationError,
  type DeclarationFormState,
} from "@/components/payments/declaration/declaration-logic";
import { leadsService, type LeadRow } from "@/services/leads-service";
import type { ProductRow } from "@/services/products-service";
import type { CityRow, CurrencyRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { apiErrorMessage, reportApiError, reportSuccess } from "@/lib/toast";
import { formatMoney } from "@/lib/money";
import { createMasterDataService } from "@/services/master-data-service";
import { stagingIdsOf, type ReceiptUploadItem } from "@/components/business/payment-receipts-field";
import { attachmentsService } from "@/services/attachments-service";

const citiesService = createMasterDataService<CityRow>("/cities");

type ValidationIssue =
  | { kind: "lines"; message: string }
  | { kind: "declaration"; error: DeclarationError }
  | { kind: "address"; message: string };

/** Read-only lead facts — a compact label/value grid, not disabled inputs. */
function LeadFact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="truncate text-body font-medium text-foreground" title={value}>
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </dd>
    </div>
  );
}

/**
 * Lead → Store Order. One modal surface with heading + hairline sections
 * (customer facts · products · settlement · payment declaration · shipping),
 * product lines across the full dialog width, compact figures, and a
 * `FormErrorSummary` on a failed step. "Summary" reviews before creating.
 */
export function LeadConvertDialog({
  lead,
  open,
  onOpenChange,
  onConverted,
}: {
  lead: LeadRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted: (result: LeadRow) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const currencies = useCurrencies();
  const currencyFieldId = useId();
  const paymentTypeFieldId = useId();
  const fulfillmentFieldId = useId();
  const countryFieldId = useId();
  const cityFieldId = useId();
  const addressFieldId = useId();
  const paymentMethods = usePaymentMethods();
  const countries = useCountries();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  const [step, setStep] = useState<"form" | "summary">("form");
  const [isSaving, setIsSaving] = useState(false);
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([]);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [paymentType, setPaymentType] = useState<"PREPAID" | "CASH_ON_DELIVERY">("PREPAID");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"SHIPPING" | "PICKUP">("SHIPPING");
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  // Sales payment declaration (Unpaid / Paid in full / Partial) — the same
  // form and server service as the order page; never a free "amount paid".
  const [declaration, setDeclaration] = useState<DeclarationFormState>(() =>
    emptyDeclaration("UNPAID"),
  );
  const [receiptItems, setReceiptItems] = useState<ReceiptUploadItem[]>([]);
  const [countryId, setCountryId] = useState(lead.countryId);
  const [city, setCity] = useState(lead.city ?? "");
  const [address, setAddress] = useState(lead.address ?? "");
  const [notes, setNotes] = useState("");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [issue, setIssue] = useState<ValidationIssue | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep("form");
    setIssue(null);
    setServerError(null);
    setShowLineErrors(false);
    setLines([
      {
        ...createEmptyLine(),
        product: lead.product
          ? ({
              id: lead.product.id,
              name: lead.product.name,
              displayName: lead.product.displayName,
              sku: lead.product.sku,
            } as ProductRow)
          : null,
        quantity: lead.quantity || 1,
        // The agreed amount is entered by the user — blank, never a silent 0.
        lineAmount: null,
      },
    ]);
    setPaymentType("PREPAID");
    setCurrency(currencies.find((c) => c.id === lead.currencyId) ?? null);
    setDeclaration(emptyDeclaration("UNPAID"));
    setReceiptItems([]);
    setCountryId(lead.countryId);
    setCity(lead.city ?? "");
    setAddress(lead.address ?? "");
    setNotes("");
  }, [open, lead, currencies]);

  useEffect(() => {
    if (!open || !countryId) return;
    citiesService
      .list({ pageSize: 300, countryId } as { pageSize: number; countryId: string })
      .then((result) => setCities(result.items.filter((row) => !row.deletedAt)))
      .catch(() => setCities([]));
  }, [open, countryId]);

  const productLines = lines.filter((line) => line.product);
  const orderTotal = productLines.reduce((sum, line) => sum + (line.lineAmount ?? 0), 0);
  const declares = paymentType === "PREPAID" && declaration.kind !== "UNPAID";
  const paid = declares ? declarationAmount(declaration, orderTotal) : 0;
  const remaining = Math.max(orderTotal - paid, 0);
  const paymentMethod =
    paymentMethods.find((row) => row.id === declaration.paymentMethodId) ?? null;
  const selectedCountry = countries.find((c) => c.id === countryId) ?? null;
  const selectedCity = cities.find((c) => c.name === city) ?? null;
  const currencyCode = currency?.code ?? "";

  const findIssue = (): ValidationIssue | null => {
    if (productLines.length === 0) {
      return { kind: "lines", message: t("crm.leads.convert.validation.product") };
    }
    if (productLines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      return { kind: "lines", message: t("crm.leads.convert.validation.quantity") };
    }
    if (productLines.some((line) => isLinePriceMissing(line, "lineAmount"))) {
      return { kind: "lines", message: t("crm.leads.convert.validation.amount") };
    }
    if (orderTotal <= 0) {
      return { kind: "lines", message: t("crm.leads.convert.validation.total") };
    }
    const declarationError = declares
      ? validateDeclaration(declaration, { total: orderTotal, remaining: orderTotal })
      : null;
    if (declarationError) return { kind: "declaration", error: declarationError };
    if (!address.trim() && !city.trim()) {
      return { kind: "address", message: t("crm.leads.convert.validation.shipping") };
    }
    return null;
  };

  const validate = (): boolean => {
    const found = findIssue();
    setIssue(found);
    if (found?.kind === "lines") setShowLineErrors(true);
    if (found) focusFirstInvalid();
    return !found;
  };

  // A fixed problem clears its summary item as the user edits.
  const liveIssue = issue ? findIssue() : null;
  const summaryItems: FormErrorItem[] = [
    ...(liveIssue?.kind === "lines"
      ? [
          {
            fieldId: "lines",
            label: t("crm.leads.convert.sectionProducts"),
            message: liveIssue.message,
          },
        ]
      : []),
    ...(liveIssue?.kind === "declaration" ? [declarationErrorItem(liveIssue.error, t)] : []),
    ...(liveIssue?.kind === "address"
      ? [
          {
            fieldId: addressFieldId,
            label: t("crm.leads.fields.address"),
            message: liveIssue.message,
          },
        ]
      : []),
    ...(serverError ? [{ message: serverError }] : []),
  ];

  const submit = async () => {
    if (!validate()) {
      setStep("form");
      return;
    }
    setIsSaving(true);
    setServerError(null);
    try {
      const result = await leadsService.convert(lead.id, {
        items: productLines.map((line) => ({
          productId: line.product!.id,
          quantity: line.quantity,
          agreedAmount: line.lineAmount!,
        })),
        paymentType,
        fulfillmentMethod,
        currencyId: currency?.id ?? lead.currencyId,
        // The conversion claim is idempotent per lead server-side.
        ...(declares
          ? (() => {
              const payload = buildDeclarationPayload(declaration, undefined);
              return {
                declarationKind: payload.kind,
                amountPaid: payload.amount,
                paymentMethodId: payload.paymentMethodId,
                paymentDate: payload.paymentDate,
                paymentReference: payload.referenceNumber,
                stagingAttachmentIds: stagingIdsOf(receiptItems),
              };
            })()
          : { declarationKind: "UNPAID" }),
        countryId,
        city: city.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      reportSuccess(
        `${t("crm.leads.convert.success")} ${result.storeOrder?.internalOrderId ?? ""}`.trim(),
        result.storeOrder
          ? { href: `/store-orders/${result.storeOrder.id}`, navigate: router.push }
          : {},
      );
      onOpenChange(false);
      onConverted(result);
    } catch (error) {
      setServerError(apiErrorMessage(error, "common.failedToSave"));
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const countryOptions = useMemo(() => countries.filter((c) => !c.deletedAt), [countries]);
  const paymentTypeItems = [
    { id: "PREPAID", name: t("crm.leads.convert.prepaid") },
    { id: "CASH_ON_DELIVERY", name: t("crm.leads.convert.cod") },
  ];
  const fulfillmentItems = [
    { id: "SHIPPING", name: t("crm.leads.convert.shipping") },
    { id: "PICKUP", name: t("crm.leads.convert.pickup") },
  ];

  const figures = (
    <AmountStrip
      label={t("crm.leads.convert.orderTotal")}
      items={[
        ...(declares
          ? [
              {
                key: "paid",
                label: t("crm.leads.convert.amountPaid"),
                value: formatMoney(paid),
              },
              {
                key: "remaining",
                label: t("crm.leads.convert.remaining"),
                value: formatMoney(remaining),
              },
            ]
          : []),
        {
          key: "total",
          label: t("crm.leads.convert.orderTotal"),
          value: `${formatMoney(orderTotal)} ${currencyCode}`.trim(),
          strong: true,
        },
      ]}
    />
  );

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      icon={ShoppingCart}
      title={t("crm.leads.convert.title")}
      description={t("crm.leads.convert.description")}
      errorSummary={<FormErrorSummary errors={summaryItems} />}
      footer={(requestClose) =>
        step === "summary" ? (
          <>
            <EnterpriseButton variant="outline" onClick={() => setStep("form")}>
              {t("crm.leads.convert.backToEdit")}
            </EnterpriseButton>
            <EnterpriseButton
              variant="success"
              isLoading={isSaving}
              disabled={isSaving || receiptItems.some((item) => item.status === "uploading")}
              onClick={() => void submit()}
            >
              {t("crm.leads.convert.confirmCreate")}
            </EnterpriseButton>
          </>
        ) : (
          <CreateOperationFooter
            requestClose={requestClose}
            onSubmit={() => {
              if (validate()) setStep("summary");
            }}
            isSubmitting={false}
            submitLabel={t("common.summary")}
          />
        )
      }
    >
      {step === "form" ? (
        <div ref={bodyRef} className="flex flex-col gap-4">
          <FormSection title={t("crm.leads.convert.sectionCustomer")}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @2xl:grid-cols-4">
              <LeadFact label={t("crm.leads.fields.customerName")} value={lead.customerName} />
              <LeadFact label={t("crm.leads.fields.mobileNumber")} value={lead.mobileNumber} ltr />
              <LeadFact
                label={t("crm.leads.convert.owner")}
                value={lead.salesEmployee?.fullName ?? "—"}
              />
              <LeadFact label={t("crm.leads.fields.source")} value={lead.source} ltr />
            </dl>
          </FormSection>

          <FormSection
            title={t("crm.leads.convert.sectionProducts")}
            data-field-name="lines"
            data-invalid={liveIssue?.kind === "lines" ? "true" : undefined}
          >
            <ProductLineItemsGrid
              lines={lines}
              onChange={(next) => {
                setLines(next);
                setServerError(null);
              }}
              requireWarehouse={false}
              showWarehouse={false}
              showUnit={false}
              showDiscount={false}
              showTax={false}
              showDescription={false}
              priceMode="lineAmount"
              unitPriceLabel={t("crm.leads.convert.agreedAmount")}
              requirePrice
              showErrors={showLineErrors}
            />
            {liveIssue?.kind === "lines" ? (
              <FieldMessage announce={false}>{liveIssue.message}</FieldMessage>
            ) : null}
          </FormSection>

          <FormSection title={t("crm.leads.convert.sectionPayment")}>
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2 @3xl:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={paymentTypeFieldId}>{t("crm.leads.convert.paymentType")}</Label>
                <EntityCombobox
                  id={paymentTypeFieldId}
                  value={paymentTypeItems.find((item) => item.id === paymentType) ?? null}
                  onChange={(value) => {
                    const next = (value?.id as "PREPAID" | "CASH_ON_DELIVERY") ?? "PREPAID";
                    setPaymentType(next);
                    if (next === "CASH_ON_DELIVERY") {
                      for (const item of receiptItems) {
                        if (item.staging) {
                          void attachmentsService
                            .discardStaging(item.staging.id)
                            .catch(() => undefined);
                        }
                      }
                      setReceiptItems([]);
                      setDeclaration(emptyDeclaration("UNPAID"));
                    }
                  }}
                  items={paymentTypeItems}
                  getId={(item) => item.id}
                  getTitle={(item) => item.name}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={fulfillmentFieldId}>
                  {t("crm.leads.convert.fulfillmentMethod")}
                </Label>
                <EntityCombobox
                  id={fulfillmentFieldId}
                  value={fulfillmentItems.find((item) => item.id === fulfillmentMethod) ?? null}
                  onChange={(value) => {
                    setFulfillmentMethod((value?.id as "SHIPPING" | "PICKUP") ?? "SHIPPING");
                  }}
                  items={fulfillmentItems}
                  getId={(item) => item.id}
                  getTitle={(item) => item.name}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={currencyFieldId}>{t("crm.leads.fields.currency")}</Label>
                <CurrencyPicker
                  id={currencyFieldId}
                  valueKey="id"
                  value={currency?.id ?? ""}
                  onValueChange={(id) =>
                    setCurrency(currencies.find((row) => row.id === id) ?? null)
                  }
                />
              </div>
            </div>
          </FormSection>

          {paymentType === "PREPAID" ? (
            <PaymentDeclarationFields
              value={declaration}
              onChange={(next) => {
                setDeclaration(next);
                setServerError(null);
              }}
              receipts={receiptItems}
              onReceiptsChange={setReceiptItems}
              total={orderTotal}
              remaining={orderTotal}
              currency={currency}
              error={liveIssue?.kind === "declaration" ? liveIssue.error : null}
              disabled={isSaving}
            />
          ) : null}

          <FormSection title={t("crm.leads.convert.sectionShipping")}>
            <div className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2 @3xl:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={countryFieldId}>{t("crm.leads.fields.country")}</Label>
                <EntityCombobox
                  id={countryFieldId}
                  value={selectedCountry}
                  onChange={(value) => {
                    setCountryId(value?.id ?? lead.countryId);
                    setCity("");
                  }}
                  items={countryOptions}
                  getId={(item) => item.id}
                  getTitle={(item) => item.name}
                  getSearchText={(item) => `${item.code} ${item.name}`}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={cityFieldId}>{t("crm.leads.fields.city")}</Label>
                {cities.length > 0 ? (
                  <EntityCombobox
                    id={cityFieldId}
                    value={selectedCity}
                    onChange={(value) => setCity(value?.name ?? "")}
                    items={cities}
                    getId={(item) => item.id}
                    getTitle={(item) => item.name}
                    allowClear
                  />
                ) : (
                  <Input
                    id={cityFieldId}
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                  />
                )}
              </div>
              <div className="col-span-full flex min-w-0 flex-col gap-1 @3xl:col-span-1 @3xl:row-span-2">
                <Label htmlFor={addressFieldId}>{t("crm.leads.fields.address")}</Label>
                <Textarea
                  id={addressFieldId}
                  value={address}
                  aria-invalid={liveIssue?.kind === "address" || undefined}
                  onChange={(event) => setAddress(event.target.value)}
                  rows={2}
                />
                {liveIssue?.kind === "address" ? (
                  <FieldMessage announce={false}>{liveIssue.message}</FieldMessage>
                ) : null}
              </div>
            </div>
          </FormSection>

          {figures}
        </div>
      ) : (
        <CreateOperationLayout>
          <CreateOperationSummary
            title={t("crm.leads.convert.sectionSummary")}
            rows={[
              { label: t("crm.leads.fields.customerName"), value: lead.customerName },
              { label: t("crm.leads.fields.mobileNumber"), value: lead.mobileNumber },
              { label: t("crm.leads.convert.owner"), value: lead.salesEmployee?.fullName ?? "—" },
              { label: t("crm.leads.fields.source"), value: lead.source },
              {
                label: t("crm.leads.convert.sectionProducts"),
                value: productLines
                  .map(
                    (line) =>
                      `${line.product?.displayName ?? line.product?.name} × ${line.quantity} = ${formatMoney(line.lineAmount ?? 0)}`,
                  )
                  .join(" · "),
              },
              {
                label: t("crm.leads.convert.paymentType"),
                value:
                  paymentType === "CASH_ON_DELIVERY"
                    ? t("crm.leads.convert.cod")
                    : t("crm.leads.convert.prepaid"),
              },
              {
                label: t("crm.leads.convert.fulfillmentMethod"),
                value:
                  fulfillmentMethod === "PICKUP"
                    ? t("crm.leads.convert.pickup")
                    : t("crm.leads.convert.shipping"),
              },
              {
                label: t("paymentDeclaration.dialog.question"),
                value:
                  paymentType === "PREPAID"
                    ? t(`paymentDeclaration.dialog.kinds.${declaration.kind}`)
                    : undefined,
              },
              { label: t("crm.leads.convert.paymentMethod"), value: paymentMethod?.name },
              { label: t("crm.leads.fields.currency"), value: currency?.code },
              {
                label: t("crm.leads.convert.sectionShipping"),
                value: [selectedCountry?.name, city, address].filter(Boolean).join(" — "),
              },
            ]}
          />
          {figures}
        </CreateOperationLayout>
      )}
    </EnterpriseModal>
  );
}
