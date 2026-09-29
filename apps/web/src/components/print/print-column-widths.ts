import type { PrintCell, PrintColumn } from "@/types/print-engine";

const cellText = (value: PrintCell | undefined): string =>
  value == null ? "" : typeof value === "string" ? value : value.text;

/** Share of the sheet width a single column may take (percent). */
const MIN_SHARE = 5;
const MAX_SHARE = 38;

/**
 * Content-proportional column widths for list/report prints whose payload
 * sets none. Without them the browser splits the width roughly by header,
 * so a mostly-empty column (e.g. General Ledger «Partner») takes as much room
 * as «Account», whose names then wrap onto two lines and double the page
 * count. Each column is weighted by the 90th-percentile length of its
 * non-empty cells (floored by its header's longest word, empties count as
 * short), clamped to [5 %, 38 %] and normalised to 100 %.
 *
 * Payloads that already carry explicit widths are returned unchanged.
 */
export function autoPrintColumnWidths(
  columns: PrintColumn[],
  rows: Record<string, PrintCell>[],
): PrintColumn[] {
  if (columns.length < 2 || rows.length === 0 || columns.some((c) => c.width)) {
    return columns;
  }
  const weights = columns.map((column) => {
    const lengths = rows
      .map((row) => cellText(row[column.key]).trim().length)
      .sort((a, b) => a - b);
    const p90 = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))] ?? 0;
    const headerWord = Math.max(...column.label.split(/\s+/).map((word) => word.length), 1);
    return Math.max(p90, headerWord, 3);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let shares = weights.map((weight) =>
    Math.min(MAX_SHARE, Math.max(MIN_SHARE, (weight / total) * 100)),
  );
  const scale = 100 / shares.reduce((sum, share) => sum + share, 0);
  shares = shares.map((share) => share * scale);
  return columns.map((column, index) => ({
    ...column,
    width: `${shares[index].toFixed(2)}%`,
  }));
}
