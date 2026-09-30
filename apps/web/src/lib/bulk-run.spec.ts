import { describe, expect, it } from "vitest";
import { runBulkSequential } from "./bulk-run";

describe("runBulkSequential", () => {
  it("runs every item once, in order, and collects failures without throwing", async () => {
    const calls: string[] = [];
    const result = await runBulkSequential(["a", "b", "c"], async (id) => {
      calls.push(id);
      if (id === "b") throw new Error("boom");
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.succeeded).toEqual(["a", "c"]);
    expect(result.failed.map((entry) => entry.item)).toEqual(["b"]);
    // A raw JS error message is never shown — the localized fallback is.
    expect(result.failed[0].message).not.toBe("boom");
  });

  it("returns empty results for an empty selection", async () => {
    const result = await runBulkSequential([], async () => undefined);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});
