"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/** Every string is caller-owned — "N orders" needs the caller's own noun and Arabic/English grammar, which a shared table component can't guess. */
export interface SelectCustomCountCopy {
  title: string;
  countLabel: string;
  hint: (count: number) => string;
  confirmLabel: string;
  invalidMessage: string;
}

/**
 * "Select a specific number" dialog (TASK-064) — generic across any
 * `EnterpriseDataTable`. Validates a positive integer client-side; fetching
 * and actually selecting the first N (by the caller's current filter+sort)
 * is entirely the caller's own `onConfirm`.
 */
export function SelectCustomCountDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (count: number) => void | Promise<void>;
  isSubmitting?: boolean;
  copy: SelectCustomCountCopy;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const parsed = Number(trimmed);
  const isValid = trimmed !== "" && Number.isInteger(parsed) && parsed > 0;

  const handleOpenChange = (next: boolean) => {
    if (isSubmitting) return;
    if (!next) setValue("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="select-custom-count-input">{copy.countLabel}</Label>
          <Input
            id="select-custom-count-input"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            dir="ltr"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
          {trimmed !== "" && (
            <p
              className={cn("text-caption", isValid ? "text-muted-foreground" : "text-destructive")}
            >
              {isValid ? copy.hint(parsed) : copy.invalidMessage}
            </p>
          )}
        </div>
        <DialogFooter>
          <EnterpriseButton type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            disabled={!isValid || isSubmitting}
            aria-busy={isSubmitting || undefined}
            onClick={() => void onConfirm(parsed)}
          >
            {copy.confirmLabel}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
