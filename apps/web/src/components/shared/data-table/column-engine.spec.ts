import { describe, expect, it } from "vitest";
import {
  fitColumnWidths,
  planColumnWidths,
  inferColumnType,
  isNumericColumnType,
  isTabularColumnType,
  resolveColumnLayout,
} from "./column-engine";
import { normalizeTablePageSize } from "./data-table-pagination";

describe("column engine — explicit meta.type", () => {
  it("explicit type wins over id inference and drives numeric alignment", () => {
    // "members" infers to default; declared as a number it aligns to the end.
    expect(resolveColumnLayout("members", undefined).align).toBe("start");
    const layout = resolveColumnLayout("members", { type: "number" });
    expect(layout.type).toBe("number");
    expect(layout.align).toBe("end");
  });

  it.each(["money", "number", "percent", "quantity"] as const)("%s is numeric + end", (type) => {
    const layout = resolveColumnLayout("anything", { type });
    expect(isNumericColumnType(layout.type)).toBe(true);
    expect(layout.align).toBe("end");
  });

  it("dates and references are tabular but start-aligned", () => {
    for (const type of ["date", "reference"] as const) {
      const layout = resolveColumnLayout("x", { type });
      expect(isTabularColumnType(layout.type)).toBe(true);
      expect(isNumericColumnType(layout.type)).toBe(false);
      expect(layout.align).toBe("start");
    }
  });

  it("fixed-width numeric columns still align to the end", () => {
    expect(resolveColumnLayout("x", { fixedWidth: 90, type: "money" }).align).toBe("end");
  });
});

describe("column engine — legacy id inference fallback", () => {
  it.each([
    ["account", "name"],
    ["accountingClass", "name"],
    ["defaultAccountingTreatment", "name"],
    ["country", "name"],
    ["costCenter", "name"],
    ["totalRows", "number"],
    ["itemsCount", "number"],
    ["discount", "money"],
    ["creditLimit", "money"],
    ["grandTotal", "money"],
    ["onHand", "number"],
    ["invoiceNumber", "code"],
    ["createdAt", "date"],
  ])("%s → %s", (id, type) => {
    expect(inferColumnType(id)).toBe(type);
  });
});

describe("page sizes", () => {
  it("keeps offered sizes and maps legacy ones onto 20/50/100", () => {
    expect(normalizeTablePageSize(20)).toBe(20);
    expect(normalizeTablePageSize(100)).toBe(100);
    expect(normalizeTablePageSize(10)).toBe(20);
    expect(normalizeTablePageSize(30)).toBe(50);
    expect(normalizeTablePageSize(500)).toBe(20);
  });
});

describe("column engine — identity and importance", () => {
  it("an identity column gets a floor wide enough for a full reference and never hides", () => {
    const layout = resolveColumnLayout("leadNumber", { type: "code", identity: true });
    expect(layout.minWidth).toBeGreaterThanOrEqual(164);
    expect(layout.maxWidth).toBeGreaterThanOrEqual(220);
    expect(layout.importance).toBe("critical");
    expect(layout.grow).toBeGreaterThanOrEqual(1.5);
  });

  it("an explicit minWidth/importance still wins over the identity defaults' lower bounds", () => {
    const layout = resolveColumnLayout("order", {
      type: "code",
      identity: true,
      importance: "high",
      minWidth: 200,
    });
    expect(layout.minWidth).toBe(200);
    expect(layout.importance).toBe("high");
  });

  it("low-importance columns take a smaller share of spare width unless grow is declared", () => {
    const high = resolveColumnLayout("customerName", { type: "name" });
    const low = resolveColumnLayout("source", { type: "name", importance: "low" });
    expect(low.grow).toBeLessThan(high.grow);
    expect(resolveColumnLayout("source", { type: "name", importance: "low", grow: 3 }).grow).toBe(
      3,
    );
  });
});

describe("column engine — fitColumnWidths", () => {
  const columns = [
    resolveColumnLayout("select", undefined),
    resolveColumnLayout("leadNumber", { type: "code", identity: true }),
    resolveColumnLayout("customerName", { type: "name" }),
    resolveColumnLayout("source", { type: "name", importance: "low" }),
    resolveColumnLayout("createdAt", { type: "date" }),
    resolveColumnLayout("__actions", undefined),
  ];
  const sum = (widths: Record<string, number>) =>
    Object.values(widths).reduce((total, width) => total + width, 0);

  it("fills the available width and keeps every floor when there is room", () => {
    const widths = fitColumnWidths(columns, 1000);
    expect(sum(widths)).toBeGreaterThan(995);
    expect(sum(widths)).toBeLessThanOrEqual(1000);
    expect(widths.select).toBe(60);
    expect(widths.__actions).toBe(88);
    expect(widths.leadNumber).toBeGreaterThanOrEqual(164);
  });

  it("shrinks low-importance columns first when space is tight, never the identity", () => {
    // Floors: 60 + 164 + 160 + 160 + 110 + 88 = 742.
    const widths = fitColumnWidths(columns, 640);
    expect(widths.leadNumber).toBe(164);
    // The low column gives way first (down to its floor), then names.
    expect(widths.source).toBe(72);
    expect(widths.customerName).toBeGreaterThan(140);
    expect(widths.customerName).toBeLessThan(160);
  });

  it("keeps manually resized widths exactly", () => {
    const widths = fitColumnWidths(columns, 1000, { customerName: 300 });
    expect(widths.customerName).toBe(300);
  });
});

describe("column engine — planColumnWidths", () => {
  const columns = [
    resolveColumnLayout("select", undefined),
    resolveColumnLayout("leadNumber", { type: "code", identity: true }),
    resolveColumnLayout("customerName", { type: "name" }),
    resolveColumnLayout("country", { type: "name", importance: "low" }),
    resolveColumnLayout("classification", { type: "status", importance: "medium" }),
    resolveColumnLayout("createdAt", { type: "date" }),
    resolveColumnLayout("__actions", undefined),
  ];

  it("hides low, then medium columns before it lets the table overflow", () => {
    const floors = { country: 120, classification: 130, customerName: 110 };
    // Rigid: 60 + 164 + 110 + 110 + 88 = 532 (+120 country, +130 classification).
    expect(planColumnWidths(columns, 800, {}, floors).hidden).toEqual([]);
    expect(planColumnWidths(columns, 700, {}, floors).hidden).toEqual(["country"]);
    const tight = planColumnWidths(columns, 560, {}, floors);
    expect(tight.hidden).toEqual(["country", "classification"]);
    expect(tight.overflow).toBe(false);
    const tooTight = planColumnWidths(columns, 400, {}, floors);
    expect(tooTight.overflow).toBe(true);
    expect(tooTight.widths.__actions).toBe(88);
    expect(tooTight.widths.leadNumber).toBe(164);
  });

  it("floors a column at its measured header and an identity at its content", () => {
    const plan = planColumnWidths(columns, 2000, {}, { createdAt: 150, leadNumber: 230 });
    expect(plan.widths.createdAt).toBeGreaterThanOrEqual(150);
    expect(plan.widths.leadNumber).toBeGreaterThanOrEqual(230);
  });
});
