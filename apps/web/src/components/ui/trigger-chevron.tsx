import type { ComponentProps } from "react";
import { ChevronDown, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one chevron every dropdown trigger ends with (Kumo refinement,
 * kumo-research.md §4). Size, colour and the open state come from the
 * shared recipe (`[data-slot="trigger-chevron"]`), so no caller sizes or
 * tints its own arrow.
 *
 * - `select` (default) — up/down caret for value pickers: Select,
 *   EntityCombobox/SearchableSelect, list filters. Never rotates.
 * - `menu` — single down caret for action menus and split buttons
 *   ("Export ▾", "Import ▾"). Turns while its menu is open.
 * - `disclosure` — the same caret for an inline show/hide section; it sits
 *   before the label and turns while the section is open.
 */
export function TriggerChevron({
  kind = "select",
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<typeof ChevronDown>, "size"> & {
  kind?: "select" | "menu" | "disclosure";
  size?: "sm" | "md";
}) {
  const Icon = kind === "select" ? ChevronsUpDown : ChevronDown;
  return (
    <Icon
      aria-hidden
      {...props}
      data-slot="trigger-chevron"
      data-kind={kind}
      data-size={size}
      className={cn("pointer-events-none shrink-0", className)}
    />
  );
}
