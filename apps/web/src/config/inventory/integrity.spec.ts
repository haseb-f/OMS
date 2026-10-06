import { describe, expect, it } from "vitest";
import { INTEGRITY_STATUS_TONE, humanizeMetricKey, integrityExportFileName } from "./integrity";

describe("inventory integrity config", () => {
  it("maps status to its meaning colour: pass green, review amber, fail red", () => {
    expect(INTEGRITY_STATUS_TONE).toEqual({
      PASS: "success",
      WARN: "warning",
      FAIL: "destructive",
    });
  });

  it("humanizes metric keys", () => {
    expect(humanizeMetricKey("subledgerValue")).toBe("Subledger value");
    expect(humanizeMetricKey("agentOwnedUnitsExcluded")).toBe("Agent owned units excluded");
    expect(humanizeMetricKey("movements")).toBe("Movements");
  });

  it("builds a file-system safe export name", () => {
    expect(integrityExportFileName("2026-10-06T10:15:00.123Z")).toBe(
      "inventory-integrity-2026-10-06T10-15-00.json",
    );
  });
});
