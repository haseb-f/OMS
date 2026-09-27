import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/hooks/use-print-engine", () => ({ usePrintEngine: () => ({ printList: vi.fn() }) }));
vi.mock("@/providers/company-provider", () => ({ useCompany: () => ({ activeCompany: null }) }));
vi.mock("@/providers/user-context", () => ({ useUserContext: () => ({ user: null }) }));

import { EnterpriseDataTable } from "./enterprise-data-table";
import { TooltipProvider } from "@/components/ui/tooltip";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: "a", name: "Bravo", amount: 20 },
  { id: "b", name: "Alpha", amount: 5 },
  { id: "c", name: "Charlie", amount: 12 },
];

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorKey: "name", meta: { identity: true } },
  {
    id: "amount",
    accessorKey: "amount",
    meta: {
      type: "money",
      footer: ({ rows: all }) => String((all as Row[]).reduce((sum, row) => sum + row.amount, 0)),
    },
  },
];

function renderTable(tableId: string) {
  return render(
    <TooltipProvider>
      <EnterpriseDataTable tableId={tableId} columns={columns} data={rows} />
    </TooltipProvider>,
  );
}

function bodyNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tbody td[data-column-id="name"]')).map(
    (cell) => cell.textContent,
  );
}

afterEach(cleanup);

describe("EnterpriseDataTable layout", () => {
  it("sorts with one header click: ascending → descending → unsorted", () => {
    const { container } = renderTable("layout-spec-sort");
    // Re-query each time: the header re-renders after every sort change.
    const clickHeader = () => fireEvent.click(screen.getByRole("button", { name: "name" }));
    const ariaSort = () =>
      container.querySelector('th[data-column-id="name"]')!.getAttribute("aria-sort");

    clickHeader();
    expect(bodyNames(container)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(ariaSort()).toBe("ascending");

    clickHeader();
    expect(bodyNames(container)).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(ariaSort()).toBe("descending");

    clickHeader();
    expect(bodyNames(container)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(ariaSort()).toBeNull();
  });

  it("aligns money columns to the logical end in header, body and totals footer", () => {
    const { container } = renderTable("layout-spec-footer");
    const th = container.querySelector('th[data-column-id="amount"]')!;
    const td = container.querySelector('tbody td[data-column-id="amount"]')!;
    const foot = container.querySelector('tfoot td[data-column-id="amount"]')!;
    for (const cell of [th, td, foot]) expect(cell.className).toContain("text-end");
    expect(foot.textContent).toBe("37");
  });

  it("shows the range label in the pagination footer", () => {
    renderTable("layout-spec-range");
    expect(screen.getByText("table.rangeOf")).toBeTruthy();
  });
});
