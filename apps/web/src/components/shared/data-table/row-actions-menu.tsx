"use client";

import { Fragment } from "react";
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
import { cn } from "@/lib/utils";

export interface RowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Omit the item entirely — used when the action never applies to this row. */
  hidden?: boolean;
  /** Keep the item visible but non-actionable — used when the row's current state doesn't allow it. */
  disabled?: boolean;
  destructive?: boolean;
  /** Renders a separator above this item — groups destructive actions apart from the rest. */
  separatorBefore?: boolean;
}

/**
 * The one row-actions overflow menu every OMS list table reuses.
 * Callers decide which actions apply (`hidden`/`disabled`); this only
 * renders the kebab. Renders nothing if every action is hidden.
 */
export function RowActionsMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconActionButton label={label}>
          <MoreVertical className="size-4" />
        </IconActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visible.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled}
              onSelect={action.onSelect}
              className={cn(action.destructive && "text-destructive focus:text-destructive")}
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
