"use client";

import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconActionButtonProps = Omit<
  ComponentProps<typeof EnterpriseButton>,
  "aria-label" | "aria-pressed" | "size" | "variant" | "children" | "asChild"
> & {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "outline";
  pressed?: boolean;
  /**
   * Suppresses the tooltip while another surface (an open menu) already
   * explains the control. The returned tree keeps one shape in every state:
   * the Tooltip root and trigger stay mounted, so a parent that toggles this
   * cannot remount the button out from under a Radix `asChild` trigger.
   */
  tooltip?: boolean;
};

/**
 * Icon-only action with tooltip + accessible name — hover/focus/pressed come
 * from `EnterpriseButton`.
 *
 * Everything this component does not name itself is forwarded to the button.
 * That matters because this is composed as the trigger of Radix primitives
 * (`<DropdownMenuTrigger asChild>`), which open from the `onPointerDown` and
 * `onKeyDown` they inject into their child. A closed prop list silently drops
 * those, leaving a button that renders and focuses but never opens anything.
 */
export const IconActionButton = forwardRef<HTMLButtonElement, IconActionButtonProps>(
  function IconActionButton(
    {
      label,
      children,
      variant = "ghost",
      pressed,
      className,
      tooltip = true,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <Tooltip open={tooltip ? undefined : false}>
        <TooltipTrigger asChild>
          <EnterpriseButton
            {...props}
            ref={ref}
            type={type}
            variant={variant}
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            className={cn(className)}
          >
            {children}
          </EnterpriseButton>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    );
  },
);
