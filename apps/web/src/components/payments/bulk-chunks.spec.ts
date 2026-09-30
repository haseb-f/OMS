import { describe, expect, it, vi } from "vitest";
import { runInChunks } from "./bulk-chunks";
import { rejectBlockReason, decisionBlockReason } from "./payment-eligibility";

const options = {
  idOf: (id: string) => id,
  requestFailed: (message: string) => `failed: ${message}`,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "?"),
};

describe("runInChunks", () => {
  it("sends bounded requests in order and merges per-item results", async () => {
    const ids = Array.from({ length: 7 }, (_, index) => `p${index}`);
    const sent: string[][] = [];
    const progress: [number, number][] = [];
    const result = await runInChunks(
      ids,
      3,
      (chunk) => {
        sent.push(chunk);
        return Promise.resolve({
          succeeded: chunk.filter((id) => id !== "p4"),
          failed: chunk
            .filter((id) => id === "p4")
            .map((id) => ({ id, code: "CONFLICT", message: "matched" })),
        });
      },
      { ...options, onProgress: (done, total) => progress.push([done, total]) },
    );
    expect(sent).toEqual([["p0", "p1", "p2"], ["p3", "p4", "p5"], ["p6"]]);
    expect(result.succeeded).toEqual(["p0", "p1", "p2", "p3", "p5", "p6"]);
    expect(result.failed).toEqual([{ id: "p4", code: "CONFLICT", message: "matched" }]);
    expect(progress).toEqual([
      [0, 7],
      [3, 7],
      [6, 7],
      [7, 7],
    ]);
  });

  it("marks every id of a failed request as failed and keeps going", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ succeeded: ["c"], failed: [] });
    const result = await runInChunks(["a", "b", "c"], 2, send, options);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(["c"]);
    expect(result.failed).toEqual([
      { id: "a", code: "REQUEST_FAILED", message: "failed: timeout" },
      { id: "b", code: "REQUEST_FAILED", message: "failed: timeout" },
    ]);
  });
});

describe("payment eligibility (mirrors the server)", () => {
  it("refuses reject while statement matches stand, for agent money and for posted payments", () => {
    expect(rejectBlockReason({ status: "PENDING" })).toBeNull();
    expect(rejectBlockReason({ status: "MATCHED", activeMatchCount: 1 })).toBe(
      "paymentVocabulary.reason.activeMatches",
    );
    expect(rejectBlockReason({ status: "PENDING", destinationOwnership: "AGENT" })).toBe(
      "paymentVocabulary.reason.agentCollection",
    );
    expect(rejectBlockReason({ status: "VERIFIED", settlementStatus: "SETTLED" })).toBe(
      "paymentVocabulary.reason.settled",
    );
    expect(decisionBlockReason({ status: "REJECTED" })).toBe("paymentVocabulary.reason.notOpen");
  });
});
