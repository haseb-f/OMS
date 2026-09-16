"use client";

import { useEffect, useState } from "react";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { storeOrdersService, type StoreOrderPaymentRow } from "@/services/store-orders-service";
import { ApiError } from "@/services/api-client";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";

/**
 * ADR-0018 (Order Economics M2.2) — records the ACTUAL provider transaction
 * fee for one Payment. Always supersedes `PaymentSource.feePercentage`/
 * `feeFixedAmount`'s estimate for this Payment once saved (`OrderEconomicsService`
 * reads it with ACTUAL > ESTIMATED > UNKNOWN precedence) — never a second,
 * parallel fee calculation on the frontend.
 */
export function SetPaymentFeeDialog({
  payment,
  open,
  onOpenChange,
  onSaved,
}: {
  payment: StoreOrderPaymentRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [feeAmount, setFeeAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFeeAmount(payment?.actualFeeAmount != null ? String(payment.actualFeeAmount) : "");
    }
  }, [open, payment]);

  const parsedFee = Number(feeAmount);
  const isValid = feeAmount.trim() !== "" && Number.isFinite(parsedFee) && parsedFee >= 0;

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("storeOrders.detail.payments.setFeeTitle")}
      description={t("storeOrders.detail.payments.setFeeDescription")}
      extra={
        <Input
          type="number"
          min={0}
          step="0.01"
          value={feeAmount}
          onChange={(event) => setFeeAmount(event.target.value)}
          placeholder={t("storeOrders.detail.payments.feeAmount")}
        />
      }
      confirmLabel={t("common.save")}
      confirmDisabled={!isValid || isSaving}
      isConfirming={isSaving}
      onConfirm={() => {
        if (!payment || !isValid) return;
        setIsSaving(true);
        storeOrdersService
          .setPaymentActualFee(payment.id, parsedFee)
          .then(() => {
            toast.success(t("storeOrders.detail.payments.feeSaved"));
            onOpenChange(false);
            onSaved();
          })
          .catch((error: unknown) => {
            toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
          })
          .finally(() => setIsSaving(false));
      }}
    />
  );
}
