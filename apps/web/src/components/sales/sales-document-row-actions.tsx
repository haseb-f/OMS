"use client";

import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";
import { Archive, Download, MoreHorizontal, Printer } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SalesDocumentRowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Omit the item entirely — used when the action never applies to this document type. */
  hidden?: boolean;
  /** Keep the item visible but non-actionable — used when the current status doesn't allow it. */
  disabled?: boolean;
  destructive?: boolean;
  /** Renders a separator above this item — groups destructive actions apart from the rest. */
  separatorBefore?: boolean;
}

/**
 * TASK-047 — the one row-actions dropdown every Sales document list reuses
 * (Quotation/Order/Invoice/Return) instead of four hand-rolled per-page
 * action rows. Callers decide which actions apply to a given row and
 * whether the current status allows each one (`hidden`/`disabled`) — this
 * component only renders the menu.
 */
export function SalesDocumentRowActionsMenu({
  actions,
  label,
}: {
  actions: SalesDocumentRowAction[];
  label: string;
}) {
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

/**
 * The one bulk-actions row every Sales document list reuses (Print/Export/
 * Archive) — rendered inside `EnterpriseDataTable`'s `bulkActions` slot,
 * which only appears once at least one row is selected.
 */
export function SalesListBulkActions({
  onPrint,
  onExport,
  onArchive,
  archiveDisabled,
  labels,
}: {
  onPrint: () => void;
  onExport: () => void;
  onArchive?: () => void;
  archiveDisabled?: boolean;
  labels: { print: string; export: string; archive: string };
}) {
  return (
    <>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onPrint}
      >
        <Printer className="size-3.5" />
        {labels.print}
      </EnterpriseButton>
      <EnterpriseButton
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onExport}
      >
        <Download className="size-3.5" />
        {labels.export}
      </EnterpriseButton>
      {onArchive && (
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={archiveDisabled}
          onClick={onArchive}
        >
          <Archive className="size-3.5" />
          {labels.archive}
        </EnterpriseButton>
      )}
    </>
  );
}
