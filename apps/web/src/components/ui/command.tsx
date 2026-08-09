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
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { SearchIcon, CheckIcon } from "lucide-react";

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
 * picker (Customer/Supplier/Product/Warehouse/Account/...) renders its
 * `<Command>` inside. Radius (`rounded-xs`, 8px — the same "dropdown/select
 * menu" token the Status/Select dropdown uses, per ADR-0018) and shadow
 * (`shadow-md` + hairline ring, inherited from the base `PopoverContent`)
 * are owned here so every searchable dropdown reads as the same component
 * as a plain `<Select>`, never its own visual language. Width defaults to
 * the trigger's own width, capped at 340px. Never duplicate these classes
 * on a picker itself — add a new picker by reusing this component instead.
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
        "w-(--radix-popover-trigger-width) max-w-[340px] rounded-xs p-0 shadow-md",
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

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="sticky top-0 z-10 bg-popover p-1 pb-1">
      <InputGroup className="h-(--control-height-md)! rounded-xs! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:ps-2.5!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-caption outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-[270px] scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
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
      className={cn("py-5 text-center text-caption text-muted-foreground", className)}
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
        "overflow-hidden p-1.5 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-caption **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
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
        "group/command-item relative flex h-9 shrink-0 cursor-default items-center gap-2 rounded-xs px-2.5 text-caption outline-hidden select-none transition-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-accent data-selected:text-accent-foreground data-[checked=true]:bg-success/10 data-[checked=true]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-selected:*:[svg]:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ms-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:text-success group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  );
}

/**
 * OMS Dropdown Design System — the shared single-line row content every
 * picker uses inside its `<CommandItem>`. Every row is exactly one line
 * (`h-9`, fixed on `CommandItem` above) so no row is ever taller than
 * another, whether or not it has a subtitle: title and subtitle sit on the
 * SAME line (a muted, de-emphasized run after the title, separated by a
 * hairline divider), both truncating together with a single ellipsis at
 * the end — never a stacked two-line title/subtitle. Defined once here so
 * no picker hand-rolls its own font-size/truncate classes for result rows.
 */
function CommandResultRow({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{title}</span>
        {subtitle && (
          <span className="text-muted-foreground">
            <span className="px-1.5 opacity-60">·</span>
            {subtitle}
          </span>
        )}
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
