"use client";

import { Fragment, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconActionButton } from "@/components/shared/icon-action-button";

export interface RowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Renders the item as the currently-chosen option in a set (density, layout). */
  checked?: boolean;
  /** Omit the item entirely — used when the action never applies to this row. */
  hidden?: boolean;
  /** Keep the item visible but non-actionable — used when the row's current state doesn't allow it. */
  disabled?: boolean;
  destructive?: boolean;
  /** Renders a separator above this item — groups destructive actions apart from the rest. */
  separatorBefore?: boolean;
}

/**
 * The one overflow menu OMS reuses — row actions in every list table, and
 * the table's own secondary utilities. Callers decide which actions apply
 * (`hidden`/`disabled`); this only renders the kebab. Renders nothing if
 * every action is hidden, so a fully-unauthorized row leaves no dangling
 * trigger.
 */
export function RowActionsMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  const visible = actions.filter((action) => !action.hidden);
  const [open, setOpen] = useState(false);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <IconActionButton label={label} tooltip={!open}>
          <MoreVertical className="size-4" />
        </IconActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-44">
        {visible.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled}
              data-checked={action.checked || undefined}
              className={action.checked ? "bg-muted" : undefined}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={(event) => {
                // Closing the menu and opening a Dialog/AlertDialog on the same
                // pointer event dismisses the dialog immediately. Defer the
                // action until the dropdown has released pointer capture.
                event.preventDefault();
                setOpen(false);
                window.setTimeout(() => action.onSelect(), 50);
              }}
            >
              <action.icon className="size-4" />
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
