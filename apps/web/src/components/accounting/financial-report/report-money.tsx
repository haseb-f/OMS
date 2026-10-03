"use client";

import { formatAmountParts, type NegativeStyle } from "@/lib/money";
import { clsx as cx } from "clsx";

/**
 * The one money cell for financial reports and statements (company and
 * agent), built on `formatAmountParts` — the same text the summary, Excel,
 * CSV and print produce.
 *
 * - Weight comes from the row kind (inherited), never from the cell.
 * - A genuine zero is written at the report's precision (`0.00`, muted); a
 *   value that is not available (`null`) is "—"; a value that does not apply
 *   to the row (`undefined`, e.g. a section heading) is blank. A missing
 *   value is never shown as `0.00`.
 * - A negative is written with a minus sign; no Dr/Cr suffix is repeated on
 *   every row. Ledger and Trial Balance balances are Debit − Credit, so a
 *   credit balance reads `-1,234.50` (the Debit/Credit columns name the
 *   side). The agent statement keeps its own convention (credit-positive:
 *   what the company owes the agent).
 * - Red means ADVERSE, never "credit side": only `adverse` figures are red
 *   (net loss, a balance abnormal for the account's nature — see
 *   `displayAmount`, cash below zero). Print stays monochrome.
 * - `align="end"` (default) owns end alignment in the page direction (table
 *   cells); `inline` flows with the text (summary fields). Only the digits run
 *   is `num` (tabular, isolated LTR).
 */
export function ReportMoney({
  value,
  negative = "minus",
  currency,
  quiet,
  adverse,
  align = "end",
}: {
  value: number | null | undefined;
  negative?: NegativeStyle;
  /** ISO code written after the figure. */
  currency?: string | null;
  /** De-emphasized (e.g. an expanded parent whose children show the detail). */
  quiet?: boolean;
  /** An adverse figure (net loss, abnormal balance) — the only red. */
  adverse?: boolean;
  align?: "end" | "inline";
}) {
  const parts =
    value === undefined ? null : formatAmountParts(value, { negative, zero: "zero", currency });
  return (
    <span
      className={cx(
        align === "end" ? "block w-full text-end whitespace-nowrap" : "whitespace-nowrap",
        quiet && "text-muted-foreground",
        // The AA-safe red for text (solid --destructive is 4.0:1 on dark).
        adverse && "text-destructive-soft-foreground",
        (parts?.isZero || parts?.isMissing) && "font-normal text-muted-foreground",
      )}
    >
      {parts ? <span className="num">{parts.figure}</span> : null}
      {parts?.currency ? <span className="ms-1">{parts.currency}</span> : null}
    </span>
  );
}
