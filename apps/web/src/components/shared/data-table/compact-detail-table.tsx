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
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type CompactDetailAlign = "start" | "end";

export interface CompactDetailColumn<T> {
  id: string;
  header: ReactNode;
  align?: CompactDetailAlign;
  cell: (row: T) => ReactNode;
}

/**
 * Read-only line table for detail workspaces — Store Order items, payments,
 * shipments, and any other compact record list that is not the operational
 * EnterpriseDataTable. One geometry so those sections do not each invent a
 * slightly different header/row rhythm.
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
    <Table className={cn("w-full", className)}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.id}
              className={cn(
                "h-8 bg-muted/50 px-2 font-medium",
                column.align === "end" && "text-end",
              )}
            >
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
              className="px-2 py-3 text-center text-caption leading-normal text-muted-foreground"
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
                  className={cn(
                    "min-w-0 px-2 py-1.5 leading-normal",
                    column.align === "end" && "text-end tabular-nums",
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
      {footer ? (
        <TableFooter>
          <TableRow className="hover:bg-transparent">{footer}</TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}
