"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export type EnterpriseModalSize = "sm" | "md" | "lg" | "xl";

const sizeClasses: Record<EnterpriseModalSize, string> = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
};

/** Portaled pickers/menus live outside the dialog DOM — treat them as inside. */
function isPortaledOverlayEvent(event: { target: EventTarget | null }) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      '[data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="combobox-content"], [data-radix-popper-content-wrapper], [role="listbox"], [role="menu"]',
    ),
  );
}

/**
 * The one Create/Edit surface every OMS module reuses (Leads, Customers,
 * Suppliers, Products, Master Data, ...) — never a bespoke dialog, never a
 * dedicated page for a normal CRUD form.
 *
 * Layout: header (title + optional one-line description + close) / a body
 * that is the only scroller / a footer that always stays visible with the
 * primary action at the logical end. The surface is `ui/dialog`'s
 * `DialogContent` (composed, not re-implemented) and never exceeds
 * `100dvh - 2rem`. On phones (<640px) it becomes a near-full-width sheet
 * anchored to the bottom edge; the on-screen keyboard height is added to
 * that offset so the footer stays above the keyboard instead of behind it.
 *
 * Owns the "unsaved changes" guard — ESC, overlay click and the close
 * button all funnel through one `requestClose` that only closes
 * immediately when `isDirty` is false, otherwise asks for confirmation.
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
  className,
  bodyClassName,
  testId,
  errorSummary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: EnterpriseModalSize;
  icon?: LucideIcon;
  title: ReactNode;
  /** One line under the title. Inline content only (renders inside a `<p>`). */
  description?: ReactNode;
  isDirty?: boolean;
  children: ReactNode;
  /**
   * Receives the same guarded close handler ESC/overlay-click use — a footer
   * Cancel button must call this, never `onOpenChange(false)` directly, or it
   * would skip the unsaved-changes confirmation. Put the primary action LAST.
   * Omit for a dialog whose actions live in its body (e.g. a choice list).
   */
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  className?: string;
  bodyClassName?: string;
  /** `data-testid` on the dialog surface. */
  testId?: string;
  /**
   * A `<FormErrorSummary>` (components/shared/form-error-summary) — rendered
   * at the top of the scrolling body so a failed submit is explained in place
   * (design-system §11.4). It renders nothing while there are no errors.
   */
  errorSummary?: ReactNode;
}) {
  const { t } = useLocale();
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const keyboardInset = useKeyboardInset();

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
        <DialogContent
          showCloseButton={false}
          data-testid={testId}
          style={{ "--keyboard-inset": `${keyboardInset}px` } as CSSProperties}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            if (isPortaledOverlayEvent(event)) return;
            requestClose();
          }}
          onFocusOutside={(event) => {
            if (isPortaledOverlayEvent(event)) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (isPortaledOverlayEvent(event)) event.preventDefault();
          }}
          className={cn(
            "flex flex-col gap-0 overflow-hidden p-0",
            "max-h-[calc(100dvh-2rem-var(--keyboard-inset,0px))]",
            // Phones: near-full-width sheet on the bottom edge, lifted above the keyboard.
            "max-sm:inset-x-2 max-sm:start-2 max-sm:top-auto max-sm:bottom-[calc(0.5rem+var(--keyboard-inset,0px))] max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rtl:translate-x-0",
            "max-sm:max-h-[calc(100dvh-1rem-var(--keyboard-inset,0px))]",
            sizeClasses[size],
            className,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {Icon && (
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <DialogTitle className="text-card-title leading-snug">{title}</DialogTitle>
                {description && <DialogDescription>{description}</DialogDescription>}
              </div>
            </div>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-me-1 shrink-0"
              onClick={requestClose}
              aria-label={t("common.close")}
            >
              <XIcon />
            </EnterpriseButton>
          </div>

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", bodyClassName)}>
            {errorSummary}
            {children}
          </div>

          {footer !== undefined && footer !== null && (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-4 py-2.5 sm:flex-row sm:justify-end">
              {typeof footer === "function" ? footer(requestClose) : footer}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={t("common.confirmDiscardTitle")}
        description={t("common.confirmDiscardDescription")}
        cancelLabel={t("common.keepEditing")}
        confirmLabel={t("common.discard")}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
