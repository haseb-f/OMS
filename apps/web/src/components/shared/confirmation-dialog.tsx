"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type ConfirmationTone = "default" | "destructive" | "warning";

const actionToneClasses: Record<ConfirmationTone, string | undefined> = {
  default: undefined,
  destructive:
    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
  warning: "bg-warning text-warning-foreground hover:bg-warning/90 focus-visible:ring-warning/30",
};

/**
 * Generic confirm-before-you-act dialog — the one reusable primitive every
 * future business page should use instead of a one-off confirm modal.
 * `DeleteConfirmationDialog` is the destructive-styled specialization of
 * this same component. `tone="warning"` (TASK-028's "Orange warning
 * dialog") adds a triangle-alert icon alongside the orange action button —
 * use it for consequential-but-not-destructive actions (e.g. "this will
 * affect existing stock levels"), reserving `destructive` for
 * archive/delete-style actions.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
  cancelLabel,
  destructive,
  tone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** @deprecated use `tone="destructive"` instead — kept so existing callers don't break. */
  destructive?: boolean;
  tone?: ConfirmationTone;
}) {
  const { t } = useLocale();
  const resolvedTone: ConfirmationTone = tone ?? (destructive ? "destructive" : "default");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={cn(resolvedTone === "warning" && "flex items-center gap-2")}>
            {resolvedTone === "warning" && <TriangleAlert className="size-5 text-warning" />}
            {title}
          </AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className={actionToneClasses[resolvedTone]}>
            {confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
