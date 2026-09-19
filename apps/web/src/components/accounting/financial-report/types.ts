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
  children: FinancialReportLine[];
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
  balanced?: boolean;
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
