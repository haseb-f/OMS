"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, ShoppingCart, Trash2 } from "lucide-react";
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
import { ProductPicker } from "@/components/business/product-picker";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import { useCurrencies, usePaymentMethods, useCountries } from "@/hooks/use-reference-data";
import { leadsService, type LeadRow } from "@/services/leads-service";
import { ApiError } from "@/services/api-client";
import type { ProductRow } from "@/services/products-service";
import type { CityRow, CurrencyRow, PaymentMethodRow } from "@/config/master-data/entities";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { createMasterDataService } from "@/services/master-data-service";

const citiesService = createMasterDataService<CityRow>("/cities");

type ConvertLine = {
  key: string;
  product: ProductRow | null;
  quantity: number;
  agreedAmount: number;
};

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
  const paymentMethods = usePaymentMethods();
  const countries = useCountries();

  const [step, setStep] = useState<"form" | "summary">("form");
  const [isSaving, setIsSaving] = useState(false);
  const [lines, setLines] = useState<ConvertLine[]>([]);
  const [paymentType, setPaymentType] = useState<"PREPAID" | "CASH_ON_DELIVERY">("PREPAID");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodRow | null>(null);
  const [currency, setCurrency] = useState<CurrencyRow | null>(null);
  const [amountPaid, setAmountPaid] = useState("0");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProofUrl, setPaymentProofUrl] = useState("");
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
    setLines([
      {
        key: "line-1",
        product: lead.product
          ? ({
              id: lead.product.id,
              name: lead.product.name,
              displayName: lead.product.displayName,
              sku: lead.product.sku,
            } as ProductRow)
          : null,
        quantity: lead.quantity || 1,
        agreedAmount: 0,
      },
    ]);
    setPaymentType("PREPAID");
    setPaymentMethod(null);
    setCurrency(currencies.find((c) => c.id === lead.currencyId) ?? null);
    setAmountPaid("0");
    setPaymentReference("");
    setPaymentProofUrl("");
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

  const orderTotal = lines.reduce((sum, line) => sum + Number(line.agreedAmount || 0), 0);
  const paid = Number(amountPaid) || 0;
  const remaining = Math.max(orderTotal - paid, 0);
  const selectedCountry = countries.find((c) => c.id === countryId) ?? null;
  const selectedCity = cities.find((c) => c.name === city) ?? null;

  const validate = (): boolean => {
    if (lines.some((line) => !line.product)) {
      setFieldError(t("crm.leads.convert.validation.product"));
      return false;
    }
    if (lines.some((line) => !line.quantity || line.quantity < 1)) {
      setFieldError(t("crm.leads.convert.validation.quantity"));
      return false;
    }
    if (lines.some((line) => line.agreedAmount < 0 || Number.isNaN(line.agreedAmount))) {
      setFieldError(t("crm.leads.convert.validation.amount"));
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
        items: lines.map((line) => ({
          productId: line.product!.id,
          quantity: line.quantity,
          agreedAmount: line.agreedAmount,
        })),
        paymentType,
        paymentMethodId: paymentMethod?.id,
        currencyId: currency?.id ?? lead.currencyId,
        amountPaid: paymentType === "CASH_ON_DELIVERY" ? 0 : paid,
        paymentReference: paymentReference.trim() || undefined,
        paymentProofUrl: paymentProofUrl.trim() || undefined,
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
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
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
            <EnterpriseButton variant="success" disabled={isSaving} onClick={() => void submit()}>
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
            <div className="flex flex-col gap-2">
              {lines.map((line) => (
                <div
                  key={line.key}
                  className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_5.5rem_8rem_auto]"
                >
                  <ProductPicker
                    value={line.product}
                    onChange={(product) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key ? { ...item, product } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    dir="ltr"
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key
                            ? { ...item, quantity: Number(event.target.value) || 1 }
                            : item,
                        ),
                      )
                    }
                    aria-label={t("crm.leads.convert.quantity")}
                  />
                  <Input
                    dir="ltr"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.agreedAmount}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.key === line.key
                            ? { ...item, agreedAmount: Number(event.target.value) || 0 }
                            : item,
                        ),
                      )
                    }
                    aria-label={t("crm.leads.convert.agreedAmount")}
                  />
                  <EnterpriseButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((item) => item.key !== line.key))
                    }
                  >
                    <Trash2 />
                  </EnterpriseButton>
                </div>
              ))}
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { key: `line-${Date.now()}`, product: null, quantity: 1, agreedAmount: 0 },
                  ])
                }
              >
                <Plus />
                {t("crm.leads.convert.addProduct")}
              </EnterpriseButton>
            </div>
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
                onChange={(value) =>
                  setPaymentType((value?.id as "PREPAID" | "CASH_ON_DELIVERY") ?? "PREPAID")
                }
                items={[
                  { id: "PREPAID", name: t("crm.leads.convert.prepaid") },
                  { id: "CASH_ON_DELIVERY", name: t("crm.leads.convert.cod") },
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
              <Label>{t("crm.leads.fields.currency")}</Label>
              <EntityCombobox
                value={currency}
                onChange={setCurrency}
                items={currencies.filter((row) => !row.deletedAt)}
                getId={(item) => item.id}
                getTitle={(item) => `${item.code} — ${item.name}`}
                getSearchText={(item) => `${item.code} ${item.name}`}
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
            <div className="flex flex-col gap-1">
              <Label>{t("crm.leads.convert.paymentProof")}</Label>
              <Input
                dir="ltr"
                value={paymentProofUrl}
                onChange={(event) => setPaymentProofUrl(event.target.value)}
                placeholder="https://…"
              />
            </div>
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
                value: lines
                  .map(
                    (line) =>
                      `${line.product?.displayName ?? line.product?.name} × ${line.quantity} = ${line.agreedAmount}`,
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
