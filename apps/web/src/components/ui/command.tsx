"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PopoverContent } from "@/components/ui/popover";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { SearchIcon, CheckIcon, XIcon } from "lucide-react";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xs! bg-popover p-1.5 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * OMS Dropdown Design System — the ONE popover shell every searchable
 * picker renders its `<Command>` inside. Width is at least the trigger,
 * grows with content, and caps at `max-w-md` so long Arabic labels stay
 * readable without becoming a floating panel.
 */
function CommandPopoverContent({
  className,
  align = "start",
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      align={align}
      className={cn(
        "w-auto min-w-(--radix-popover-trigger-width) max-w-[min(var(--container-md),var(--radix-popover-content-available-width))] rounded-xs p-0 shadow-md",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn("top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0", className)}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Same unified-search contract as `SearchInput`: magnifier, field and clear
 * button share one border. Pass `onClear` (with the translated `clearLabel`)
 * on any picker whose search is controlled, so a long query can be reset
 * without selecting the whole string first.
 */
function CommandInput({
  className,
  onClear,
  clearLabel,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  onClear?: () => void;
  clearLabel?: string;
}) {
  const hasQuery = typeof props.value === "string" && props.value.length > 0;

  return (
    <div data-slot="command-input-wrapper" className="sticky top-0 z-10 bg-popover p-1 pb-1">
      <InputGroup className="h-(--control-height-sm)! rounded-xs! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:ps-2.5!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-body outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
        {onClear && hasQuery ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              aria-label={clearLabel}
              onClick={onClear}
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[min(270px,calc(var(--radix-popover-content-available-height,100dvh)-3.5rem))] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-3 text-center text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-caption **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-0.5 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-8 shrink-0 pointer-coarse:min-h-10 cursor-default items-center gap-2 rounded-xs px-2.5 py-1 text-body outline-hidden select-none transition-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent data-selected:text-accent-foreground data-[checked=true]:bg-primary-soft data-[checked=true]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-selected:*:[svg]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ms-auto self-center opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:text-primary group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

/**
 * Shared option content for every entity combobox. Default is stacked
 * (title + metadata) so Product/Customer/Account options stay compact but
 * readable. `layout="inline"` keeps a single truncated line when a picker
 * genuinely has no secondary fact.
 */
function CommandResultRow({
  icon,
  title,
  subtitle,
  subtitleDir,
  layout = "stacked",
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  subtitleDir?: "ltr" | "rtl";
  layout?: "stacked" | "inline";
}) {
  const titleNode =
    typeof title === "string" ? (
      <span dir="auto" className="[unicode-bidi:isolate]">
        {title}
      </span>
    ) : (
      title
    );

  if (layout === "inline") {
    return (
      <>
        {icon}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{titleNode}</span>
          {subtitle && (
            <span className="text-muted-foreground">
              <span className="px-1.5 opacity-60">·</span>
              <span dir={subtitleDir ?? "ltr"} className="[unicode-bidi:isolate]">
                {subtitle}
              </span>
            </span>
          )}
        </span>
      </>
    );
  }

  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{titleNode}</span>
        {subtitle ? (
          <span
            dir={subtitleDir ?? "ltr"}
            className="truncate text-caption text-muted-foreground [unicode-bidi:isolate]"
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ms-auto text-caption tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandPopoverContent,
  CommandResultRow,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
