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
  "sticky top-0 z-10 h-8 bg-muted/40 px-2 text-caption font-medium whitespace-nowrap text-muted-foreground";
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
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
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
