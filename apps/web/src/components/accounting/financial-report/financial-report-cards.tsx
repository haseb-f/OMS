"use client";

import Link from "next/link";
import { clsx as cx } from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { ReportMoney } from "./report-money";
import { resolveFinancialLineLabel } from "./line-label";
import {
  displayAmount,
  flattenVisibleLines,
  resolveRowKinds,
  type FinancialReportColumn,
  type FinancialReportFooter,
  type FinancialReportLine,
  type FinancialReportRowKind,
  type FinancialReportTextColumn,
} from "./types";

/**
 * Grouped-card presentation of a financial report (design-system §12.19) — the
 * "Grid" view of the same lines the table shows, NOT a generic customer card.
 *
 * Accounting meaning is kept, not flattened: every top-level section / group
 * becomes ONE card whose rows are its own descendants in the same order and
 * indentation (the hierarchy), each row carries ALL the report's amount
 * columns with their names (nothing dropped), subtotal and grand-total rows keep
 * the table's weight and sunken fill, and the report's totals sit in their own
 * card at the end. Expansion, drill-down links, drill-through rows and the sign
 * convention are the table's (the same `expanded` / `onToggle` / `rowHref` /
 * `onPostingClick`, `displayAmount`, `ReportMoney`). Hierarchy is never carried
 * by colour; there are no status colours here.
 */

const ROW_STYLE: Record<FinancialReportRowKind, string> = {
  section: "font-semibold text-foreground",
  parent: "font-medium text-foreground",
  detail: "font-normal text-foreground",
  subtotal: "bg-surface-sunken font-semibold text-foreground",
  "grand-total": "bg-surface-sunken font-semibold text-foreground",
};

function RowLabel({ label }: { label: string }) {
  return (
    <bdi dir="auto" className="block truncate">
      {label}
    </bdi>
  );
}

