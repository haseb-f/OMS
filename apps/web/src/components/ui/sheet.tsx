"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { EnterpriseButton } from "@/components/ui/button";
import { ControlSurface } from "@/components/ui/control-surface";
import { XIcon } from "lucide-react";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 duration-(--duration-base) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export type SheetSize = "sm" | "lg" | "xl";

/**
 * Width of a start/end (left/right) sheet. The classes carry the same
 * `data-[side=…]` selector as the rest of the recipe so they win over it —
 * a caller's plain `sm:max-w-*` would lose that specificity contest.
 * `sm` (default): 3/4 of a phone, 24rem from `sm`. `lg` / `xl`: full width
 * on phones, 42rem / 48rem from `sm` (record reviews, match panels).
 */
export const SHEET_SIZE_CLASSES: Record<SheetSize, string> = {
  sm: "data-[side=left]:w-3/4 data-[side=right]:w-3/4 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
  lg: "data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl",
  xl: "data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-3xl data-[side=right]:sm:max-w-3xl",
};

function SheetContent({
  className,
  children,
  side = "right",
  size = "sm",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  size?: SheetSize;
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-size={size}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-(--duration-base) ease-(--ease-standard) data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:rounded-t-lg data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:start-0 data-[side=left]:h-full data-[side=left]:rounded-e-lg data-[side=left]:border-e data-[side=right]:inset-y-0 data-[side=right]:end-0 data-[side=right]:h-full data-[side=right]:rounded-s-lg data-[side=right]:border-s data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:rounded-b-lg data-[side=top]:border-b data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 rtl:data-[side=left]:data-open:slide-in-from-right-10 rtl:data-[side=right]:data-open:slide-in-from-left-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 rtl:data-[side=left]:data-closed:slide-out-to-right-10 rtl:data-[side=right]:data-closed:slide-out-to-left-10 data-[side=top]:data-closed:slide-out-to-top-10",
          SHEET_SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        <ControlSurface surface="form">{children}</ControlSurface>
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <EnterpriseButton variant="ghost" className="absolute top-3 end-3" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </EnterpriseButton>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-body font-medium text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
