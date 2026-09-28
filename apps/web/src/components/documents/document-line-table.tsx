"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnterpriseButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Canonical chrome for transactional document line-item tables (Sales,
 * Purchasing, Store Orders, conversion dialogs). One dense horizontal row
 * per product — never a stacked second row for warehouse or description.
 */
export const documentLineHeadClass =
  "sticky top-0 z-(--z-sticky) h-(--table-head-height) border-b border-border-strong bg-table-header px-2 text-table-head whitespace-nowrap text-table-header-foreground";
export const documentLineCellClass = "overflow-hidden px-2 py-1 align-middle whitespace-nowrap";
/**
 * Numeric columns share ONE end edge in header, inputs and read-only values:
 * a line input's digits sit inside its own border + `px-2`, so the header
 * and any plain (input-less) value cell are inset by that same amount
 * (cell `px-2` + field `px-2` + 1px border). Logical `pe-`, so the edge
 * lands on the correct side in RTL and LTR.
 */
const NUMERIC_FIELD_EDGE = "pe-[calc(var(--spacing)*4+1px)]";
export const documentLineNumericHeadClass = cn(
  documentLineHeadClass,
  "text-end",
  NUMERIC_FIELD_EDGE,
);
export const documentLineNumericCellClass = cn(
  documentLineCellClass,
  "text-end tabular-nums",
  "[&:not(:has(input))]:pe-[calc(var(--spacing)*4+1px)]",
  // Native number spinners reserve space at the end edge and push digits
  // off the shared numeric edge — line inputs are typed/arrow-keyed instead.
  "[&_input]:[appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none",
);

/** A line-table column width: a width token, optionally scaled (e.g. amount columns that must fit 10+ digits). */
export type LineColumnWidth = string | [token: string, scale: number];

/**
 * Sum of the given width tokens (× scale) in px, read from the root style.
 * Line editors compare it with their container width to switch from table
 * rows to stacked cards before any column would clip — no sideways scroll.
 */
export function lineColumnsWidth(columns: LineColumnWidth[]): number {
  const style = getComputedStyle(document.documentElement);
  return columns.reduce<number>((sum, column) => {
    const [token, scale] = typeof column === "string" ? [column, 1] : column;
    return sum + (Number.parseFloat(style.getPropertyValue(token)) || 0) * scale;
  }, 0);
}

export function DocumentLineTable({
  children,
  footer,
  minWidthClass = "min-w-[1080px]",
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  minWidthClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-xs border border-border", className)}>
      <Table className={cn("w-full table-fixed border-separate border-spacing-0", minWidthClass)}>
        {children}
      </Table>
      {footer}
    </div>
  );
}

export function DocumentLineTableAddFooter({
  onClick,
  disabled,
  label,
  extra,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  /** Another line action (e.g. "Browse products"), placed at the end edge. */
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border bg-muted/20 px-2 py-1.5">
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5 text-muted-foreground md:h-7"
        disabled={disabled}
        onClick={onClick}
      >
        <Plus className="size-3.5" />
        {label}
      </EnterpriseButton>
      {extra ? <div className="ms-auto flex items-center gap-1">{extra}</div> : null}
    </div>
  );
}

export {
  TableBody as DocumentLineTableBody,
  TableCell as DocumentLineTableCell,
  TableHead as DocumentLineTableHead,
  TableHeader as DocumentLineTableHeader,
  TableRow as DocumentLineTableRow,
};
