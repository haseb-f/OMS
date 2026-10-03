"use client";

import type { PrintCell, PrintColumn, PrintRowKind } from "@/types/print-engine";

const text = (value: PrintCell | undefined) =>
  value == null ? "" : typeof value === "string" ? value : value.text;

function Cell({ column, value }: { column: PrintColumn; value: PrintCell | undefined }) {
  const main = text(value);
  const sub = value && typeof value === "object" ? value.sub : undefined;
  // Text cells take their reading order from their own content (an Arabic
  // name in an English sheet, or the reverse, keeps its numbers in place).
  const body =
    column.align === "end" ? (
      <span className="num">{main}</span>
    ) : main ? (
      <bdi dir="auto">{main}</bdi>
    ) : (
      main
    );
  return (
    <>
      {body}
      {sub ? <span className="pr-cell-sub">{sub}</span> : null}
    </>
  );
}

/**
 * The one printable table every template renders through (print tokens:
 * `theme/print.css` `.pr-table`). A real `<table>`/`<thead>` so the browser
 * repeats the header row on every page and paginates rows itself; rows never
 * split across pages; long text wraps between words inside its cell (never
 * clipped); `prose` columns keep a minimum width.
 * Numeric (`end`) cells are isolated LTR runs with tabular digits on the
 * logical end. An optional `totalRow` is the last body row — not a `<tfoot>`,
 * which Chrome would repeat on every page.
 */
export function PrintTable({
  columns,
  rows,
  density = "normal",
  totalRow,
  rowKinds,
}: {
  columns: PrintColumn[];
  rows: Record<string, PrintCell>[];
  /** Picked by the template once a table has many columns or rows. */
  density?: "normal" | "compact";
  totalRow?: Record<string, PrintCell>;
  /** One kind per row — report hierarchy / statement opening & closing rows. */
  rowKinds?: PrintRowKind[];
}) {
  return (
    <table className="pr-table" data-density={density}>
      {columns.some((column) => column.width) ? (
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
      ) : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              data-align={column.align ?? "start"}
              data-wrap={column.prose ? "prose" : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} data-kind={rowKinds?.[index] ?? "detail"}>
            {columns.map((column) => (
              <td
                key={column.key}
                data-align={column.align ?? "start"}
                data-wrap={column.nowrap ? "nowrap" : column.prose ? "prose" : undefined}
              >
                <Cell column={column} value={row[column.key]} />
              </td>
            ))}
          </tr>
        ))}
        {totalRow && (
          <tr data-kind="total">
            {columns.map((column) => (
              <td key={column.key} data-align={column.align ?? "start"}>
                <Cell column={column} value={totalRow[column.key]} />
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}
