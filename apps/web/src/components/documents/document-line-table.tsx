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
export const documentLineNumericHeadClass = cn(documentLineHeadClass, "text-end");
export const documentLineNumericCellClass = cn(documentLineCellClass, "text-end");

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
    <div className="border-t border-border bg-muted/20 px-2 py-1.5">
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-muted-foreground"
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
