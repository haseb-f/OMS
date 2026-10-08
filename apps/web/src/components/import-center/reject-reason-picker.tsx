"use client";

import { useId } from "react";
import { RequiredMark } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";
import {
  IMPORT_ROW_REJECTION_REASON_CODES,
  type ImportRowRejectionReasonCode,
} from "@/services/import-jobs-service";

/** A complete reason: a code, plus a note when the code is OTHER. */
export function isRejectReasonComplete(code: ImportRowRejectionReasonCode | "", note: string) {
  return code !== "" && (code !== "OTHER" || note.trim().length > 0);
}

/**
 * Rejecting a needs-review import row always requires a reason (fixed code,
 * free text for OTHER) — the one picker every reject dialog uses, so the rule
 * can never be bypassed from any entry point.
 */
export function RejectReasonPicker({
  code,
  note,
  onCodeChange,
  onNoteChange,
}: {
  code: ImportRowRejectionReasonCode | "";
  note: string;
  onCodeChange: (code: ImportRowRejectionReasonCode) => void;
  onNoteChange: (note: string) => void;
}) {
  const { t } = useLocale();
  const reasonFieldId = useId();
  return (
    <div className="flex flex-col gap-3 pt-2 text-start">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonFieldId}>
          {t("storeOrders.needsReview.rejectReason.label")} <RequiredMark className="ms-0.5" />
        </Label>
        <Select value={code} onValueChange={(v) => onCodeChange(v as ImportRowRejectionReasonCode)}>
          <SelectTrigger id={reasonFieldId} className="w-full">
            <SelectValue placeholder={t("storeOrders.needsReview.rejectReason.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_ROW_REJECTION_REASON_CODES.map((reasonCode) => (
              <SelectItem key={reasonCode} value={reasonCode}>
                {t(`storeOrders.needsReview.rejectReason.codes.${reasonCode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {code === "OTHER" && (
        <div className="flex flex-col gap-1.5">
          <Label>
            {t("storeOrders.needsReview.rejectReason.noteLabel")}{" "}
            <RequiredMark className="ms-0.5" />
          </Label>
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={2}
            placeholder={t("storeOrders.needsReview.rejectReason.notePlaceholder")}
          />
        </div>
      )}
    </div>
  );
}
