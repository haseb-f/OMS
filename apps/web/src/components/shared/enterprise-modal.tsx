"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLocale } from "@/providers/locale-provider";
import { FormCardProvider } from "@/components/shared/form-card/form-card";
import { cn } from "@/lib/utils";

export type EnterpriseModalSize = "sm" | "md" | "lg" | "xl";

/**
 * `form-card`: a compact data-entry card — bounded 520px (`sm`/`md`) or
 * 640px (`lg`/`xl`) wide, compact hairline sections and content-sized field
 * rows (see components/shared/form-card).
 */
export type EnterpriseModalLayout = "default" | "form-card";

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
  title,
  description,
  isDirty = false,
  children,
  footer,
  className,
  bodyClassName,
  testId,
  errorSummary,
  layout = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: EnterpriseModalSize;
  /** Accepted for callers; the modal draws no decorative header icon (design-system §12). */
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
  layout?: EnterpriseModalLayout;
}) {
  const { t } = useLocale();
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const keyboardInset = useKeyboardInset();
  // design-system §12: roomier header/body, no decorative icon, footer
  // actions split to the two edges.
  const formCard = layout === "form-card";

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
          data-layout={formCard ? "form-card" : undefined}
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
            formCard
              ? size === "sm" || size === "md"
                ? "sm:max-w-(--form-card-width-narrow)"
                : "sm:max-w-(--form-card-width)"
              : sizeClasses[size],
            className,
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-start justify-between gap-3 border-b border-border py-3",
              // Compact form (Round 3.2): the header is one tight title block.
              formCard ? "px-4" : "px-5",
            )}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="text-card-title leading-snug">{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
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

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              // Compact form: tighter body; focused fields scroll clear of the
              // header/footer (the body is the only scroller, nothing overlays it).
              formCard ? "scroll-py-4 px-4 py-3 max-sm:px-3" : "px-5 py-4",
              bodyClassName,
            )}
          >
            <FormCardProvider active={formCard}>
              {errorSummary}
              {children}
            </FormCardProvider>
          </div>

          {footer !== undefined && footer !== null && (
            <div
              className={cn(
                "flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-5 py-3 sm:flex-row sm:items-center sm:justify-end",
                // Secondary at the start edge, the final action at the end edge.
                "sm:[&>*:first-child:not(:only-child)]:me-auto",
                // Compact form on phones: the actions share one row (secondary at
                // the start, the final action at the end), each an equal touch target.
                formCard &&
                  "px-4 py-2.5 max-sm:flex-row max-sm:flex-wrap max-sm:items-center max-sm:px-3 max-sm:[&_[data-slot=button]]:flex-1",
              )}
            >
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
