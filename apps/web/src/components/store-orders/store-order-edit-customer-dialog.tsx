"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OMSPhoneInput, isPhoneValidForCountry } from "@/components/shared/phone-input";
import { useCountries } from "@/hooks/use-reference-data";
import { parsePhone } from "@/services/phone-service";
import { partnersService } from "@/services/partners-service";
import type { StoreOrderPartnerRef } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast, reportApiError } from "@/lib/toast";

export function StoreOrderEditCustomerDialog({
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: StoreOrderPartnerRef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const countries = useCountries();
  const originalPhone = customer.phone ?? customer.mobile ?? "";
  const [phone, setPhone] = useState(originalPhone);
  // The phone's own country, read from the stored E.164 (a legacy non-E.164
  // value has none and is shown exactly as stored). Not persisted — the
  // committed E.164 value carries it.
  const [phoneCountryId, setPhoneCountryId] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [email, setEmail] = useState(customer.email ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhone(customer.phone ?? customer.mobile ?? "");
    setPhoneCountryId(null);
    setSubmitAttempted(false);
    setEmail(customer.email ?? "");
    setCity(customer.city ?? "");
    setAddress(customer.address ?? "");
  }, [open, customer]);

  const storedRegion = parsePhone(originalPhone, null).detectedRegion;
  const effectivePhoneCountryId =
    phoneCountryId ?? countries.find((country) => country.code === storedRegion)?.id ?? "";
  const phoneCountryCode =
    countries.find((country) => country.id === effectivePhoneCountryId)?.code ?? null;
  // Only a changed phone is validated — an untouched legacy value never blocks saving the other fields.
  const phoneChanged = phone.trim() !== originalPhone.trim();
  const phoneInvalid =
    phoneChanged && !!phone.trim() && !isPhoneValidForCountry(phone, phoneCountryCode);

  const handleSave = async () => {
    setSubmitAttempted(true);
    if (phoneInvalid) return;
    setIsSaving(true);
    try {
      await partnersService.update(customer.id, {
        name: customer.name,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        address: address.trim() || undefined,
      });
      toast.success(t("storeOrders.detail.edit.saved"));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={MapPin}
      title={t("storeOrders.detail.edit.customerTitle")}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
        />
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>{t("storeOrders.fields.phone")}</Label>
          <OMSPhoneInput
            value={phone}
            onChange={setPhone}
            countryCode={phoneCountryCode}
            forceValidation={submitAttempted}
            availableCountryCodes={countries.map((country) => country.code)}
            countries={countries}
            onCountryChange={(iso2) => {
              const match = countries.find((country) => country.code === iso2);
              if (match) setPhoneCountryId(match.id);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("storeOrders.createDialog.fields.customerEmail")}</Label>
          <Input dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("storeOrders.createDialog.fields.city")}</Label>
          <Input value={city} onChange={(event) => setCity(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>{t("storeOrders.createDialog.fields.address")}</Label>
          <Input value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>
      </div>
    </EnterpriseModal>
  );
}
