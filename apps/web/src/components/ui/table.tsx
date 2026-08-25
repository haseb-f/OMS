"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative min-w-0 w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-body", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
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
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
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
        "h-9 px-3 text-start align-middle text-caption font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3 py-2 align-middle whitespace-nowrap", className)}
      {...props}
    />
  );
}

/**
 * Shared column inset — the only horizontal padding EDT headers and body
 * cells should add. Applied identically to THEAD and TBODY. Data columns
 * share one 12px inline padding throughout (no extra first/last offset —
 * that was shifting the first data column independently of the header).
 *
 * Utility columns (checkbox/expand/actions) are tight (4px) on the side
 * facing another column, but get the full 12px "safe gutter" on whichever
 * side is the table's own outer edge — first column's inline-start, last
 * column's inline-end. Actions is almost always the last column, so this
 * is what keeps its row-menu button from sitting flush against the table
 * border/card edge in RTL — logical `ps-`/`pe-`, never `pl-`/`pr-`, so the
 * gutter lands on the correct physical side automatically in both
 * directions. Applies to every utility column, not just actions, so a
 * pinned/leading checkbox column gets the same edge safety.
 */
function tableColumnInsetClass(index: number, count: number, kind: "data" | "utility" = "data") {
  if (kind !== "utility") return "px-3";
  const isFirst = index === 0;
  const isLast = index === count - 1;
  return cn(isFirst ? "ps-3" : "ps-1", isLast ? "pe-3" : "pe-1");
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
};
