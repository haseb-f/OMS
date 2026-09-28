import type { ReactNode } from "react";
import type { NegativeStyle } from "@/lib/money";

/** The data kind a line arrives with (API tree or client-built). */
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
  /** Amounts by column key. A missing key renders blank (not applicable); 0 renders "—". */
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
  hideBelow?: "md" | "lg" | "xl" | "2xl";
  render?: (line: FinancialReportLine) => ReactNode;
}

export interface FinancialReportColumn {
  key: string;
  labelKey: string;
  emphasize?: boolean;
  /**
   * How a negative is written (default `minus`). Debit-positive balance
   * columns (Trial Balance, ledgers, statements) use `drcr`, so a normal
   * credit balance reads "1,234.00 Cr" instead of a red minus.
   */
  negative?: NegativeStyle;
}

export interface FinancialReportFooter {
  values: Record<string, number>;
}

/**
 * Presentation row kinds — the closed set every report renders with (one
 * style map, design-system §7). Resolved from the data kind by
 * {@link resolveRowKinds}.
 */
export type FinancialReportRowKind = "section" | "parent" | "detail" | "subtotal" | "grand-total";

/**
 * Summary tile tone (summary strip only — never on report rows). `result`
 * resolves to profit / loss / neutral by the value's sign.
 */
export type FinancialReportSummaryTone =
  "revenue" | "expense" | "profit" | "loss" | "result" | "neutral";

export interface FinancialReportSummaryItem {
  /** Stable key (React key, export/print id). */
  id: string;
  label: string;
  value: number;
  /** A final balance/total — framed as the figure that counts. */
  emphasize?: boolean;
  tone?: FinancialReportSummaryTone;
  /** Negative style (default `minus`; `drcr` for debit-positive balances). */
  negative?: NegativeStyle;
  /** Currency of this tile when it differs from the report currency. */
  currency?: string;
  /**
   * Round 3.1 pilot summary cards: a label that says exactly what the figure
   * is ("Net profit for the period"; defaults to `label`) and one short
   * context line ("Revenue minus expenses"). Ignored by the classic strip.
   */
  cardLabel?: string;
  hint?: string;
}

export interface FinancialReportCheck {
  /** The API's verdict. A non-zero `difference` is shown as unbalanced regardless. */
  balanced: boolean;
  /** Left side minus right side (debits − credits; assets − (liabilities + equity)). */
  difference: number;
  /** The equation being checked, e.g. «مدين = دائن». */
  label: string;
  /** When set, the check does not apply to the current filters — shown instead of a verdict. */
  notApplicable?: string;
  /**
   * What the verdict covers — picks the wording ("Entries balance for this
   * period" / "at the report date" / "the entries shown"). Never a claim that
   * the accounting as a whole is correct. Default `period`.
   */
  scope?: FinancialReportCheckScope;
  /** The two compared totals, shown in the reconciliation card and exported. */
  sides?: Array<{
    id: string;
    label: string;
    value: number;
    /** Pilot summary card label / context line (see {@link FinancialReportSummaryItem}). */
    cardLabel?: string;
    hint?: string;
  }>;
  /** Where to investigate an imbalance (shown in the unbalanced state only). */
  drillDown?: { href: string; label: string };
}

export type FinancialReportCheckScope = "period" | "asOf" | "page";

/**
 * The deliberate summary above a report: its key final figures, and — for
 * reports that must balance (Trial Balance, Balance Sheet) — the check with
 * the exact discrepancy, so an imbalance is never a single red word.
 */
export interface FinancialReportSummary {
  items: FinancialReportSummaryItem[];
  check?: FinancialReportCheck;
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

const FINAL_KINDS = new Set<FinancialReportLineKind>(["grand_total", "result", "closing"]);

/**
 * Maps every line to its presentation row kind:
 * - section → `section`; COA group / opening balance → `parent`;
 *   account / movement rows → `detail`.
 * - subtotal, section total and ledger closing rows → `subtotal` (stressed,
 *   never muted — a closing balance is the block's key figure).
 * - An in-section `result` (Balance Sheet "Current Earnings") is an
 *   ordinary `detail` row.
 * - Exactly ONE `grand-total` per report: the last top-level final line
 *   (grand total / result / closing). When the report has a totals footer,
 *   the footer is the grand total and no line is.
 */
export function resolveRowKinds(
  lines: FinancialReportLine[],
  { hasFooter = false }: { hasFooter?: boolean } = {},
): Map<string, FinancialReportRowKind> {
  const kinds = new Map<string, FinancialReportRowKind>();
  let grandTotalId: string | null = null;
  if (!hasFooter) {
    for (const line of lines) {
      if (FINAL_KINDS.has(line.kind)) grandTotalId = line.id;
    }
  }
  const walk = (nodes: FinancialReportLine[]) => {
    for (const line of nodes) {
      kinds.set(line.id, rowKindOf(line, line.id === grandTotalId));
      walk(line.children);
    }
  };
  walk(lines);
  return kinds;
}

function rowKindOf(line: FinancialReportLine, isGrandTotal: boolean): FinancialReportRowKind {
  if (isGrandTotal) return "grand-total";
  switch (line.kind) {
    case "section":
      return "section";
    case "group":
    case "opening":
      return "parent";
    case "subtotal":
    case "section_total":
    case "closing":
    case "grand_total":
      return "subtotal";
    case "result":
      return line.parentId === null && line.level === 0 ? "subtotal" : "detail";
    default:
      return "detail";
  }
}

/**
 * The value a cell shows for a line. A net LOSS row is already labelled
 * "Net Loss", so its figure is shown as an absolute amount (the label carries
 * the sign) and flagged adverse — never "Net Loss -1,000".
 */
export function displayAmount(
  line: Pick<FinancialReportLine, "id" | "values">,
  key: string,
): { value: number | undefined; adverse: boolean } {
  const value = line.values[key];
  if (value === undefined) return { value: undefined, adverse: false };
  if (line.id === "net-income" && value < 0) return { value: Math.abs(value), adverse: true };
  return { value, adverse: false };
}
