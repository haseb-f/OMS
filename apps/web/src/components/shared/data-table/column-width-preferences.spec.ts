import { describe, expect, it } from "vitest";
import {
  columnWidthsStorageKey,
  legacyColumnWidthsStorageKey,
  readColumnWidths,
  writeColumnWidths,
} from "./column-width-preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("column width preferences (per user, per table)", () => {
  it("keys widths by user and table", () => {
    expect(columnWidthsStorageKey("u1", "store-orders")).toBe(
      "oms.table.u1.store-orders.columnWidths",
    );
    expect(legacyColumnWidthsStorageKey("store-orders")).toBe(
      "oms.table.store-orders.columnWidths",
    );
  });

  it("adopts the legacy device-wide widths once, then removes them", () => {
    const storage = memoryStorage({
      "oms.table.store-orders.columnWidths": JSON.stringify({ customer: 240 }),
    });
    expect(readColumnWidths(storage, "u1", "store-orders")).toEqual({ customer: 240 });
    expect(storage.data.get("oms.table.u1.store-orders.columnWidths")).toBe(
      JSON.stringify({ customer: 240 }),
    );
    expect(storage.data.has("oms.table.store-orders.columnWidths")).toBe(false);
    // The next user on this device starts from the defaults.
    expect(readColumnWidths(storage, "u2", "store-orders")).toEqual({});
  });

  it("prefers the user's own widths over any legacy value", () => {
    const storage = memoryStorage({
      "oms.table.u1.t.columnWidths": JSON.stringify({ a: 100 }),
      "oms.table.t.columnWidths": JSON.stringify({ a: 300 }),
    });
    expect(readColumnWidths(storage, "u1", "t")).toEqual({ a: 100 });
    expect(storage.data.has("oms.table.t.columnWidths")).toBe(true);
  });

  it("ignores corrupt or invalid entries", () => {
    const storage = memoryStorage({
      "oms.table.u1.t.columnWidths": "{not json",
      "oms.table.t.columnWidths": JSON.stringify({ ok: 120, bad: "wide", neg: -4 }),
    });
    expect(readColumnWidths(storage, "u1", "t")).toEqual({ ok: 120 });
  });

  it("removes the key when every width is reset", () => {
    const storage = memoryStorage();
    writeColumnWidths(storage, "u1", "t", { a: 200 });
    expect(storage.data.get("oms.table.u1.t.columnWidths")).toBe(JSON.stringify({ a: 200 }));
    writeColumnWidths(storage, "u1", "t", {});
    expect(storage.data.has("oms.table.u1.t.columnWidths")).toBe(false);
  });

  it("treats inaccessible storage as no saved widths", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readColumnWidths(throwing, "u1", "t")).toEqual({});
  });
});
