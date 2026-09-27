"use client";

import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  tableAlignClass,
  tableTotalsRowClass,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type CompactDetailAlign = "start" | "end";

export interface CompactDetailColumn<T> {
  id: string;
  header: ReactNode;
  align?: CompactDetailAlign;
  cell: (row: T) => ReactNode;
  /** Totals cell — rendered with the exact header/body geometry so a total
   *  always sits under its own column's values. */
  footer?: ReactNode;
}

/**
 * Read-only line table for detail workspaces — Store Order items, payments,
 * shipments, and any other compact record list that is not the operational
 * EnterpriseDataTable. Header, cell inset, row height and totals row all
 * come from the shared `ui/table` primitives, so these sections line up with
 * every EDT list instead of inventing their own rhythm.
 *
 * Line height stays on the type scale (`leading-normal`) so Arabic glyphs
 * are never shaved by a tighter local box. Horizontal overflow is clipped
 * by `min-w-0` on the cell, never by a vertical `overflow-hidden`.
 */
export function CompactDetailTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  className,
}: {
  columns: CompactDetailColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-card", className)}>
      <Table className="w-full">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead key={column.id} className={tableAlignClass(column.align)}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="h-auto py-3 text-center text-caption text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn("min-w-0", tableAlignClass(column.align))}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
        {footer || columns.some((column) => column.footer != null) ? (
          <TableFooter>
            <TableRow className={tableTotalsRowClass}>
              {footer ??
                columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn("min-w-0 font-semibold", tableAlignClass(column.align))}
                  >
                    {column.footer}
                  </TableCell>
                ))}
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}
