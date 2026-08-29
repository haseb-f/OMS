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
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  shipmentStatusLabelKey,
  shipmentStatusTone,
  catalogStatusTone,
} from "@/config/shipping/shipment-status";
import { storeOrdersService } from "@/services/store-orders-service";
import {
  shippingService,
  type ShipmentListRow,
  type ShippingStatusCatalogEntry,
} from "@/services/shipping-service";
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
 *
 * The Shipping Status select is the "direct change to any status" capability
 * (Shipping Status Configuration + Final-Shipment Sync Rules) — no forced
 * sequence, so it lists every active catalog status rather than a
 * transition-constrained subset. Moving a FINAL shipment back to an
 * UNDER_SYNC status ("reopening" it) asks for confirmation first, since
 * that makes it eligible for Shipping Sync again.
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
  const [shippingStatusId, setShippingStatusId] = useState("");
  const [statuses, setStatuses] = useState<ShippingStatusCatalogEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingReopenConfirm, setPendingReopenConfirm] = useState(false);

  useEffect(() => {
    if (shipment) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompanyId(shipment.shippingCompanyId ?? "");
      setTrackingNumber(shipment.trackingNumber ?? "");
      setLabelUrl("");
      setShippingStatusId(shipment.shippingStatus?.id ?? "");
    }
  }, [shipment]);

  useEffect(() => {
    if (!open) return;
    shippingService
      .statuses()
      .then(setStatuses)
      .catch(() => setStatuses([]));
  }, [open]);

  if (!shipment) return null;

  const currentIsFinal = shipment.shippingStatus?.syncBehavior === "FINAL";
  const selectedStatus = statuses.find((s) => s.id === shippingStatusId);
  const isReopening =
    currentIsFinal &&
    !!selectedStatus &&
    selectedStatus.syncBehavior === "UNDER_SYNC" &&
    selectedStatus.id !== shipment.shippingStatus?.id;

  const applyChanges = async () => {
    setIsSaving(true);
    try {
      const calls: Promise<unknown>[] = [];
      if (shippingStatusId && shippingStatusId !== (shipment.shippingStatus?.id ?? "")) {
        calls.push(
          storeOrdersService.shipments.setShippingStatus(shipment.storeOrderId, shippingStatusId),
        );
      }
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

  const handleSave = () => {
    if (isReopening) {
      setPendingReopenConfirm(true);
      return;
    }
    void applyChanges();
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
            {shipment.storeOrder.partner?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <span className="text-caption text-muted-foreground">
              {t("shipping.manage.currentStatus")}
            </span>
            <StatusBadge
              label={shipment.shippingStatus?.name ?? t(shipmentStatusLabelKey(shipment.status))}
              tone={
                shipment.shippingStatus
                  ? catalogStatusTone(shipment.shippingStatus.color)
                  : shipmentStatusTone(shipment.status)
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("shipping.manage.changeStatus")}</Label>
            <Select value={shippingStatusId || "__none__"} onValueChange={setShippingStatusId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("shipping.manage.changeStatus")} />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentIsFinal && (
              <p className="text-caption text-muted-foreground">{t("shipping.manage.finalHint")}</p>
            )}
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

      <ConfirmationDialog
        open={pendingReopenConfirm}
        onOpenChange={setPendingReopenConfirm}
        title={t("shipping.manage.reopenConfirmTitle")}
        description={t("shipping.manage.reopenConfirmDescription")}
        tone="warning"
        confirmLabel={t("shipping.manage.reopenConfirmAction")}
        isConfirming={isSaving}
        onConfirm={() => {
          setPendingReopenConfirm(false);
          void applyChanges();
        }}
      />
    </Dialog>
  );
}
