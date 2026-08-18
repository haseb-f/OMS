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
import { EnterpriseButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const [open, setOpen] = useState(false);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-haspopup="menu"
            >
              <MoreVertical className="size-4" />
            </EnterpriseButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!open ? <TooltipContent side="top">{label}</TooltipContent> : null}
      </Tooltip>
      <DropdownMenuContent align="end" className="w-max min-w-44">
        {visible.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={action.disabled}
              variant={action.destructive ? "destructive" : "default"}
              onSelect={action.onSelect}
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
