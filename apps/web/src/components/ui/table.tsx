"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * OMS table primitives (design-system §6). Every table in the app — the
 * `EnterpriseDataTable` grid, `CompactDetailTable`, document line tables and
 * the plain `ui/table` users — renders its header, body and footer cells
 * through these, so one header style, one cell inset and one density lever
 * apply everywhere:
 *
 * - header: `--table-head-height`, `text-table-head`, `bg-table-header`,
 *   `text-table-header-foreground`, bottom rule `border-border-strong`
 * - body:   `--table-row-height` (min), `--table-cell-py`, `text-table`
 * - inset:  `--table-cell-px` on header, body and footer alike
 *
 * Density is ONE lever: `<Table density="comfortable">` re-points the row
 * height and vertical padding tokens for that table only.
 */
export type TableDensity = "compact" | "comfortable";

const COMFORTABLE_DENSITY_VARS = {
  "--table-row-height": "var(--table-row-height-comfortable)",
  "--table-cell-py": "var(--table-cell-py-comfortable)",
} as React.CSSProperties;

function Table({
  className,
  density = "compact",
  container = true,
  containerClassName,
  style,
  ...props
}: React.ComponentProps<"table"> & {
  density?: TableDensity;
  /**
   * `false` renders the bare `<table>` without its own `overflow-x-auto`
   * wrapper — required when the caller owns the scroll container (a sticky
   * header only sticks to its nearest scroll container, so a second,
   * nested one silently disables it).
   */
  container?: boolean;
  containerClassName?: string;
}) {
  const table = (
    <table
      data-slot="table"
      data-density={density}
      className={cn("w-full caption-bottom text-table", className)}
      style={density === "comfortable" ? { ...COMFORTABLE_DENSITY_VARS, ...style } : style}
      {...props}
    />
  );
  if (!container) return table;
  return (
    <div
      data-slot="table-container"
      className={cn("relative min-w-0 w-full overflow-x-auto", containerClassName)}
    >
      {table}
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  // The header rule lives on the <th> cells (border-border-strong), which
  // also works under `border-separate` where row borders never paint.
  return (
    <thead data-slot="table-header" className={cn("[&_tr]:border-b-0", className)} {...props} />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border-strong bg-surface-sunken font-semibold [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Row states (fills live in `theme/recipes.css` → "Tables", painted on the
 * cells so pinned/sticky cells always match their row):
 *
 * - hover: only on `interactive` rows (the row itself navigates or expands —
 *   defaults to "has an onClick"), together with `cursor-pointer`. A row that
 *   does nothing on click never looks clickable.
 * - selected: `data-state="selected"` — brand tint, distinct from hover.
 * - keyboard focus: any focus-visible control inside the row draws an inset
 *   focus outline on the row, independent of hover/selected.
 *
 * Nothing changes border width or size, so states never shift layout.
 */
function TableRow({
  className,
  interactive,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  const isInteractive = interactive ?? Boolean(props.onClick);
  return (
    <tr
      data-slot="table-row"
      data-interactive={isInteractive ? "" : undefined}
      className={cn(
        "group/row border-b border-table-divider",
        isInteractive && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-(--table-head-height) border-b border-border-strong bg-table-header px-(--table-cell-px) text-start align-middle text-table-head whitespace-nowrap text-table-header-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `dir` on a cell isolates its CONTENT only (LTR IDs, amounts, dates). The
 * cell itself keeps the table's direction, so `text-start`/`text-end` resolve
 * against the same edge as the header — putting `dir="ltr"` (or the `num`
 * utility, which sets `direction: ltr`) on the <td> itself flips its
 * alignment to the opposite side in an RTL table.
 *
 * `numeric` is the shorthand for money/number/percent/quantity cells: logical
 * end alignment + tabular digits on the cell, the value itself in an isolated
 * `num` run.
 */
function TableCell({
  className,
  dir,
  numeric,
  children,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-(--table-row-height) px-(--table-cell-px) py-(--table-cell-py) align-middle text-table whitespace-nowrap",
        numeric && tableNumericCellClass,
        className,
      )}
      {...props}
    >
      {numeric ? (
        <span className="num">{children}</span>
      ) : dir ? (
        <span dir={dir} className="[unicode-bidi:isolate]">
          {children}
        </span>
      ) : (
        children
      )}
    </td>
  );
}

/**
 * Numeric column cells (money, number, percent, quantity) — header, body and
 * footer. Aligns to the logical end (the left edge in Arabic) with tabular
 * digits. Put the value itself in a `num` run (or use `<TableCell numeric>`).
 */
const tableNumericCellClass = "text-end tabular-nums";

/** Dates and references: tabular digits, start-aligned. Wrap the value in a `num` run. */
const tableTabularCellClass = "text-start tabular-nums";

/** The record's identity cell (document number, name). */
const tableIdentityCellClass = "font-medium text-foreground";

/** Secondary line under a cell's primary value. */
const tableSecondaryTextClass = "text-caption text-muted-foreground";

/** A column-aligned totals row inside a table (`<TableRow>` in `<TableFooter>`). */
const tableTotalsRowClass = "bg-surface-sunken font-semibold hover:bg-surface-sunken";

/** Logical alignment → class; `end` also switches to tabular digits. */
function tableAlignClass(align: "start" | "center" | "end" | undefined) {
  if (align === "end") return tableNumericCellClass;
  if (align === "center") return "text-center";
  return "text-start";
}

/**
 * Shared column inset — the only horizontal padding EDT headers, body and
 * footer cells add. Applied identically to THEAD, TBODY and TFOOT. Data
 * columns share one `--table-cell-px` inline padding throughout (no extra
 * first/last offset — that was shifting the first data column independently
 * of the header).
 *
 * Utility columns (checkbox/expand/actions) are tight (4px) on the side
 * facing another column, but get the full cell inset as a "safe gutter" on
 * whichever side is the table's own outer edge — first column's
 * inline-start, last column's inline-end — so a row-menu button never sits
 * flush against the card edge in RTL. Logical `ps-`/`pe-` only.
 */
function tableColumnInsetClass(index: number, count: number, kind: "data" | "utility" = "data") {
  if (kind !== "utility") return "px-(--table-cell-px)";
  const isFirst = index === 0;
  const isLast = index === count - 1;
  return cn(isFirst ? "ps-(--table-cell-px)" : "ps-1", isLast ? "pe-(--table-cell-px)" : "pe-1");
}

/**
 * Canonical in-cell content box — shrink-wraps to inline-start so LTR IDs
 * share the header axis. Overflow is clipped on the inline axis only: the
 * line box keeps the type scale's height so a clipped cell loses trailing
 * characters, never the top of an Arabic glyph.
 */
const tableCellContentClass =
  "inline-block w-max max-w-full min-w-0 truncate leading-normal align-middle";

/** Cells that carry prose (error reasons, notes) wrap instead of truncating — a clipped reason is unreadable. */
const tableCellWrapClass = "block w-full min-w-0 whitespace-normal break-words leading-normal";

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  tableColumnInsetClass,
  tableCellContentClass,
  tableCellWrapClass,
  tableNumericCellClass,
  tableTabularCellClass,
  tableIdentityCellClass,
  tableSecondaryTextClass,
  tableTotalsRowClass,
  tableAlignClass,
};
