import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPrintJob,
  JOB_TTL_MS,
  MAX_STORED_JOBS,
  PrintJobStorageError,
  readPrintJob,
} from "./print-bridge";

const jobKeys = () => Object.keys(localStorage).filter((key) => key.startsWith("oms.print-job."));

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("print bridge", () => {
  it("stores a job the print tab can read back", () => {
    const id = createPrintJob({ title: "x" });
    expect(readPrintJob<{ title: string }>(id)).toEqual({ title: "x" });
  });

  it("drops expired jobs and keeps only the newest few before writing", () => {
    const now = 1_000_000_000;
    localStorage.setItem(
      "oms.print-job.old",
      JSON.stringify({ createdAt: now - JOB_TTL_MS - 1, payload: 1 }),
    );
    localStorage.setItem("oms.print-job.bad", "{not json");
    localStorage.setItem("unrelated", "kept");
    const ids = Array.from({ length: MAX_STORED_JOBS + 2 }, (_, i) =>
      createPrintJob({ i }, now + i),
    );
    expect(jobKeys()).toHaveLength(MAX_STORED_JOBS);
    expect(localStorage.getItem("oms.print-job.old")).toBeNull();
    expect(localStorage.getItem("oms.print-job.bad")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
    // The newest job is always kept.
    expect(readPrintJob(ids[ids.length - 1], now + ids.length)).toEqual({ i: ids.length - 1 });
  });

  it("an expired job reads as missing", () => {
    const id = createPrintJob({ a: 1 }, 0);
    expect(readPrintJob(id, JOB_TTL_MS + 1)).toBeNull();
  });

  it("on a quota error, clears the other jobs and retries once", () => {
    const earlier = createPrintJob({ big: true });
    const original = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      calls += 1;
      if (calls === 1) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    });
    const id = createPrintJob({ next: true });
    expect(readPrintJob(id)).toEqual({ next: true });
    expect(readPrintJob(earlier)).toBeNull();
  });

  it("throws PrintJobStorageError when storage still refuses the job", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => createPrintJob({ x: 1 })).toThrow(PrintJobStorageError);
  });
});
