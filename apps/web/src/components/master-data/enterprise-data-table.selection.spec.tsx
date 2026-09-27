import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string) => key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/hooks/use-print-engine", () => ({ usePrintEngine: () => ({ printList: vi.fn() }) }));
vi.mock("@/providers/company-provider", () => ({ useCompany: () => ({ activeCompany: null }) }));
vi.mock("@/providers/user-context", () => ({ useUserContext: () => ({ user: null }) }));

import { EnterpriseDataTable } from "./enterprise-data-table";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * FIX-QA D1 — the injected `select` column's per-row checkbox must render
 * (desktop table AND the narrow-container card list). Before the fix only
 * the header select-all rendered; every row's checkbox cell was empty
 * because the injected column fell through to `cell.renderValue()`.
 */
interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "claim-a", name: "Alpha" },
  { id: "claim-b", name: "Bravo" },
  { id: "claim-c", name: "Charlie" },
];

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorKey: "name", meta: { identity: true } },
];

const selectionSpy = vi.fn<(next: RowSelectionState) => void>();
const lastSelection = () => selectionSpy.mock.lastCall?.[0];

function Harness() {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const handleChange = (next: RowSelectionState) => {
    selectionSpy(next);
    setSelection(next);
  };
  return (
    <TooltipProvider>
      <EnterpriseDataTable
        tableId="fixqa-selection-spec"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        rowSelection={selection}
        onRowSelectionChange={handleChange}
      />
    </TooltipProvider>
  );
}

function desktopRowCheckboxes(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('td[data-column-id="select"] [role="checkbox"]'),
  );
}

describe("EnterpriseDataTable row selection column", () => {
  it("renders one checkbox per row on desktop and toggles only the clicked row", () => {
    const { container } = render(<Harness />);
    const boxes = desktopRowCheckboxes(container);
    expect(boxes).toHaveLength(rows.length);

    fireEvent.click(boxes[1]);
    expect(lastSelection()).toEqual({ "claim-b": true });
    expect(desktopRowCheckboxes(container)[1].getAttribute("aria-checked")).toBe("true");
    expect(desktopRowCheckboxes(container)[0].getAttribute("aria-checked")).toBe("false");
  });

  it("renders the per-row checkbox in the mobile card list too", () => {
    const { container } = render(<Harness />);
    const all = within(container).getAllByRole("checkbox", { name: "table.selectRow" });
    // Desktop table + mobile card list each render one per row.
    expect(all).toHaveLength(rows.length * 2);
    const desktop = new Set(desktopRowCheckboxes(container));
    const mobile = all.filter((el) => !desktop.has(el));
    expect(mobile).toHaveLength(rows.length);
    fireEvent.click(mobile[2]);
    expect(lastSelection()).toEqual({ "claim-c": true });
  });
});
