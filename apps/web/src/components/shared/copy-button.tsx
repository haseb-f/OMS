"use client";

import { useState, type SyntheticEvent } from "react";
import { Check, Copy } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/components/shared/use-copy-to-clipboard";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * For an inline copy button inside a `group/copy` wrapper: quiet until the
 * value is hovered or focused, shown while «Copied» is up, and always
 * visible on touch screens (no hover there).
 */
export const COPY_REVEAL_CLASS =
  "opacity-0 group-hover/copy:opacity-100 group-focus-within/copy:opacity-100 focus-visible:opacity-100 data-copied:opacity-100 pointer-coarse:opacity-100";

/** Keeps the copy click inside the button: no row navigation, selection or cell double-click copy. */
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Shared copy control (R6 B2). Copies the FULL `value` (never the truncated
 * text on screen). Success: a check icon, the visible text «تم النسخ /
 * Copied» (beside the icon, or in the tooltip of the icon-only form) and a
 * polite live-region announcement — only after the write succeeded. Failure:
 * the hook's accessible error toast with the reason.
 *
 * - `variant="icon"` — a small inline affordance next to a value (24px hit
 *   area by default); safe inside clickable table rows.
 * - `variant="button"` — a labelled outline button (dialogs, forms).
 */
export function CopyButton({
  value,
  label,
  labelKind,
  variant = "icon",
  size = "xs",
  disabled,
  preserveFocus = false,
  successToast,
  className,
}: {
  /** The full value, or a getter read at click time (e.g. what is typed in a field right now). */
  value: string | null | undefined | (() => string | null | undefined);
  /** What is being copied ("reference", "phone number") — names the button: "Copy reference". */
  label?: string;
  /** Default `label` by what the value is, when no `label` is given. */
  labelKind?: "reference" | "phone" | "value";
  variant?: "icon" | "button";
  size?: "xs" | "sm";
  disabled?: boolean;
  /** Keep focus (and the caret) in the field the button sits in. */
  preserveFocus?: boolean;
  /** Also confirm with a success toast (e.g. "Password copied") — for values the user must be sure they have. */
  successToast?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const { copy, copied } = useCopyToClipboard({ successToast });
  // Controlled tooltip: hover/focus opens it; a successful copy keeps it open
  // to show «Copied» for as long as the check is shown.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const name = label ?? (labelKind ? t(`controls.copy.${labelKind}`) : undefined);
  const actionLabel = name
    ? t("controls.copy.actionNamed", { label: name })
    : t("controls.copy.action");
  const copiedLabel = name
    ? t("controls.copy.copiedNamed", { label: name })
    : t("controls.copy.copied");
  const isDisabled = disabled || (typeof value !== "function" && !value);
  const Icon = copied ? Check : Copy;
  const iconClass = cn(
    variant === "icon" && size === "xs" ? "size-3" : "size-3.5",
    copied && "text-success",
  );

  const handlers = {
    onPointerDown: stop,
    onDoubleClick: stop,
    onMouseDown: (event: SyntheticEvent) => {
      if (preserveFocus) event.preventDefault();
    },
    onClick: (event: SyntheticEvent) => {
      event.stopPropagation();
      void copy(typeof value === "function" ? value() : value);
    },
  };

  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only">
      {copied ? copiedLabel : ""}
    </span>
  );

  if (variant === "button") {
    return (
      <>
        <EnterpriseButton
          type="button"
          variant="outline"
          size={size}
          className={cn("shrink-0 gap-1.5", className)}
          disabled={isDisabled}
          data-copied={copied || undefined}
          aria-label={copied ? copiedLabel : actionLabel}
          {...handlers}
        >
          <Icon className={iconClass} aria-hidden />
          {copied ? t("controls.copy.copied") : t("controls.copy.action")}
        </EnterpriseButton>
        {liveRegion}
      </>
    );
  }

  return (
    <>
      <Tooltip open={copied || tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <EnterpriseButton
            type="button"
            variant="ghost"
            size={size === "xs" ? "icon-xs" : "icon-sm"}
            className={cn("shrink-0 text-muted-foreground hover:text-foreground", className)}
            disabled={isDisabled}
            data-slot="copy-button"
            data-copied={copied || undefined}
            aria-label={copied ? copiedLabel : actionLabel}
            {...handlers}
          >
            <Icon className={iconClass} aria-hidden />
          </EnterpriseButton>
        </TooltipTrigger>
        <TooltipContent side="top">
          {copied ? t("controls.copy.copied") : actionLabel}
        </TooltipContent>
      </Tooltip>
      {liveRegion}
    </>
  );
}
