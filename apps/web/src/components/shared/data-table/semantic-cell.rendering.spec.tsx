import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from "@tanstack/react-table";
import { resolveColumnLayout } from "@/components/shared/data-table/column-engine";
import { applySemanticCellContent } from "@/components/shared/data-table/semantic-cell";
import { formatDisplayDate } from "@/lib/date";

/**
 * Regression coverage for the actual rendering pipeline, not just the
 * formatter — `formatDisplayDate()` already returned "05 Sep 2026" (correct
 * DD MMM YYYY order) even while Production visually showed "Sep 2026 05".
 * The bug was upstream of the string: a column with a declared semantic
 * `type` but no explicit `cell` renderer never got its bidi-isolation
 * wrapper, because `flexRender` wraps TanStack's own default (string)
 * cell function in `React.createElement` too — making
 * `isValidElement(content)` true and short-circuiting
 * `applySemanticCellContent` before it ever reached the `"date"` case.
 *
 * This test drives the exact same two-step composition
 * `EnterpriseDataTable` uses (`resolveColumnLayout` + a
 * `columnsWithExplicitCell`-aware content resolution, then
 * `applySemanticCellContent`) so a regression there fails here too, not
 * just in a hand-rolled reimplementation of `formatDisplayDate`.
 */
interface Row {
  id: string;
  createdAt: string;
}

function renderDateCell(isoDate: string, { explicitCell = false } = {}) {
  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "createdAt",
      meta: { type: "date" },
      accessorFn: (row) => formatDisplayDate(row.createdAt),
      // Mirrors a column author who *does* opt in to a custom cell.
      ...(explicitCell
        ? { cell: (info: { getValue: () => unknown }) => <>{info.getValue()}</> }
        : {}),
    },
  ];
  // Mirrors EnterpriseDataTable's `columnsWithExplicitCell` (computed from
  // the raw column config, before TanStack merges in its own default `cell`).
  const columnsWithExplicitCell = new Set(columns.filter((c) => c.cell != null).map((c) => c.id));

  function TestTable() {
    const table = useReactTable({
      data: [{ id: "1", createdAt: isoDate }],
      columns,
      getCoreRowModel: getCoreRowModel(),
    });
    const row = table.getRowModel().rows[0];
    const cell = row.getVisibleCells()[0];
    const layout = resolveColumnLayout(cell.column.id, cell.column.columnDef.meta);
    const rawContent = columnsWithExplicitCell.has(cell.column.id)
      ? flexRender(cell.column.columnDef.cell, cell.getContext())
      : cell.renderValue<React.ReactNode>();
    const rendered = applySemanticCellContent(rawContent, layout.type);
    return <div dir="rtl">{rendered}</div>;
  }

  return render(<TestTable />);
}

describe("date cell rendering inside an RTL table (semantic-cell pipeline)", () => {
  const cases: Array<[string, string]> = [
    ["2026-09-05", "05 Sep 2026"],
    ["2026-09-03", "03 Sep 2026"],
    ["2026-08-29", "29 Aug 2026"],
  ];

  it.each(cases)(
    "renders %s as the isolated LTR string %s, not visually reflowable by the RTL container",
    (isoDate, expected) => {
      const { container } = renderDateCell(isoDate);

      // The exact text, in DD MMM YYYY order — regressions in the
      // formatter itself still fail here.
      expect(container.textContent).toBe(expected);

      // The bidi-safety mechanism the task requires: an isolated LTR run.
      // Without this, "container.textContent" is still correct (jsdom
      // doesn't do visual bidi layout), but the browser's bidi algorithm
      // is then free to visually reorder "05 Sep 2026" into "Sep 2026 05"
      // inside the RTL ancestor — this is exactly what was happening.
      const semantic = container.querySelector('[data-slot="semantic-value"][data-kind="date"]');
      expect(semantic).not.toBeNull();
      expect(semantic?.getAttribute("dir")).toBe("ltr");
      expect(semantic ? getComputedStyle(semantic).unicodeBidi : null).toBe("isolate");
    },
  );

  it("still applies the wrapper when the column has no explicit cell renderer (the actual Lead createdAt shape)", () => {
    const { container } = renderDateCell("2026-09-05", { explicitCell: false });
    expect(container.querySelector('[data-slot="semantic-value"]')).not.toBeNull();
  });

  it("leaves an explicitly custom cell tree untouched (it owns its own direction)", () => {
    // A column that already renders its own JSX (e.g. a badge, or a cell
    // that itself uses SemanticValue) must not be double-wrapped.
    const { container } = renderDateCell("2026-09-05", { explicitCell: true });
    expect(container.querySelector('[data-slot="semantic-value"]')).toBeNull();
    expect(container.textContent).toBe("05 Sep 2026");
  });
});
