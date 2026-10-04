"use client";

import type { ReactNode } from "react";
import { useTableViewPreference } from "./table-preferences";
import { EnterpriseTableViewToggle } from "./data-table-view-toggle";
import { useUserContext } from "@/providers/user-context";
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
 *
 * `stacked`: below `sm` each row renders as a card — the first column as its
 * title, every other column as a label/value pair (the same cell renderers),
 * so wide line tables never scroll sideways on phones. Column `footer`s
 * render as a totals card; a custom `footer` node stays desktop-only.
 */
export interface CompactDetailTableProps<T> {
  columns: CompactDetailColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  stacked?: boolean;
  className?: string;
  /**
   * Makes this table a LIST SCREEN with a Table / Grid switch (R9, design-system
   * §12.19): the id the user's choice is remembered under (per user, per screen).
   * Leave unset for a table that is only a section of a detail page.
   */
  viewId?: string;
}

/** A compact list with the Table / Grid switch when it has a `viewId`; otherwise the plain table. */
export function CompactDetailTable<T>(props: CompactDetailTableProps<T>) {
  return props.viewId ? (
    <SwitchableCompactTable {...props} viewId={props.viewId} />
  ) : (
    <CompactDetailTableBase {...props} />
  );
}

function SwitchableCompactTable<T>({
  viewId,
  ...props
}: CompactDetailTableProps<T> & { viewId: string }) {
  const { user } = useUserContext();
  const [view, setView] = useTableViewPreference(viewId, user?.id);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex justify-end">
        <EnterpriseTableViewToggle view={view} onViewChange={setView} />
      </div>
      {view === "grid" ? <CompactRecordCards {...props} /> : <CompactDetailTableBase {...props} />}
    </div>
  );
}

/**
 * The Grid of a compact list: one card per row, the first column as its title and
 * every other column as a label/value pair (the table's own cell renderers — never
 * a second copy of the data); column footers become a totals card. Same
 * `[data-record-card]` look as every Grid view.
 */
function CompactRecordCards<T>({ columns, rows, rowKey, empty }: CompactDetailTableProps<T>) {
  const [titleColumn, ...detailColumns] = columns;
  const footers = columns.filter((column) => column.footer != null);
  if (rows.length === 0) {
    return <p className="p-3 text-center text-caption text-muted-foreground">{empty}</p>;
  }
  return (
    <div data-record-grid="">
      {rows.map((row) => (
        <article
          key={rowKey(row)}
          data-record-card=""
          data-static=""
          data-tone="neutral"
          className="flex min-w-0 flex-col gap-2 p-3"
        >
          {titleColumn ? (
            <div className="min-w-0 text-body font-medium text-foreground">
              {titleColumn.cell(row)}
            </div>
          ) : null}
          {detailColumns.length > 0 ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {detailColumns.map((column) => (
                <div
                  key={column.id}
                  className={cn("min-w-0", column.align === "end" && "text-end")}
                >
                  <dt className="truncate text-micro text-muted-foreground">{column.header}</dt>
                  <dd className="min-w-0 text-table text-foreground">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </article>
      ))}
      {footers.length > 0 ? (
        <article
          data-record-card=""
          data-static=""
          data-tone="neutral"
          className="min-w-0 bg-surface-sunken p-3 font-semibold"
        >
          <StackedPairs columns={footers} value={(column) => column.footer} />
        </article>
      ) : null}
    </div>
  );
}

function CompactDetailTableBase<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  stacked = false,
  className,
}: CompactDetailTableProps<T>) {
  const hasColumnFooters = columns.some((column) => column.footer != null);
  const table = (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card",
        stacked && "hidden sm:block",
        className,
      )}
    >
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
        {footer || hasColumnFooters ? (
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
  if (!stacked) return table;

  const [titleColumn, ...detailColumns] = columns;
  return (
    <>
      {table}
      <div
        data-stacked-table=""
        className={cn("rounded-md border border-border bg-card sm:hidden", className)}
      >
        {rows.length === 0 ? (
          <p className="p-3 text-center text-caption text-muted-foreground">{empty}</p>
        ) : (
          rows.map((row) => (
            <div
              key={rowKey(row)}
              className="flex min-w-0 flex-col gap-1 border-b border-border p-3 last:border-b-0"
            >
              {titleColumn ? (
                <div className="min-w-0 text-body font-medium text-foreground">
                  {titleColumn.cell(row)}
                </div>
              ) : null}
              <StackedPairs columns={detailColumns} value={(column) => column.cell(row)} />
            </div>
          ))
        )}
        {hasColumnFooters ? (
          <div className="border-t border-border bg-muted/40 p-3 font-semibold">
            <StackedPairs
              columns={columns.filter((column) => column.footer != null)}
              value={(column) => column.footer}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function StackedPairs<T>({
  columns,
  value,
}: {
  columns: CompactDetailColumn<T>[];
  value: (column: CompactDetailColumn<T>) => ReactNode;
}) {
  if (columns.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
      {columns.map((column) => (
        <div key={column.id} className="contents">
          <dt className="text-muted-foreground">{column.header}</dt>
          <dd className="min-w-0 text-end break-words text-foreground">{value(column)}</dd>
        </div>
      ))}
    </dl>
  );
}
