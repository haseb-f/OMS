"use client";

import { forwardRef, type ReactNode } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Icon-only action with tooltip + accessible name — hover/focus/pressed come from `EnterpriseButton`. */
export const IconActionButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    onClick?: () => void;
    children: ReactNode;
    disabled?: boolean;
    variant?: "ghost" | "outline";
    /** When the button is composed as another primitive's trigger (dropdown), skip the inner Tooltip. */
    tooltip?: boolean;
  }
>(function IconActionButton(
  { label, onClick, children, disabled, variant = "ghost", tooltip = true },
  ref,
) {
  const button = (
    <EnterpriseButton
      ref={ref}
      type="button"
      variant={variant}
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </EnterpriseButton>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
});