export function FinancialReportCards({
  lines,
  columns,
  textColumns = [],
  expanded,
  onToggle,
  onPostingClick,
  rowHref,
  emptyLabel,
  footer,
  rowKinds: rowKindsProp,
}: {
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
  textColumns?: FinancialReportTextColumn[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onPostingClick?: (line: FinancialReportLine) => void;
  rowHref?: (line: FinancialReportLine) => string | null | undefined;
  emptyLabel: string;
  footer?: FinancialReportFooter;
  rowKinds?: Map<string, FinancialReportRowKind>;
}) {
  const { t, locale } = useLocale();
  const rowKinds = rowKindsProp ?? resolveRowKinds(lines, { hasFooter: !!footer });

  const roots = lines.filter((line) => line.kind !== "spacer");
  // A root with children is a card of its own; childless roots (closing balance,
  // result, totals) gather into one closing card so they stay together.
  const cards: Array<{
    key: string;
    root: FinancialReportLine | null;
    rows: FinancialReportLine[];
  }> = [];
  const loose: FinancialReportLine[] = [];
  for (const root of roots) {
    if (root.children.length > 0) {
      cards.push({
        key: root.id,
        root,
        rows: expanded.has(root.id) ? flattenVisibleLines(root.children, expanded) : [],
      });
    } else loose.push(root);
  }
  if (loose.length > 0) cards.push({ key: "__loose", root: null, rows: loose });

  if (cards.length === 0) {
    return <div className="px-3 py-6 text-center text-muted-foreground">{emptyLabel}</div>;
  }

  const amountLabel = (column: FinancialReportColumn) => t(column.labelKey as MessageKey);

  const renderAmounts = (line: FinancialReportLine, kind: FinancialReportRowKind, hide = false) => {
    if (hide) return null;
    if (columns.length === 1) {
      const { value, adverse } = displayAmount(line, columns[0].key, columns[0]);
      return (
        <div className="shrink-0 text-end">
          <ReportMoney value={value} adverse={adverse} negative={columns[0].negative} />
        </div>
      );
    }
    return (
      <dl
        className="grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-x-3 gap-y-0.5"
        data-row-kind={kind}
      >
        {columns.map((column) => {
          const { value, adverse } = displayAmount(line, column.key, column);
          return (
            <div key={column.key} className="min-w-0 text-end">
              <dt className="truncate text-micro font-normal text-muted-foreground">
                {amountLabel(column)}
              </dt>
              <dd className="m-0 text-table">
                <ReportMoney value={value} adverse={adverse} negative={column.negative} />
              </dd>
            </div>
          );
        })}
      </dl>
    );
  };

  const renderRow = (line: FinancialReportLine, baseLevel: number, isHeader = false) => {
    const kind = rowKinds.get(line.id) ?? "detail";
    const label = resolveFinancialLineLabel(line, locale, t);
    const href = rowHref?.(line) ?? null;
    const canDrill = Boolean(onPostingClick && line.kind === "posting");
    const open = expanded.has(line.id) && line.children.length > 0;
    const texts = textColumns
      .map((column) => ({
        column,
        node: column.render ? column.render(line) : line.text?.[column.key],
      }))
      .filter((entry) => entry.node);
    const level = Math.max(line.level - baseLevel, 0);
    return (
      <li
        key={line.id}
        data-row-kind={kind}
        className={cx(
          "flex min-w-0 flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0",
          ROW_STYLE[kind],
          canDrill &&
            "cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring hover:bg-table-row-hover",
        )}
        tabIndex={canDrill ? 0 : undefined}
        onClick={canDrill ? () => onPostingClick?.(line) : undefined}
        onKeyDown={
          canDrill
            ? (event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPostingClick?.(line);
                }
              }
            : undefined
        }
      >
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={isHeader ? undefined : { paddingInlineStart: `calc(${level} * 0.9rem)` }}
        >
          {line.children.length > 0 ? (
            <button
              type="button"
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(line.id);
              }}
              aria-expanded={expanded.has(line.id)}
              aria-label={label}
            >
              {open ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5 rtl:rotate-180" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          {line.code ? (
            <span className="num shrink-0 text-caption font-normal text-muted-foreground">
              {line.code}
            </span>
          ) : null}
          <span className="block min-w-0 flex-1" title={label}>
            {href ? (
              <Link
                href={href}
                className="rounded-xs hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
                onClick={(event) => event.stopPropagation()}
              >
                <RowLabel label={label} />
              </Link>
            ) : (
              <RowLabel label={label} />
            )}
          </span>
          {columns.length === 1 ? renderAmounts(line, kind, isHeader && open) : null}
        </div>
        {texts.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-x-3 ps-6.5 text-caption font-normal text-muted-foreground">
            {texts.map(({ column, node }) => (
              <span key={column.key} className="min-w-0 truncate">
                <bdi>{node}</bdi>
              </span>
            ))}
          </div>
        ) : null}
        {columns.length > 1 ? (
          <div className="ps-6.5">{renderAmounts(line, kind, isHeader && open)}</div>
        ) : null}
      </li>
    );
  };

  return (
    <div data-record-grid="wide" data-slot="report-cards">
      {cards.map((card) => (
        <section
          key={card.key}
          data-record-card=""
          data-static=""
          data-tone="neutral"
          className="flex min-w-0 flex-col overflow-hidden"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {card.root ? renderRow(card.root, card.root.level, true) : null}
            {card.rows.map((line) => renderRow(line, card.root ? card.root.level + 1 : 0))}
          </ul>
        </section>
      ))}
      {footer ? (
        <section
          data-record-card=""
          data-static=""
          data-tone="neutral"
          data-row-kind="grand-total"
          className="flex min-w-0 flex-col overflow-hidden"
        >
          <div className="flex flex-col gap-1 bg-surface-sunken px-3 py-2 font-semibold">
            <span>{t("reports.finance.totals")}</span>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-x-3 gap-y-0.5">
              {columns.map((column) => (
                <div key={column.key} className="min-w-0 text-end">
                  <dt className="truncate text-micro font-normal text-muted-foreground">
                    {amountLabel(column)}
                  </dt>
                  <dd className="m-0 text-table">
                    <ReportMoney value={footer.values[column.key]} negative={column.negative} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}
    </div>
  );
}
