import type { ReactNode } from "react";

export type FinancialReportLineKind =
  | "section"
  | "group"
  | "posting"
  | "subtotal"
  | "section_total"
  | "opening"
  | "closing"
  | "grand_total"
  | "result"
  | "spacer";

export interface FinancialReportLine {
  id: string;
  parentId: string | null;
  kind: FinancialReportLineKind;
  level: number;
  code?: string;
  label: string;
  labelEn?: string | null;
  accountId?: string;
  accountType?: string;
  allowsPosting?: boolean;
  expandable: boolean;
  values: Record<string, number>;
  /** Plain-text values for `textColumns` (also what Excel/CSV/print export). */
  text?: Record<string, string>;
  children: FinancialReportLine[];
}

/**
 * A descriptive (non-money) column shown between the name and the amount
 * columns — date, journal, entry, reference, partner in ledger-style
 * reports. `render` may return a drill-down link; `line.text[key]` is the
 * exported value either way.
 */
export interface FinancialReportTextColumn {
  key: string;
  labelKey: string;
  /** Column width in rem (default 8). */
  width?: number;
  /** Hidden on narrow screens below this breakpoint (still exported/printed). */
  hideBelow?: "md" | "lg";
  render?: (line: FinancialReportLine) => ReactNode;
}

export interface FinancialReportColumn {
  key: string;
  labelKey: string;
  emphasize?: boolean;
  /** When false, negative values stay dark (unsigned debit/credit columns). */
  signed?: boolean;
}

export interface FinancialReportFooter {
  values: Record<string, number>;
}

/**
 * The deliberate summary above a report: its key final figures, and — for
 * reports that must balance (Trial Balance, Balance Sheet) — the check with
 * the exact discrepancy, so an imbalance is never a single red word.
 */
export type FinancialReportSummaryTone = "revenue" | "expense" | "result";

export interface FinancialReportSummaryItem {
  label: string;
  value: number;
  /** A final balance/total — weighted and framed as the figure that counts. */
  emphasize?: boolean;
  /** Category color (summary only). "result" is green/red/neutral by sign. */
  tone?: FinancialReportSummaryTone;
}

export interface FinancialReportSummary {
  items: FinancialReportSummaryItem[];
  check?: { balanced: boolean; difference: number; label: string };
}

/** Finds a line anywhere in the tree by id (e.g. "revenue:total"). */
export function findLine(lines: FinancialReportLine[], id: string): FinancialReportLine | null {
  for (const line of lines) {
    if (line.id === id) return line;
    const nested = findLine(line.children, id);
    if (nested) return nested;
  }
  return null;
}

export function flattenVisibleLines(
  lines: FinancialReportLine[],
  expanded: Set<string>,
): FinancialReportLine[] {
  const out: FinancialReportLine[] = [];
  const walk = (nodes: FinancialReportLine[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length > 0 && expanded.has(node.id)) {
        walk(node.children);
      }
    }
  };
  walk(lines);
  return out;
}

export function collectExpandableIds(lines: FinancialReportLine[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: FinancialReportLine[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };
  walk(lines);
  return ids;
}

export function defaultExpandedIds(lines: FinancialReportLine[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: FinancialReportLine[]) => {
    for (const node of nodes) {
      if (node.kind === "section" || (node.kind === "group" && node.level <= 2)) {
        ids.add(node.id);
      }
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(lines);
  return ids;
}
