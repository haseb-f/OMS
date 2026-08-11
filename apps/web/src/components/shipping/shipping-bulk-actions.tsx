"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  SHIPMENT_STATUS_LABEL_KEY,
  SHIPMENT_STATUS_VALUES,
} from "@/config/shipping/shipment-status";
import type { ShipmentStatusValue } from "@/services/shipping-service";
import { useLocale } from "@/providers/locale-provider";

/**
 * Shipping list bulk-actions row — bulk status update requires an explicit
 * confirmation dialog before applying (per the Store Orders + Shipping spec)
 * even though `EnterpriseDataTable`'s own bulk bar already shows the
 * "N selected" indicator, so this component never re-implements that count.
 */
export function ShippingBulkActions({
  selectedCount,
  onApply,
}: {
  selectedCount: number;
  onApply: (status: ShipmentStatusValue) => void;
}) {
  const { t } = useLocale();
  const [targetStatus, setTargetStatus] = useState<ShipmentStatusValue | "">("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Select
        value={targetStatus || undefined}
        onValueChange={(value) => setTargetStatus(value as ShipmentStatusValue)}
      >
        <SelectTrigger size="sm" className="w-48">
          <SelectValue placeholder={t("shipping.bulk.selectStatus")} />
        </SelectTrigger>
        <SelectContent>
          {SHIPMENT_STATUS_VALUES.map((status) => (
            <SelectItem key={status} value={status}>
              {t(SHIPMENT_STATUS_LABEL_KEY[status])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={!targetStatus}
        onClick={() => setConfirmOpen(true)}
      >
        <RefreshCw className="size-3.5" />
        {t("shipping.bulk.updateStatus")}
      </EnterpriseButton>

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("shipping.bulk.confirmTitle", { count: selectedCount })}
        description={
          targetStatus
            ? t("shipping.bulk.confirmDescription", {
                status: t(SHIPMENT_STATUS_LABEL_KEY[targetStatus]),
              })
            : undefined
        }
        confirmLabel={t("shipping.bulk.updateStatus")}
        cancelLabel={t("common.close")}
        onConfirm={() => {
          if (!targetStatus) return;
          setConfirmOpen(false);
          onApply(targetStatus);
        }}
      />
    </>
  );
}
