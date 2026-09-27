"use client";

import { useId, useState } from "react";
import { ConfirmationDialog, type ConfirmationTone } from "@/components/shared/confirmation-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/providers/locale-provider";

/**
 * The shared confirmation dialog with a reason field — every audited
 * reconciliation action (dispute, reject suggestion, ignore, correct match)
 * goes through this one control. The dialog stays open while the action
 * runs; the caller's promise decides success/failure feedback.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "warning",
  reasonRequired = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: ConfirmationTone;
  reasonRequired?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) setReason("");
    onOpenChange(next);
  };

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={close}
      tone={tone}
      title={title}
      description={description}
      extra={
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId}>{t("paymentReconciliation.fields.reason")}</Label>
          <Textarea
            id={fieldId}
            value={reason}
            rows={2}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      }
      confirmLabel={confirmLabel}
      confirmDisabled={reasonRequired && !reason.trim()}
      isConfirming={busy}
      onConfirm={() => {
        setBusy(true);
        onConfirm(reason.trim())
          .then(() => close(false))
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    />
  );
}
