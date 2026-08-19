"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { EnterpriseButton } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { XIcon } from "lucide-react";

export type EnterpriseModalSize = "md" | "lg" | "xl";

const sizeClasses: Record<EnterpriseModalSize, string> = {
  md: "sm:max-w-2xl",
  lg: "sm:max-w-4xl",
  xl: "sm:max-w-6xl",
};

/**
 * The one Create/Edit surface every OMS module reuses (Leads, Customers,
 * Suppliers, Products, Master Data, ...) — per the Enterprise Modal System:
 * never a bespoke dialog, never a dedicated page for a normal CRUD form
 * (reserve full pages for inherently complex workflows like invoices or the
 * document designer). Owns the "unsaved changes" guard itself — ESC,
 * overlay click, and the header's close button all funnel through one
 * `requestClose` that only closes immediately when `isDirty` is false,
 * otherwise asks for confirmation — so no caller re-implements that dance.
 */
export function EnterpriseModal({
  open,
  onOpenChange,
  size = "lg",
  icon: Icon,
  title,
  description,
  isDirty = false,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: EnterpriseModalSize;
  icon?: LucideIcon;
  title: string;
  description?: string;
  isDirty?: boolean;
  children: ReactNode;
  /** Receives the same guarded close handler ESC/overlay-click use — a footer Cancel button must call this, never `onOpenChange(false)` directly, or it would skip the unsaved-changes confirmation. */
  footer: ReactNode | ((requestClose: () => void) => ReactNode);
}) {
  const { t } = useLocale();
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const requestClose = () => {
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            data-slot="dialog-content"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              requestClose();
            }}
            onPointerDownOutside={(event) => {
              event.preventDefault();
              requestClose();
            }}
            className={cn(
              "fixed top-1/2 start-1/2 z-50 flex max-h-[85vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg duration-(--duration-base) outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              sizeClasses[size],
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                {Icon && (
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <DialogPrimitive.Title className="font-heading text-card-title leading-snug">
                    {title}
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description className="text-caption text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
              </div>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={requestClose}
                aria-label={t("common.close")}
              >
                <XIcon />
              </EnterpriseButton>
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto p-5">{children}</div>

            <Separator />

            <div className="flex shrink-0 flex-col-reverse gap-2 bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">
              {typeof footer === "function" ? footer(requestClose) : footer}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDiscardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("common.confirmDiscardDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              {t("common.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
