"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import { clsx as cx } from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";
import { useIsMobile } from "@/hooks/use-mobile";
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

/*
 * A quiet Geist table (design-system §12.6): hairline header rule and rows,
 * the label column pinned at the logical start on every width (narrower on
 * phones, with an end hairline while the figures scroll past it).
 */
/** Identical inline padding for header, body and footer cells — the single source of column alignment. */
const CELL = "px-3 align-middle whitespace-nowrap first:ps-4 last:pe-4";
const PIN_BODY = "sticky start-0 z-(--z-pinned) max-sm:border-e max-sm:border-e-border";
/** Every header cell sticks to the top of the grid's scroll area; the label header is also the pinned corner. */
const HEAD =
  "sticky top-0 z-(--z-sticky) h-9 border-b border-border bg-table-header text-table-head text-table-header-foreground";
const PIN_HEAD = "start-0 z-(--z-sticky-corner) max-sm:border-e max-sm:border-e-border";
const ROW_RULE = "[&>td]:border-b [&>td]:border-b-border hover:[&>td]:bg-table-row-hover";
const ROW_PAD = "py-1.5";
const LABEL_MIN_PHONE_REM = 12;
/** Dr/Cr balance column on phones — fits 1,000,000.00 + the side, so label + closing fit 390px. */
const DRCR_PHONE_REM = 9.5;
/** Same widths as CSS (literal for Tailwind): 9.5rem on phones, 11rem from `sm`. */
const DRCR_WIDTH = "[--report-drcr-w:9.5rem] sm:[--report-drcr-w:11rem]";
/** Phone breakpoint (Tailwind `sm`) for the phone-only column order. */
const SM_PX = 640;
/** Hierarchy indent per level — tighter on phones so the pinned label keeps its text. */
const INDENT = "[--report-indent:0.6rem] sm:[--report-indent:1.1rem]";

/** Minimum label-column width (rem): statements, and ledgers with descriptive columns. */
const LABEL_MIN_REM = 14;
const LEDGER_LABEL_MIN_REM = 16;

/** Amount column width: wide enough for 1,000,000,000.00 (and a Dr/Cr side). */
function amountWidthRem(column: FinancialReportColumn): number {
  return column.negative === "drcr" ? 11 : 9;
}

/**
 * Row label run: isolated in its own direction (`dir="auto"`), so a Latin
 * account name inside an Arabic row truncates at its own end ("Tamara cl…"),
 * never at the start.
 */
function RowLabel({ label }: { label: string }) {
  return (
    <bdi dir="auto" className="block truncate">
      {label}
    </bdi>
  );
}

export function FinancialReportTable({
  lines,
  columns: columnsProp,
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
  // Phones: the figure that counts (`emphasize`, e.g. the closing
  // balance) comes right after the pinned label, so it is visible without
  // scrolling; the other amounts follow, one swipe away. Screen only —
  // export and print keep the report's own column order.
  const phone = useIsMobile(SM_PX);
  const columns = phone
    ? [
        ...columnsProp.filter((column) => column.emphasize),
        ...columnsProp.filter((column) => !column.emphasize),
      ]
    : columnsProp;
  const phoneAmountWidth = columns.reduce(
    (sum, column) => sum + (column.negative === "drcr" ? DRCR_PHONE_REM : amountWidthRem(column)),
    0,
  );
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
      breakpoint === "base"
        ? `${Math.min(labelMin, LABEL_MIN_PHONE_REM) + textWidthAt(breakpoint) + phoneAmountWidth}rem`
        : `${labelMin + textWidthAt(breakpoint) + amountWidth}rem`,
    ]),
  ) as CSSProperties;

  // When the grid scrolls sideways, open it on the label + the first
  // amounts: the descriptive text columns (source document, journal no.)
  // start scrolled past, one swipe away. Only while the label column is
  // pinned — otherwise the label itself would scroll out of view.
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
    // Pinned = sticky at the inline start.
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
        className={cx(
          "w-full min-w-(--report-min-w-base) table-fixed border-separate border-spacing-0 text-table md:min-w-(--report-min-w-md) lg:min-w-(--report-min-w-lg) xl:min-w-(--report-min-w-xl) 2xl:min-w-(--report-min-w-2xl)",
          DRCR_WIDTH,
        )}
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
            <col
              key={column.key}
              style={{
                width:
                  column.negative === "drcr"
                    ? "var(--report-drcr-w)"
                    : `${amountWidthRem(column)}rem`,
              }}
            />
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
                  ROW_RULE,
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
                <td data-slot="table-cell" className={cx(CELL, PIN_BODY, ROW_PAD)}>
                  <div
                    className={cx("flex min-w-0 items-center gap-1.5", INDENT)}
                    style={{
                      paddingInlineStart: `calc(${Math.max(line.level, 0)} * var(--report-indent))`,
                    }}
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
                        className={cx(
                          "rounded-xs hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring",
                          "block min-w-0",
                        )}
                        title={label}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <RowLabel label={label} />
                      </Link>
                    ) : (
                      <span className="block min-w-0" title={label}>
                        <RowLabel label={label} />
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
                      ROW_PAD,
                      "truncate font-normal",
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
                      className={cx(CELL, ROW_PAD, "text-end")}
                    >
                      <ReportMoney
                        // An expanded section's figures are repeated by its
                        // total row right below — shown once, there. An
                        // expanded COA parent keeps its figure, row weight
                        // and color (§7 hierarchy) — a subtotal of what it holds.
                        value={kind === "section" && isExpanded ? undefined : value}
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
              <td data-slot="table-cell" className={cx(CELL, PIN_BODY, ROW_PAD)}>
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
                <td
                  key={column.key}
                  data-slot="table-cell"
                  className={cx(CELL, ROW_PAD, "text-end")}
                >
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
