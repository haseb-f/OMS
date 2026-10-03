import { describe, expect, it } from "vitest";
import {
  legacyDensityStorageKey,
  readDensityPreference,
  readViewPreference,
  tablePreferenceKey,
  writeTablePreference,
} from "./table-preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("table density preference (per user, per table)", () => {
  it("keys by user and table", () => {
    expect(tablePreferenceKey("u1", "crm-leads", "density")).toBe("oms.table.u1.crm-leads.density");
    expect(legacyDensityStorageKey("crm-leads")).toBe("oms.table.crm-leads.density");
  });

  it("persists a choice per user and per table independently", () => {
    const storage = memoryStorage();
    writeTablePreference(storage, "u1", "crm-leads", "density", "comfortable");
    expect(readDensityPreference(storage, "u1", "crm-leads")).toBe("comfortable");
    expect(readDensityPreference(storage, "u2", "crm-leads")).toBeNull();
    expect(readDensityPreference(storage, "u1", "store-orders")).toBeNull();
  });

  it("adopts the legacy device-wide (JSON-encoded) density once, then removes it", () => {
    const storage = memoryStorage({ "oms.table.crm-leads.density": '"comfortable"' });
    expect(readDensityPreference(storage, "u1", "crm-leads")).toBe("comfortable");
    expect(storage.data.get("oms.table.u1.crm-leads.density")).toBe("comfortable");
    expect(storage.data.has("oms.table.crm-leads.density")).toBe(false);
    expect(readDensityPreference(storage, "u2", "crm-leads")).toBeNull();
  });

  it("prefers the per-user value over the legacy one", () => {
    const storage = memoryStorage({
      "oms.table.u1.crm-leads.density": "compact",
      "oms.table.crm-leads.density": '"comfortable"',
    });
    expect(readDensityPreference(storage, "u1", "crm-leads")).toBe("compact");
  });

  it("ignores corrupt or unknown values", () => {
    const storage = memoryStorage({
      "oms.table.u1.crm-leads.density": "{not json",
      "oms.table.u1.store-orders.density": "huge",
    });
    expect(readDensityPreference(storage, "u1", "crm-leads")).toBeNull();
    expect(readDensityPreference(storage, "u1", "store-orders")).toBeNull();
  });

  it("reads as nothing saved when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    expect(readDensityPreference(broken, "u1", "t")).toBeNull();
    expect(readViewPreference(broken, "u1", "t")).toBeNull();
    expect(() => writeTablePreference(broken, "u1", "t", "view", "grid")).not.toThrow();
  });
});

describe("table view preference (per user, per table)", () => {
  it("persists table/grid per user and per table", () => {
    const storage = memoryStorage();
    writeTablePreference(storage, "u1", "store-orders", "view", "grid");
    expect(readViewPreference(storage, "u1", "store-orders")).toBe("grid");
    expect(readViewPreference(storage, "u2", "store-orders")).toBeNull();
    expect(readViewPreference(storage, "u1", "crm-leads")).toBeNull();
  });

  it("rejects values outside the closed set", () => {
    const storage = memoryStorage({ "oms.table.u1.store-orders.view": "kanban" });
    expect(readViewPreference(storage, "u1", "store-orders")).toBeNull();
  });
});
