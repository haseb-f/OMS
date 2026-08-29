"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { partnersService } from "@/services/partners-service";
import type { StoreOrderPartnerRef } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

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
  const [phone, setPhone] = useState(customer.phone ?? customer.mobile ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhone(customer.phone ?? customer.mobile ?? "");
    setEmail(customer.email ?? "");
    setCity(customer.city ?? "");
    setAddress(customer.address ?? "");
  }, [open, customer]);

  const handleSave = async () => {
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
      toast.error(error instanceof ApiError ? error.message : t("common.loadFailed"));
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
          <Input dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
