"use client";

import { useEffect, useRef, type CSSProperties } from "react";
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

/*
 * Class lists here are composed with plain `clsx`, not `cn`: tailwind-merge
 * treats the custom type-scale utilities (`text-table-head`, `text-caption`)
 * as colors and would drop them next to a text color.
 */

/** Static class names (Tailwind must see them literally). */
const HIDE_BELOW_CELL: Record<NonNullable<FinancialReportTextColumn["hideBelow"]>, string> = {
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};
const HIDE_BELOW_COL: Record<NonNullable<FinancialReportTextColumn["hideBelow"]>, string> = {
  md: "hidden md:table-column",
  lg: "hidden lg:table-column",
  xl: "hidden xl:table-column",
  "2xl": "hidden 2xl:table-column",
};

/** Breakpoints in ascending order — a `hideBelow` column is visible from its own breakpoint up. */
const BREAKPOINTS = ["base", "md", "lg", "xl", "2xl"] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

/**
 * THE row style map (design-system §7) — hierarchy through weight, rules and
 * the sunken fill, never color. Label and figures share the row's weight.
 * Rules and fills sit on the cells (the grid uses separated borders so the
 * sticky header and pinned label column keep them), and every cell has an
 * explicit background so the pinned label never shows content beneath it.
 */
export const ROW_STYLE: Record<FinancialReportRowKind, string> = {
  section:
    "font-semibold text-foreground [&>td]:bg-card [&>td]:border-t [&>td]:border-t-border-strong",
  parent: "font-medium text-foreground [&>td]:bg-card",
  detail: "font-normal text-foreground [&>td]:bg-card",
  subtotal:
    "font-semibold text-foreground [&>td]:bg-surface-sunken [&>td]:border-t [&>td]:border-t-border-strong",
  "grand-total":
    "font-semibold text-foreground [&>td]:bg-surface-sunken [&>td]:border-t-2 [&>td]:border-t-foreground/60",
};

/** Identical inline padding for header, body and footer cells — the single source of column alignment. */
const CELL = "px-3 align-middle whitespace-nowrap";

/** Label column pinned at the logical start from `sm` up (phones scroll it with the rest). */
const PIN_BODY = "sm:sticky sm:start-0 sm:z-(--z-pinned)";
/** Every header cell sticks to the top of the grid's scroll area; the label header is also the pinned corner. */
const HEAD =
  "sticky top-0 z-(--z-sticky) h-9 border-b border-border-strong bg-table-header text-table-head text-table-header-foreground";
const PIN_HEAD = "sm:start-0 sm:z-(--z-sticky-corner)";

/** Minimum label-column width (rem): statements, and ledgers with descriptive columns. */
const LABEL_MIN_REM = 14;
const LEDGER_LABEL_MIN_REM = 16;

/** Amount column width: wide enough for 1,000,000,000.00 (and a Dr/Cr side). */
function amountWidthRem(column: FinancialReportColumn): number {
  return column.negative === "drcr" ? 11 : 9;
}

