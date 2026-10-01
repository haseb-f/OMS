import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PrintTable } from "@/components/print/print-table";
import { printColumnFormat, toPrintColumn } from "./print-columns";

describe("print column widths (derived from type, never from the screen)", () => {
  it("gives compact facts a narrow fixed width on one line", () => {
    expect(printColumnFormat("date")).toEqual({ width: "24mm", nowrap: true });
    expect(printColumnFormat("reference")).toEqual({ width: "30mm", nowrap: true });
    expect(printColumnFormat("money")).toEqual({ width: "30mm", align: "end", nowrap: true });
  });

  it("leaves text columns flexible", () => {
    expect(printColumnFormat("name")).toEqual({});
    expect(printColumnFormat("description")).toEqual({});
    expect(printColumnFormat(undefined)).toEqual({});
  });

  it("builds a print column from the declared type, inferring it from the id otherwise", () => {
    expect(toPrintColumn({ id: "orderDate", meta: { type: "date" } }, "Date")).toEqual({
      key: "orderDate",
      label: "Date",
      width: "24mm",
      nowrap: true,
    });
    expect(toPrintColumn({ id: "customerName", meta: { type: "name" } }, "Customer")).toEqual({
      key: "customerName",
      label: "Customer",
    });
    // An end-aligned column keeps its alignment on paper.
    expect(toPrintColumn({ id: "total", meta: { type: "money" } }, "Total").align).toBe("end");
  });

  it("the list print table honours the widths (fixed columns sized, text unsized)", () => {
    const columns = [
      toPrintColumn({ id: "ref", meta: { type: "reference" } }, "Ref"),
      toPrintColumn({ id: "customer", meta: { type: "name" } }, "Customer"),
      toPrintColumn({ id: "total", meta: { type: "money" } }, "Total"),
    ];
    const { container } = render(
      <PrintTable columns={columns} rows={[{ ref: "SO-1", customer: "Acme", total: "10.00" }]} />,
    );
    const cols = Array.from(container.querySelectorAll("col"));
    expect(cols.map((col) => col.style.width)).toEqual(["30mm", "", "30mm"]);
    const cells = Array.from(container.querySelectorAll("tbody td"));
    expect(cells[0].getAttribute("data-wrap")).toBe("nowrap");
    expect(cells[2].getAttribute("data-align")).toBe("end");
  });
});
