import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/hooks/use-print-engine", () => ({ usePrintEngine: () => ({ printList: vi.fn() }) }));
vi.mock("@/providers/company-provider", () => ({ useCompany: () => ({ activeCompany: null }) }));

const userRef = vi.hoisted(() => ({ current: { id: "u1" } as { id: string } | null }));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: userRef.current, hasPermission: () => true }),
}));

import { EnterpriseDataTable } from "./enterprise-data-table";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * R7 A - Table/Grid switch + the dedicated density control. The Grid is the
 * table's own card branch forced on, so the contract under test is parity:
 * the same page of records, the same selection, the choice remembered per
 * user and per table, and Columns left as column configuration only.
 */
interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "r-a", name: "Alpha" },
  { id: "r-b", name: "Bravo" },
  { id: "r-c", name: "Charlie" },
];

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorKey: "name", meta: { identity: true } },
];

function Harness({
  tableId = "r7-grid-spec",
  withGrid = true,
  gridView,
  initialSelection = {},
}: {
  tableId?: string;
  withGrid?: boolean;
  gridView?: boolean;
  initialSelection?: RowSelectionState;
}) {
  const [selection, setSelection] = useState<RowSelectionState>(initialSelection);
  return (
    <TooltipProvider>
      <EnterpriseDataTable
        tableId={tableId}
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        gridView={gridView}
        renderGridCard={
          withGrid
            ? ({ row, selected, onToggleSelected }) => (
                <article data-testid="grid-card" data-id={row.id}>
                  <input
                    type="checkbox"
                    aria-label={`select-${row.id}`}
                    checked={selected}
                    onChange={onToggleSelected}
                  />
                  {row.name}
                </article>
              )
            : undefined
        }
      />
    </TooltipProvider>
  );
}

const view = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-table-view]")?.dataset.tableView;
const gridIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="grid-card"]')).map(
    (card) => card.dataset.id,
  );
const tableIds = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("tbody tr[data-row-id], tbody tr"))
    .map((tr) => tr.textContent ?? "")
    .filter((text) => /Alpha|Bravo|Charlie/.test(text));
const switchTo = (container: HTMLElement, which: "table" | "grid") =>
  fireEvent.click(container.querySelector<HTMLElement>(`[data-view="${which}"]`)!);

beforeEach(() => {
  window.localStorage.clear();
  userRef.current = { id: "u1" };
});
afterEach(cleanup);

describe("Table/Grid switch", () => {
  it("is universal (R9): a table without a grid renderer still offers the switch", () => {
    const { container } = render(<Harness withGrid={false} />);
    expect(container.querySelector("[data-view-toggle]")).not.toBeNull();
    expect(view(container)).toBe("cards");
  });

  it("draws the AUTOMATIC record card for a table with no renderer, one per row of the page", () => {
    const { container } = render(<Harness withGrid={false} />);
    switchTo(container, "grid");
    expect(view(container)).toBe("grid");
    const cards = container.querySelectorAll("[data-record-grid] [data-record-card]");
    expect(cards).toHaveLength(rows.length);
    expect(cards[0].textContent).toContain("Alpha");
    // The same page, in the same order, as the table.
    expect(tableIds(container)).toHaveLength(rows.length);
  });

  it("a table can opt out explicitly (gridView={false}) and shows no switch", () => {
    const { container } = render(<Harness withGrid={false} gridView={false} />);
    expect(container.querySelector("[data-view-toggle]")).toBeNull();
  });

  it("starts as the table; Grid forces the card branch and draws every row of the page", () => {
    const { container } = render(<Harness />);
    expect(view(container)).toBe("cards");
    expect(gridIds(container)).toEqual([]);

    switchTo(container, "grid");
    expect(view(container)).toBe("grid");
    // Parity: the very same records, in the same order, as the table shows.
    expect(gridIds(container)).toEqual(rows.map((row) => row.id));
    expect(tableIds(container)).toHaveLength(rows.length);
    // The desktop table region no longer opts into @4xl display.
    expect(container.querySelector("table")?.closest("div")?.className).not.toContain(
      "@4xl/enterprise-table:block",
    );
  });

  it("keeps the selection when switching views, in both directions", () => {
    const { container } = render(<Harness />);
    const desktopBoxes = Array.from(
      container.querySelectorAll<HTMLElement>('td[data-column-id="select"] [role="checkbox"]'),
    );
    fireEvent.click(desktopBoxes[1]); // select Bravo in the table

    switchTo(container, "grid");
    const gridBox = (id: string) =>
      container.querySelector<HTMLInputElement>(`input[aria-label="select-${id}"]`)!;
    expect(gridBox("r-b").checked).toBe(true);
    expect(gridBox("r-a").checked).toBe(false);

    fireEvent.click(gridBox("r-c")); // add Charlie in the grid
    switchTo(container, "table");
    const after = Array.from(
      container.querySelectorAll<HTMLElement>('td[data-column-id="select"] [role="checkbox"]'),
    ).map((box) => box.getAttribute("aria-checked"));
    expect(after).toEqual(["false", "true", "true"]);
  });

  it("remembers the view per user and per table", () => {
    const first = render(<Harness />);
    switchTo(first.container, "grid");
    expect(window.localStorage.getItem("oms.table.u1.r7-grid-spec.view")).toBe("grid");
    first.unmount();

    // Same user, same table: back in Grid after a reload.
    const reloaded = render(<Harness />);
    expect(view(reloaded.container)).toBe("grid");
    reloaded.unmount();

    // Another table of the same user, and another user: untouched.
    const otherTable = render(<Harness tableId="other-table" />);
    expect(view(otherTable.container)).toBe("cards");
    otherTable.unmount();
    userRef.current = { id: "u2" };
    const otherUser = render(<Harness />);
    expect(view(otherUser.container)).toBe("cards");
  });
});

describe("density control", () => {
  it("is its own toolbar control, no longer inside the Columns menu", () => {
    const { container } = render(<Harness />);
    const density = container.querySelector<HTMLElement>("[data-density-control]");
    expect(density).not.toBeNull();
    // Accessible name states the current density; Columns keeps its own name.
    expect(density?.getAttribute("aria-label")).toBe(
      "tableViews.density.current:tableViews.density.compact",
    );
    expect(within(container).getByRole("button", { name: "table.columns" })).not.toBe(density);
  });

  it("applies the saved per-user density to the table and the legacy device value as fallback", () => {
    window.localStorage.setItem("oms.table.r7-grid-spec.density", '"comfortable"');
    const { container } = render(<Harness />);
    expect(container.querySelector("table")?.getAttribute("data-density")).toBe("comfortable");
    // Adopted once into the per-user key.
    expect(window.localStorage.getItem("oms.table.u1.r7-grid-spec.density")).toBe("comfortable");
    expect(window.localStorage.getItem("oms.table.r7-grid-spec.density")).toBeNull();
  });

  it("does not leak one user's density to another", () => {
    window.localStorage.setItem("oms.table.u1.r7-grid-spec.density", "comfortable");
    userRef.current = { id: "u2" };
    const { container } = render(<Harness />);
    expect(container.querySelector("table")?.getAttribute("data-density")).toBe("compact");
  });
});
