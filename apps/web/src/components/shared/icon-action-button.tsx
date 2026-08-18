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
  }
>(function IconActionButton({ label, onClick, children, disabled, variant = "ghost" }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
});
