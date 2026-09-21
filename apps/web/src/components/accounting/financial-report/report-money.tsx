"use client";

import { cn } from "@/lib/utils";

/**
 * The one money cell for financial reports: normal values in normal text,
 * negatives in red, zero as a quiet dash, and weight reserved for real
 * totals (`emphasize`) so final balances stand out without bolding every
 * number. Always LTR digits, end-aligned, tabular — header, body and footer
 * line up in both directions.
 */
export function ReportMoney({
  value,
  emphasize,
  tone,
  signed = true,
  quiet,
}: {
  value: number;
  emphasize?: boolean;
  tone?: "success" | "danger" | "muted";
  signed?: boolean;
  /** De-emphasized (e.g. an expanded parent whose children show the detail). */
  quiet?: boolean;
}) {
  const zero = Math.abs(value) < 0.005;
  const negative = signed && value < -0.005;
  const resolvedTone = tone ?? (negative ? "danger" : undefined);
  return (
    <span
      dir="ltr"
      className={cn(
        "block w-full text-end tabular-nums whitespace-nowrap text-foreground",
        emphasize && "font-semibold",
        quiet && !negative && "text-muted-foreground",
        resolvedTone === "success" && "text-success",
        resolvedTone === "danger" && "text-destructive",
        resolvedTone === "muted" && "text-muted-foreground",
        zero && "font-normal text-muted-foreground",
      )}
    >
      {zero
        ? "—"
        : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