export function FinancialReportTable({
  lines,
  columns,
  expanded,
  onToggle,
  onPostingClick,
  rowHref,
  emptyLabel,
  nameHeaderKey,
  footer,
  textColumns = [],
  rowKinds: rowKindsProp,
  maxHeightClassName = "md:max-h-[70dvh]",
}: {
  lines: FinancialReportLine[];
  columns: FinancialReportColumn[];
  textColumns?: FinancialReportTextColumn[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onPostingClick?: (line: FinancialReportLine) => void;
  /** Drill-down link for a row (its label becomes a link), e.g. account → account statement. */
  rowHref?: (line: FinancialReportLine) => string | null | undefined;
  emptyLabel: string;
  nameHeaderKey?: MessageKey;
  footer?: FinancialReportFooter;
  /** Presentation kinds (computed once by the report shell); derived here when omitted. */
  rowKinds?: Map<string, FinancialReportRowKind>;
  /** Vertical bound of the grid's own scroll area (the sticky header sticks inside it). */
  maxHeightClassName?: string;
}) {
  const { t, locale } = useLocale();
  const rows = flattenVisibleLines(lines, expanded);
  const rowKinds = rowKindsProp ?? resolveRowKinds(lines, { hasFooter: !!footer });
  // The table's minimum width is computed per breakpoint from the columns
  // actually visible there (a `hideBelow` column only counts once it shows),
  // so the label column always keeps at least `labelMin` and the header
  // cells never overlap. Wider content scrolls inside the report grid.
  const labelMin = textColumns.length > 0 ? LEDGER_LABEL_MIN_REM : LABEL_MIN_REM;
  const amountWidth = columns.reduce((sum, column) => sum + amountWidthRem(column), 0);
  const textWidthAt = (breakpoint: Breakpoint) =>
    textColumns
      .filter(
        (column) =>
          !column.hideBelow ||
          BREAKPOINTS.indexOf(column.hideBelow) <= BREAKPOINTS.indexOf(breakpoint),
      )
      .reduce((sum, column) => sum + (column.width ?? 8), 0);
  const minWidthStyle = Object.fromEntries(
    BREAKPOINTS.map((breakpoint) => [
      `--report-min-w-${breakpoint}`,
      `${labelMin + textWidthAt(breakpoint) + amountWidth}rem`,
    ]),
  ) as CSSProperties;

  // When the grid scrolls sideways, open it on the label + the first
  // amounts: the descriptive text columns (source document, journal no.)
  // start scrolled past, one swipe away. Only while the label column is
  // pinned (sm+) — otherwise the label itself would scroll out of view.
  // Runs when the column set changes, never on data refreshes, so it does
  // not fight the user's own scroll position.
  const gridRef = useRef<HTMLDivElement>(null);
  const hasRows = rows.length > 0;
  const columnSignature = [...textColumns.map((c) => c.key), ...columns.map((c) => c.key)].join(
    ",",
  );
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !hasRows || textColumns.length === 0) return;
    if (grid.scrollWidth <= grid.clientWidth + 1) return;
    const heads = grid.querySelectorAll<HTMLElement>("thead th");
    const label = heads[0];
    const firstAmount = heads[1 + textColumns.length];
    if (!label || !firstAmount) return;
    const rtl = getComputedStyle(grid).direction === "rtl";
    // Pinned = sticky at the inline start (sm+); on phones it scrolls too.
    const labelStyle = getComputedStyle(label);
    if ((rtl ? labelStyle.right : labelStyle.left) === "auto") return;
    const labelBox = label.getBoundingClientRect();
    const amountBox = firstAmount.getBoundingClientRect();
    const gap = rtl ? labelBox.left - amountBox.right : amountBox.left - labelBox.right;
    if (gap > 1) grid.scrollLeft += rtl ? -gap : gap;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per column set
  }, [columnSignature, hasRows]);

  return (
    // ONE scroll container for both axes: the sticky header sticks to it and
    // horizontal scroll never reaches the page.
    <div
      ref={gridRef}
      data-slot="report-grid"
      className={cx("relative w-full min-w-0 overflow-auto print:max-h-none", maxHeightClassName)}
    >
      <table
        data-slot="table"
        className="w-full min-w-(--report-min-w-base) table-fixed border-separate border-spacing-0 text-table md:min-w-(--report-min-w-md) lg:min-w-(--report-min-w-lg) xl:min-w-(--report-min-w-xl) 2xl:min-w-(--report-min-w-2xl)"
        style={minWidthStyle}
      >
        <colgroup>
          {/* No fixed width: the label takes whatever the figures leave, never less than `labelMin`. */}
          <col />
          {textColumns.map((column) => (
            <col
              key={column.key}
              className={column.hideBelow ? HIDE_BELOW_COL[column.hideBelow] : undefined}
              style={{ width: `${column.width ?? 8}rem` }}
            />
          ))}
          {columns.map((column) => (
            <col key={column.key} style={{ width: `${amountWidthRem(column)}rem` }} />
          ))}
        </colgroup>
        <thead data-slot="table-header">
          <tr data-slot="table-row">
            <th
              scope="col"
              data-slot="table-head"
              className={cx(CELL, HEAD, PIN_HEAD, "truncate text-start")}
              title={t(nameHeaderKey ?? "reports.finance.fields.accountName")}
            >
              {t(nameHeaderKey ?? "reports.finance.fields.accountName")}
            </th>
            {textColumns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-slot="table-head"
                className={cx(
                  CELL,
                  HEAD,
                  "truncate text-start",
                  column.hideBelow && HIDE_BELOW_CELL[column.hideBelow],
                )}
                title={t(column.labelKey as MessageKey)}
              >
                {t(column.labelKey as MessageKey)}
              </th>
            ))}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-slot="table-head"
                // Same end edge as the values below it.
                className={cx(CELL, HEAD, "truncate text-end")}
                title={t(column.labelKey as MessageKey)}
              >
                {t(column.labelKey as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody data-slot="table-body">
          {rows.map((line) => {
            const kind = rowKinds.get(line.id) ?? "detail";
            const label = resolveFinancialLineLabel(line, locale, t);
            const canDrill = Boolean(onPostingClick && line.kind === "posting");
            const href = rowHref?.(line) ?? null;
            const isExpanded = expanded.has(line.id) && line.children.length > 0;
            return (
              <tr
                key={line.id}
                data-slot="table-row"
                data-row-kind={kind}
                className={cx(
                  "[&>td]:border-b [&>td]:border-b-border/60 hover:[&>td]:bg-table-row-hover",
                  ROW_STYLE[kind],
                  canDrill &&
                    "cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-focus-ring",
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
                <td data-slot="table-cell" className={cx(CELL, PIN_BODY, "py-1")}>
                  <div
                    className="flex min-w-0 items-center gap-1.5"
                    style={{ paddingInlineStart: `${Math.max(line.level, 0) * 1.1}rem` }}
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
                        {expanded.has(line.id) ? (
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
                    {href ? (
                      <Link
                        href={href}
                        className="truncate rounded-xs hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring"
                        title={label}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="truncate" title={label}>
                        {label}
                      </span>
                    )}
                  </div>
                </td>
                {textColumns.map((column) => (
                  <td
                    key={column.key}
                    data-slot="table-cell"
                    className={cx(
                      CELL,
                      "truncate py-1 font-normal",
                      column.hideBelow && HIDE_BELOW_CELL[column.hideBelow],
                    )}
                    title={line.text?.[column.key] || undefined}
                  >
                    {/* <bdi>: dates/references keep their own order inside Arabic rows. */}
                    {column.render ? (
                      column.render(line)
                    ) : (
                      <bdi>{line.text?.[column.key] ?? ""}</bdi>
                    )}
                  </td>
                ))}
                {columns.map((column) => {
                  const { value, adverse } = displayAmount(line, column.key);
                  return (
                    <td
                      key={column.key}
                      data-slot="table-cell"
                      className={cx(CELL, "py-1 text-end")}
                    >
                      <ReportMoney
                        // An expanded section's figures are repeated by its
                        // total row right below — shown once, there. An
                        // expanded COA parent keeps its figure, quietly, so
                        // it is never read (or re-added) as a separate amount.
                        value={kind === "section" && isExpanded ? undefined : value}
                        quiet={kind === "parent" && isExpanded}
                        adverse={adverse}
                        negative={column.negative}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {footer ? (
          <tfoot data-slot="table-footer">
            <tr
              data-slot="table-row"
              data-row-kind="grand-total"
              className={ROW_STYLE["grand-total"]}
            >
              <td data-slot="table-cell" className={cx(CELL, PIN_BODY, "py-1.5")}>
                {t("reports.finance.totals")}
              </td>
              {textColumns.map((column) => (
                <td
                  key={column.key}
                  data-slot="table-cell"
                  className={cx(CELL, column.hideBelow && HIDE_BELOW_CELL[column.hideBelow])}
                />
              ))}
              {columns.map((column) => (
                <td key={column.key} data-slot="table-cell" className={cx(CELL, "py-1.5 text-end")}>
                  <ReportMoney value={footer.values[column.key]} negative={column.negative} />
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {rows.length === 0 ? (
        // Outside the table: a spanning cell would count columns hidden at
        // this breakpoint and add a phantom one. Pinned to the visible width.
        <div className="sticky start-0 w-full px-3 py-6 text-center text-muted-foreground">
          {emptyLabel}
        </div>
      ) : null}
    </div>
  );
}
