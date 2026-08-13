"use client";

import { useEffect, useState } from "react";
import { Link as LinkIcon, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/business/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shipmentStatusLabelKey, shipmentStatusTone } from "@/config/shipping/shipment-status";
import { storeOrdersService } from "@/services/store-orders-service";
import type { ShipmentListRow } from "@/services/shipping-service";
import type { ShippingCompanyOption } from "@/services/shipping-companies-service";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

/**
 * Direct shipment-level operations from the Shipping screen itself (Part 3
 * of the four-gaps task) — a shipping employee edits tracking/company/label
 * without navigating through the Store Order detail page. Reuses the
 * existing per-order shipment endpoints (`storeOrdersService.shipments.*`)
 * keyed by the row's own `storeOrderId`/`id` — no new backend storage, no
 * second document-storage system for the label.
 */
export function ShipmentManageDialog({
  shipment,
  open,
  onOpenChange,
  onUpdated,
  shippingCompanies,
}: {
  shipment: ShipmentListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
  shippingCompanies: ShippingCompanyOption[];
}) {
  const { t } = useLocale();
  const [companyId, setCompanyId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (shipment) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompanyId(shipment.shippingCompanyId ?? "");
      setTrackingNumber(shipment.trackingNumber ?? "");
      setLabelUrl("");
    }
  }, [shipment]);

  if (!shipment) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const calls: Promise<unknown>[] = [];
      if (companyId && companyId !== (shipment.shippingCompanyId ?? "")) {
        calls.push(
          storeOrdersService.shipments.setShippingCompany(
            shipment.storeOrderId,
            shipment.id,
            companyId,
          ),
        );
      }
      if (trackingNumber.trim() && trackingNumber.trim() !== (shipment.trackingNumber ?? "")) {
        calls.push(
          storeOrdersService.shipments.setTrackingNumber(
            shipment.storeOrderId,
            shipment.id,
            trackingNumber.trim(),
          ),
        );
      }
      if (labelUrl.trim()) {
        calls.push(
          storeOrdersService.shipments.setLabel(shipment.storeOrderId, {
            fileUrl: labelUrl.trim(),
          }),
        );
      }
      if (calls.length === 0) {
        onOpenChange(false);
        return;
      }
      await Promise.all(calls);
      toast.success(t("shipping.manage.saved"));
      onOpenChange(false);
      onUpdated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to update shipment.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="size-4" />
            {t("shipping.manage.title")}
          </DialogTitle>
          <DialogDescription>
            <span dir="ltr" className="font-mono">
              {shipment.storeOrder.internalOrderId}
            </span>
            {shipment.storeOrder.externalOrderId && (
              <span dir="ltr"> — {shipment.storeOrder.externalOrderId}</span>
            )}
            {" · "}
            {shipment.storeOrder.customer?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <span className="text-caption text-muted-foreground">
              {t("shipping.manage.currentStatus")}
            </span>
            <StatusBadge
              label={t(shipmentStatusLabelKey(shipment.status))}
              tone={shipmentStatusTone(shipment.status)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("shipping.filters.company")}</Label>
            <Select
              value={companyId || "__none__"}
              onValueChange={(v) => setCompanyId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("shipping.manage.selectCompany")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("shipping.manage.selectCompany")}</SelectItem>
                {shippingCompanies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("shipping.manage.trackingNumber")}</Label>
            <Input
              dir="ltr"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder={t("shipping.manage.trackingNumberPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("shipping.manage.label")}</Label>
            {shipment.labelUrl && (
              <a
                href={shipment.labelUrl}
                target="_blank"
                rel="noreferrer"
                className="flex w-fit items-center gap-1.5 text-caption text-primary hover:underline"
              >
                <LinkIcon className="size-3.5" />
                {t("shipping.manage.viewCurrentLabel")}
              </a>
            )}
            <Input
              dir="ltr"
              value={labelUrl}
              onChange={(e) => setLabelUrl(e.target.value)}
              placeholder="https://…"
            />
            <p className="text-caption text-muted-foreground">
              {shipment.labelUrl
                ? t("shipping.manage.labelReplaceHint")
                : t("shipping.manage.labelAttachHint")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <EnterpriseButton type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" onClick={handleSave} disabled={isSaving}>
            {t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
