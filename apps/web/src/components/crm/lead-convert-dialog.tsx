"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import {
  CreateOperationFooter,
  CreateOperationLayout,
  CreateOperationSummary,
  CreateOperationTotals,
} from "@/components/shared/create-operation";
import { ModalSection } from "@/components/shared/modal-section";
import { EnterpriseButton } from "@/components/ui/button";
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
import { leadsService, type LeadRow } from "@/services/leads-service";
import { ApiError } from "@/services/api-client";
import type { ProductRow } from "@/services/products-service";
import type { CityRow, CurrencyRow, PaymentMethodRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { createMasterDataService } from "@/services/master-data-service";
import {
  PaymentReceiptsField,
  stagingIdsOf,
  type ReceiptUploadItem,
} from "@/components/business/payment-receipts-field";
import { attachmentsService } from "@/services/attachments-service";

const citiesService = createMasterDataService<CityRow>("/cities");

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
  const { t, locale } = useLocale();
  const currencies = useCurrencies();
  const currencyFieldId = useId();
  const paymentMethods = usePaymentMethods();
  const countries = useCountries();

  const [step, setStep] = useState<"form" | "summary">("form");
  const [isSaving, setIsSaving] = useState(false);
  const [lines, setLines] = useState<ProductLineItemsGridLine[]>([]);
  const [showLineErrors, setShowLineErrors] = useState(false);
  const [paymentType, setPaymentType] = useState<"PREPAID" | "CASH_ON_DELIVERY">("PREPAID");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"SHIPPING" | "PICKUP">("SHIPPING");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [amountPaid, setAmountPaid] = useState("0");
  const [paymentReference, setPaymentReference] = useState("");
  const [receiptItems, setReceiptItems] = useState<ReceiptUploadItem[]>([]);
  const [countryId, setCountryId] = useState(lead.countryId);
  const [city, setCity] = useState(lead.city ?? "");
  const [address, setAddress] = useState(lead.address ?? "");
  const [notes, setNotes] = useState("");
  const [cities, setCities] = useState<CityRow[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep("form");
    setFieldError(null);
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
    setPaymentMethod(null);
    setCurrency(currencies.find((c) => c.id === lead.currencyId) ?? null);
    setAmountPaid("0");
    setPaymentReference("");
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
  const paid = Number(amountPaid) || 0;
  const remaining = Math.max(orderTotal - paid, 0);
  const selectedCountry = countries.find((c) => c.id === countryId) ?? null;
  const selectedCity = cities.find((c) => c.name === city) ?? null;

  const validate = (): boolean => {
    if (productLines.length === 0) {
      setFieldError(t("crm.leads.convert.validation.product"));
      return false;
    }
    if (productLines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1)) {
      setFieldError(t("crm.leads.convert.validation.quantity"));
      return false;
    }
    if (productLines.some((line) => isLinePriceMissing(line, "lineAmount"))) {
      setShowLineErrors(true);
      setFieldError(t("crm.leads.convert.validation.amount"));
      return false;
    }
    if (orderTotal <= 0) {
      setFieldError(t("crm.leads.convert.validation.total"));
      return false;
    }
    if (paymentType === "PREPAID" && paid > 0 && !paymentMethod) {
      setFieldError(t("crm.leads.convert.validation.paymentMethod"));
      return false;
    }
    if (!address.trim() && !city.trim()) {
      setFieldError(t("crm.leads.convert.validation.shipping"));
      return false;
    }
    setFieldError(null);
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setIsSaving(true);
    try {
      const result = await leadsService.convert(lead.id, {
        items: productLines.map((line) => ({
          productId: line.product!.id,
          quantity: line.quantity,
          agreedAmount: line.lineAmount!,
        })),
        paymentType,
        fulfillmentMethod,
        paymentMethodId: paymentMethod?.id,
        currencyId: currency?.id ?? lead.currencyId,
        amountPaid: paymentType === "CASH_ON_DELIVERY" ? 0 : paid,
        paymentReference: paymentReference.trim() || undefined,
        stagingAttachmentIds: stagingIdsOf(receiptItems),
        countryId,
        city: city.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(
        `${t("crm.leads.convert.success")} ${result.storeOrder?.internalOrderId ?? ""}`.trim(),
      );
      onOpenChange(false);
      onConverted(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  const countryOptions = useMemo(() => countries.filter((c) => !c.deletedAt), [countries]);

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      icon={ShoppingCart}
      title={t("crm.leads.convert.title")}
      description={t("crm.leads.convert.description")}
      footer={(requestClose) =>
        step === "summary" ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <EnterpriseButton variant="outline" onClick={() => setStep("form")}>
              {t("crm.leads.convert.backToEdit")}
            </EnterpriseButton>
            <EnterpriseButton
              variant="success"
              disabled={isSaving || receiptItems.some((item) => item.status === "uploading")}
              onClick={() => void submit()}
            >
              {t("crm.leads.convert.confirmCreate")}
            </EnterpriseButton>
          </div>
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
        <CreateOperationLayout>
          {fieldError ? <p className="text-caption text-destructive">{fieldError}</p> : null}
          <ModalSection title={t("crm.leads.convert.sectionCustomer")} columns={2}>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.fields.customerName")}</Label>
              <Input value={lead.customerName} readOnly />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.fields.mobileNumber")}</Label>
              <Input dir="ltr" value={lead.mobileNumber} readOnly />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.owner")}</Label>
              <Input value={lead.salesEmployee?.fullName ?? "—"} readOnly />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.fields.source")}</Label>
              <Input value={lead.source} readOnly dir="ltr" />
            </div>
          </ModalSection>

          <ModalSection title={t("crm.leads.convert.sectionProducts")}>
            <ProductLineItemsGrid
              lines={lines}
              onChange={(next) => {
                setLines(next);
                if (fieldError) setFieldError(null);
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
              totalLabel={t("crm.leads.convert.orderTotal")}
              currencyCode={currency?.code}
            />
          </ModalSection>

          <ModalSection title={t("crm.leads.convert.sectionPayment")} columns={2}>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.paymentType")}</Label>
              <EntityCombobox
                value={
                  paymentType === "CASH_ON_DELIVERY"
                    ? { id: "CASH_ON_DELIVERY", name: t("crm.leads.convert.cod") }
                    : { id: "PREPAID", name: t("crm.leads.convert.prepaid") }
                }
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
                    setAmountPaid("0");
                  }
                }}
                items={[
                  { id: "PREPAID", name: t("crm.leads.convert.prepaid") },
                  { id: "CASH_ON_DELIVERY", name: t("crm.leads.convert.cod") },
                ]}
                getId={(item) => item.id}
                getTitle={(item) => item.name}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.fulfillmentMethod")}</Label>
              <EntityCombobox
                value={
                  fulfillmentMethod === "PICKUP"
                    ? { id: "PICKUP", name: t("crm.leads.convert.pickup") }
                    : { id: "SHIPPING", name: t("crm.leads.convert.shipping") }
                }
                onChange={(value) => {
                  setFulfillmentMethod((value?.id as "SHIPPING" | "PICKUP") ?? "SHIPPING");
                }}
                items={[
                  { id: "SHIPPING", name: t("crm.leads.convert.shipping") },
                  { id: "PICKUP", name: t("crm.leads.convert.pickup") },
                ]}
                getId={(item) => item.id}
                getTitle={(item) => item.name}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.paymentMethod")}</Label>
              <EntityCombobox
                value={paymentMethod}
                onChange={setPaymentMethod}
                items={paymentMethods}
                getId={(item) => item.id}
                getTitle={(item) => item.name}
                allowClear
                placeholder={t("storeOrders.detail.payments.selectMethod")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={currencyFieldId}>{t("crm.leads.fields.currency")}</Label>
              <CurrencyPicker
                id={currencyFieldId}
                valueKey="id"
                value={currency?.id ?? ""}
                onValueChange={(id) => setCurrency(currencies.find((row) => row.id === id) ?? null)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.amountPaid")}</Label>
              <Input
                dir="ltr"
                type="number"
                min={0}
                step="0.01"
                value={paymentType === "CASH_ON_DELIVERY" ? "0" : amountPaid}
                disabled={paymentType === "CASH_ON_DELIVERY"}
                onChange={(event) => setAmountPaid(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.paymentReference")}</Label>
              <Input
                dir="ltr"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
              />
            </div>
            <PaymentReceiptsField
              items={receiptItems}
              onChange={setReceiptItems}
              disabled={isSaving}
              visible={paymentType === "PREPAID" && paid > 0}
            />
          </ModalSection>

          <ModalSection title={t("crm.leads.convert.sectionShipping")} columns={2}>
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.fields.country")}</Label>
              <EntityCombobox
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
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.fields.city")}</Label>
              {cities.length > 0 ? (
                <EntityCombobox
                  value={selectedCity}
                  onChange={(value) => setCity(value?.name ?? "")}
                  items={cities}
                  getId={(item) => item.id}
                  getTitle={(item) => item.name}
                  allowClear
                />
              ) : (
                <Input value={city} onChange={(event) => setCity(event.target.value)} />
              )}
            </div>
            <div className="col-span-full flex flex-col gap-1">
              <Label>{t("crm.leads.fields.address")}</Label>
              <Textarea
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                rows={2}
              />
            </div>
          </ModalSection>

          <CreateOperationTotals
            rows={[
              {
                label: t("crm.leads.convert.orderTotal"),
                value: (
                  <span dir="ltr">
                    {orderTotal.toFixed(2)} {currency?.code ?? ""}
                  </span>
                ),
                emphasis: "strong",
              },
              {
                label: t("crm.leads.convert.amountPaid"),
                value: <span dir="ltr">{paid.toFixed(2)}</span>,
              },
              {
                label: t("crm.leads.convert.remaining"),
                value: <span dir="ltr">{remaining.toFixed(2)}</span>,
              },
            ]}
          />
        </CreateOperationLayout>
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
                      `${line.product?.displayName ?? line.product?.name} × ${line.quantity} = ${(line.lineAmount ?? 0).toFixed(2)}`,
                  )
                  .join(" · "),
              },
              {
                label: t("crm.leads.convert.orderTotal"),
                value: `${orderTotal.toFixed(2)} ${currency?.code ?? ""}`,
              },
              {
                label: t("crm.leads.convert.paymentType"),
                value:
                  paymentType === "CASH_ON_DELIVERY"
                    ? t("crm.leads.convert.cod")
                    : t("crm.leads.convert.prepaid"),
              },
              { label: t("crm.leads.convert.paymentMethod"), value: paymentMethod?.name },
              { label: t("crm.leads.convert.amountPaid"), value: String(paid) },
              { label: t("crm.leads.fields.currency"), value: currency?.code },
              {
                label: t("crm.leads.convert.sectionShipping"),
                value: [selectedCountry?.name, city, address].filter(Boolean).join(" — "),
              },
            ]}
          />
        </CreateOperationLayout>
      )}
      <span className="sr-only">{locale}</span>
    </EnterpriseModal>
  );
}
