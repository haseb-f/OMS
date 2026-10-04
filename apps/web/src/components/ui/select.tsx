"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";

import { TriggerChevron } from "@/components/ui/trigger-chevron";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react";

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
  /**
   * `"ghost"` is ONLY for a cell whose trigger shows a semantic status badge
   * (the colour there is the operational status, so the trigger stays neutral).
   * Every other select — forms, dialogs, filters, inline editors — uses the default.
   */
  variant?: "default" | "ghost";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      // Stable hook for the navy recipe: `data-slot` is overwritten under a Slot (<FormControl>); this is not.
      data-select-trigger=""
      data-size={size}
      data-variant={variant}
      className={cn(
        // `min-w` (not `w`) guarantees the icon and label can never overlap
        // even when a caller sets a small custom `w-*`/className — `min-width`
        // always wins over a smaller `width`, so this is a floor no page can
        // accidentally break. Value text is centered and reserved its own
        // flexible slot; the chevron gets a fixed, never-shrinking slot.
        "flex w-fit cursor-pointer items-center gap-1.5 rounded-sm border border-transparent text-body whitespace-nowrap transition-[border-color,box-shadow,background-color] duration-(--duration-base) ease-(--ease-standard) outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring disabled:cursor-not-allowed data-[size=default]:h-(--control-height-md) data-[size=default]:min-w-28 data-[size=default]:px-3 data-[size=default]:py-1 data-[size=sm]:h-(--control-height-sm) data-[size=sm]:min-w-20 data-[size=sm]:px-2.5 data-[size=sm]:py-1 data-[size=sm]:text-caption *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:justify-start *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        // Default = the navy selector trigger (colours, states, chevron chip:
        // theme/recipes.css §12.14). Ghost = the borderless in-cell trigger.
        variant === "ghost" &&
          "bg-transparent px-1.5 text-foreground shadow-[inset_0_0_0_1px_var(--control-border)] not-disabled:hover:bg-(--control-hover) data-[state=open]:bg-(--control-pressed) disabled:bg-muted disabled:opacity-60 disabled:shadow-none aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] data-placeholder:text-placeholder [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <TriggerChevron size={size === "sm" ? "sm" : "md"} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn(
          "relative z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(var(--container-md),var(--radix-select-content-available-width))] min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xs bg-popover p-1.5 text-popover-foreground border border-border shadow-(--shadow-floating) duration-(--duration-base) data-[align-trigger=true]:animate-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 ",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 rtl:data-[side=left]:translate-x-1 data-[side=right]:translate-x-1 rtl:data-[side=right]:-translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        align={align}
        collisionPadding={collisionPadding}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            position === "popper" && "",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 min-h-8 rounded-xs py-1 pe-7 ps-2.5 text-body outline-hidden pointer-coarse:min-h-10 select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-2 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
