"use client";

import { useId, useState } from "react";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { FieldNote } from "@/components/agents/field-note";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/providers/locale-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { storeOrderMoneyService } from "./store-order-money-service";

/**
 * "Reverse" a payment verified in error (R15, D15-12): reason required; the
 * server reverses its receipt with a reversing entry and marks the payment
 * REVERSED (audited) — never deletes it.
 */
export function PaymentReverseDialog({
  payment,
  onOpenChange,
  onReversed,
}: {
  payment: { id: string; paymentNumber: string };
  onOpenChange: (open: boolean) => void;
  onReversed: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) return;
    setIsSaving(true);
    try {
      await storeOrderMoneyService.reversePayment(payment.id, reason.trim());
      reportSuccess(t("storeOrderMoney.reverseDialog.reversed", { number: payment.paymentNumber }));
      onReversed();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConfirmationDialog
      open
      onOpenChange={onOpenChange}
      tone="destructive"
      title={t("storeOrderMoney.reverseDialog.title", { number: payment.paymentNumber })}
      description={t("storeOrderMoney.reverseDialog.description")}
      confirmLabel={t("storeOrderMoney.reverseDialog.submit")}
      confirmDisabled={!reason.trim()}
      isConfirming={isSaving}
      onConfirm={() => void confirm()}
      extra={
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-reason`}>
            {t("storeOrderMoney.reverseDialog.reason")}
            <RequiredMark className="ms-0.5" />
          </Label>
          <Textarea
            id={`${fieldId}-reason`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <FieldNote
            hint={reason.trim() ? null : t("storeOrderMoney.reverseDialog.reasonRequired")}
          />
        </div>
      }
    />
  );
}
