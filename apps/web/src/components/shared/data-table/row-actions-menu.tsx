"use client";

import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnterpriseButton } from "@/components/ui/button";
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
 * The one row-actions overflow menu every OMS list table should reuse
 * instead of a column of inline buttons (originally built for Sales/
 * Purchasing document lists — TASK-047 — now the shared, generic version).
 * Callers decide which actions apply to a given row and whether its current
 * state allows each one (`hidden`/`disabled`) — this component only renders
 * the menu. Renders nothing if every action is hidden, so an empty `__actions`
 * cell never leaves a dangling trigger button.
 */
export function RowActionsMenu({ actions, label }: { actions: RowAction[]; label: string }) {
  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EnterpriseButton type="button" variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </EnterpriseButton>
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
