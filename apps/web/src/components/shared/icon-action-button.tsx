"use client";

import { forwardRef, type MouseEventHandler, type ReactNode } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Icon-only action with tooltip + accessible name — hover/focus/pressed come from `EnterpriseButton`. */
export const IconActionButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    onClick?: () => void;
    onMouseDown?: MouseEventHandler<HTMLButtonElement>;
    children: ReactNode;
    disabled?: boolean;
    variant?: "ghost" | "outline";
    pressed?: boolean;
    className?: string;
    /** When the button is composed as another primitive's trigger (dropdown), skip the inner Tooltip. */
    tooltip?: boolean;
  }
>(function IconActionButton(
  {
    label,
    onClick,
    onMouseDown,
    children,
    disabled,
    variant = "ghost",
    pressed,
    className,
    tooltip = true,
  },
  ref,
) {
  const button = (
    <EnterpriseButton
      ref={ref}
      type="button"
      variant={variant}
      size="icon-sm"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={className}
      onMouseDown={onMouseDown}
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
