"use client";

import type { ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
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
  extra,
  onConfirm,
  confirmLabel,
  cancelLabel,
  destructive,
  tone,
  confirmDisabled,
  isConfirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Plain text/inline content only — renders inside `<AlertDialogDescription>`, which is a `<p>`; block-level content (a Select, a form field) here is invalid HTML and breaks hydration. Use `extra` for that. */
  description?: ReactNode;
  /** Block-level content (form fields, pickers) rendered below the description, outside the `<p>` — use this instead of stuffing it into `description`. */
  extra?: ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** @deprecated use `tone="destructive"` instead — kept so existing callers don't break. */
  destructive?: boolean;
  tone?: ConfirmationTone;
  /** Keeps the confirm action inert until a caller-supplied condition is met (e.g. a required reason field) — every other caller omits this and keeps today's always-enabled behavior. */
  confirmDisabled?: boolean;
  /** When set, the caller owns close-after-success. The action stays open and shows a spinner. */
  isConfirming?: boolean;
}) {
  const { t } = useLocale();
  const resolvedTone: ConfirmationTone = tone ?? (destructive ? "destructive" : "default");
  const showAlertIcon = resolvedTone === "warning" || resolvedTone === "destructive";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isConfirming) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={cn(showAlertIcon && "flex items-center gap-2")}>
            {showAlertIcon && (
              <TriangleAlert
                className={cn(
                  "size-5",
                  resolvedTone === "destructive" ? "text-destructive" : "text-warning",
                )}
              />
            )}
            {title}
          </AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {extra}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>
            {cancelLabel ?? t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmDisabled || isConfirming}
            aria-busy={isConfirming || undefined}
            className={actionToneClasses[resolvedTone]}
            onClick={(event) => {
              if (isConfirming !== undefined) event.preventDefault();
              onConfirm();
            }}
          >
            {isConfirming && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
            {confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Destructive specialization — delete, cancel order, bulk remove, irreversible status. */
export function DeleteConfirmationDialog(
  props: Omit<Parameters<typeof ConfirmationDialog>[0], "tone" | "destructive">,
) {
  return <ConfirmationDialog {...props} tone="destructive" />;
}
