import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/crm/leads",
}));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { leadColumns } from "@/config/crm/lead-columns";
import { LeadGridCard } from "@/components/crm/lead-grid-card";
import type { LeadRow } from "@/services/leads-service";

afterEach(cleanup);

/**
 * R17 §1 — the unopened-lead indicator. The definition (`isNewToViewer`: the
 * per-viewer `viewedByMe`, open leads only) is unchanged; this guards the
 * presentation: one info badge with an icon AND the words «لم يُفتح» /
 * "Unopened" in the table row (+ the row's start-edge accent) and in the grid
 * card header; an opened lead shows nothing.
 */
const SRC = resolve(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8").replace(/\r\n/g, "\n");

function lead(id: string, viewedByMe: boolean | undefined, code = "NEW"): LeadRow {
  return {
    id,
    leadNumber: `LD-${id}`,
    customerName: `Customer ${id}`,
    mobileNumber: "+966500000000",
    salesEmployeeId: "u1",
    salesEmployee: null,
    status: { id: "s", code, name: code, color: "info" },
    followUpOutcome: null,
    nextFollowUpAt: null,
    storeOrder: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    viewedByMe,
  } as unknown as LeadRow;
}

function LeadTable({ rows }: { rows: LeadRow[] }) {
  const table = useReactTable({
    data: rows,
    columns: leadColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });
  return (
    <Table>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} data-row-id={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

describe("unopened lead — table", () => {
  it("shows the info badge with icon + text on an unopened row only", () => {
    const { container } = render(
      <LeadTable rows={[lead("a", false), lead("b", true), lead("c", undefined)]} />,
    );
    const markers = container.querySelectorAll("[data-new-to-you]");
    expect(markers).toHaveLength(1);
    const marker = markers[0];
    expect(marker.closest('[data-row-id="a"]')).not.toBeNull();
    // Semantic info badge, with a visible label and an icon (never colour alone).
    expect(marker.getAttribute("data-slot")).toBe("badge");
    expect(marker.getAttribute("data-variant")).toBe("info");
    expect(marker.textContent).toBe("tableViews.card.newToYou");
    expect(marker.querySelector("svg")).not.toBeNull();
    expect(marker.querySelector(".sr-only")).toBeNull();
    // Opened (true) and unknown (undefined) rows carry no marker.
    expect(container.querySelector('[data-row-id="b"] [data-new-to-you]')).toBeNull();
    expect(container.querySelector('[data-row-id="c"] [data-new-to-you]')).toBeNull();
  });

  it("never marks a converted or closed lead even when unopened", () => {
    const { container } = render(
      <LeadTable rows={[lead("x", false, "CONVERTED"), lead("y", false, "LOST")]} />,
    );
    expect(container.querySelector("[data-new-to-you]")).toBeNull();
  });

  it("the row recipe draws the start-edge accent from the marker, mirrored in RTL", () => {
    const recipes = read("theme/recipes.css");
    expect(recipes).toMatch(
      /\[data-slot="table-row"\]:has\(\[data-new-to-you\]\) > td:first-child,[\s\S]*?box-shadow: inset var\(--row-unopened-accent-width\) 0 0 var\(--row-unopened-accent\);/,
    );
    expect(recipes).toMatch(
      /\[dir="rtl"\] \[data-slot="table-row"\]:has\(\[data-new-to-you\]\) > td:first-child,[\s\S]*?inset calc\(var\(--row-unopened-accent-width\) \* -1\)/,
    );
    // The selection edge is declared after it, so a selected row keeps its own marker.
    expect(recipes.indexOf(":has([data-new-to-you])")).toBeLessThan(
      recipes.indexOf('[data-slot="table-row"][data-state="selected"] > td:first-child {'),
    );
    const tokens = read("theme/tokens.css");
    expect(tokens).toMatch(/--row-unopened-accent: var\(--info-soft-foreground\);/);
  });

  it("the words are «لم يُفتح» / Unopened", () => {
    expect(read("i18n/messages/modules/table-views.ar.ts")).toContain('newToYou: "لم يُفتح"');
    expect(read("i18n/messages/modules/table-views.en.ts")).toContain('newToYou: "Unopened"');
  });
});

describe("unopened lead — grid", () => {
  const common = { selected: false, onToggleSelected: () => {}, href: "/crm/leads/a" };

  it("shows the same badge in the card header, outside the record link", () => {
    const { container } = render(
      <LeadGridCard {...common} lead={lead("a", false)} canAssign={false} />,
    );
    const marker = container.querySelector("[data-new-to-you]")!;
    expect(marker).not.toBeNull();
    expect(marker.getAttribute("data-variant")).toBe("info");
    expect(marker.querySelector("svg")).not.toBeNull();
    const header = container.querySelector("article")!.firstElementChild!;
    expect(header.contains(marker)).toBe(true);
    expect(marker.closest("[data-record-link]")).toBeNull();
    expect(screen.getByText("tableViews.card.newToYou")).toBeTruthy();
  });

  it("an opened lead's card shows no marker", () => {
    const { container } = render(
      <LeadGridCard {...common} lead={lead("b", true)} canAssign={false} />,
    );
    expect(container.querySelector("[data-new-to-you]")).toBeNull();
    expect(container.querySelector("[data-record-marker]")).toBeNull();
  });
});
