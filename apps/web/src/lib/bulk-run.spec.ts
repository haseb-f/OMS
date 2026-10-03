import { describe, expect, it } from "vitest";
import { bulkOutcomeFromIds, runBulkSequential, summarizeBulkOutcome } from "./bulk-run";

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

describe("summarizeBulkOutcome (shared bulk partial-failure summary)", () => {
  const success = (count: number) => `${count} archived`;

  it("all succeeded → the caller's success text", () => {
    expect(summarizeBulkOutcome({ succeeded: 4, failed: [] }, success, "en")).toEqual({
      tone: "success",
      title: "4 archived",
    });
  });

  it("partial → 'x succeeded, y failed' with each reason", () => {
    const summary = summarizeBulkOutcome(
      { succeeded: 3, failed: [{ label: "SO-7", message: "Only drafts can be archived" }] },
      success,
      "en",
    );
    expect(summary.tone).toBe("partial");
    expect(summary.title).toBe("3 succeeded, 1 failed");
    expect(summary.description).toBe("SO-7: Only drafts can be archived");
  });

  it("all failed → says nothing changed, lists the first reasons and the rest as a count", () => {
    const failed = ["A", "B", "C", "D", "E"].map((label) => ({ label, message: "Locked" }));
    const summary = summarizeBulkOutcome({ succeeded: 0, failed }, success, "en");
    expect(summary.tone).toBe("failed");
    expect(summary.title).toBe("5 failed — nothing was changed");
    expect(summary.description?.split("\n")).toEqual([
      "A: Locked",
      "B: Locked",
      "C: Locked",
      "…and 2 more",
    ]);
  });

  it("is localized (Arabic)", () => {
    const summary = summarizeBulkOutcome(
      { succeeded: 2, failed: [{ label: "", message: "x" }] },
      success,
      "ar",
    );
    expect(summary.title).toBe("نجح 2، وتعذّر 1");
    expect(summary.description).toBe("x");
  });

  it("labels failed server ids with the record number when known", () => {
    expect(
      bulkOutcomeFromIds(
        {
          succeeded: ["a"],
          failed: [
            { id: "b", message: "no" },
            { id: "c", message: "no" },
          ],
        },
        (id) => (id === "b" ? "JV-2" : null),
      ),
    ).toEqual({
      succeeded: 1,
      failed: [
        { label: "JV-2", message: "no" },
        { label: "c", message: "no" },
      ],
    });
  });
});

describe("summarizeBulkOutcome — empty run", () => {
  it("0 succeeded + 0 failed is a neutral 'nothing to apply', never success", () => {
    const summary = summarizeBulkOutcome({ succeeded: 0, failed: [] }, (n) => `${n} done`, "en");
    expect(summary.tone).toBe("empty");
    expect(summary.title).toBe("Nothing to apply — no selected record was eligible.");
  });
});
