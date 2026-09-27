"use client";

import { useEffect, useId, useState } from "react";
import { Truck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { shippingService, type ShippingStatusCatalogEntry } from "@/services/shipping-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * Bulk "Change Shipping Status" from the Store Orders list's advanced
 * selection (TASK-064) — the same dynamic catalog and direct "change to any
 * status" capability `ShipmentManageDialog` uses per-order, applied to every
 * selected order via `shippingService.bulkSetStatus`. One confirmation
 * covers the whole batch (never one prompt per order); the parent owns
 * firing the request and reporting partial success/failure once this
 * closes.
 */
export function BulkShippingStatusDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (shippingStatusId: string) => void | Promise<void>;
  isSubmitting?: boolean;
}) {
  const { t } = useLocale();
  const [statuses, setStatuses] = useState<ShippingStatusCatalogEntry[]>([]);
  const [shippingStatusId, setShippingStatusId] = useState("");
  const statusFieldId = useId();
  const [pendingConfirm, setPendingConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShippingStatusId("");
    shippingService
      .statuses()
      .then(setStatuses)
      .catch(() => setStatuses([]));
  }, [open]);

  const selectedStatus = statuses.find((status) => status.id === shippingStatusId);

  const handleOpenChange = (next: boolean) => {
    if (isSubmitting) return;
    onOpenChange(next);
  };

  return (
    <>
      <EnterpriseModal
        open={open}
        onOpenChange={handleOpenChange}
        size="sm"
        icon={Truck}
        bodyClassName="flex flex-col gap-3"
        title={t("storeOrders.bulkShipping.dialogTitle")}
        footer={
          <>
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t("common.cancel")}
            </EnterpriseButton>
            <EnterpriseButton
              type="button"
              disabled={!shippingStatusId}
              onClick={() => setPendingConfirm(true)}
            >
              {t("storeOrders.bulkShipping.submit")}
            </EnterpriseButton>
          </>
        }
      >
        <p className="text-caption text-muted-foreground">
          {t("storeOrders.bulkShipping.selectedCount", { count: selectedCount })}
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={statusFieldId}>{t("storeOrders.bulkShipping.newStatusLabel")}</Label>
          <Select value={shippingStatusId} onValueChange={setShippingStatusId}>
            <SelectTrigger id={statusFieldId} className="w-full">
              <SelectValue placeholder={t("storeOrders.bulkShipping.newStatusPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </EnterpriseModal>

      <ConfirmationDialog
        open={pendingConfirm}
        onOpenChange={setPendingConfirm}
        title={t("storeOrders.bulkShipping.confirmTitle")}
        description={t("storeOrders.bulkShipping.confirmDescription", {
          count: selectedCount,
          status: selectedStatus?.label ?? "",
        })}
        confirmLabel={t("storeOrders.bulkShipping.confirmAction")}
        onConfirm={() => {
          if (!shippingStatusId) return;
          setPendingConfirm(false);
          onOpenChange(false);
          void onConfirm(shippingStatusId);
        }}
      />
    </>
  );
}
