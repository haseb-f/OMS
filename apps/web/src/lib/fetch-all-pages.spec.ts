import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "./fetch-all-pages";

function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => i);
  return vi.fn(async (page: number, pageSize: number) => ({
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total,
  }));
}

describe("fetchAllPages", () => {
  it("pages at 200 until the total is reached", async () => {
    const fetchPage = source(450);
    const result = await fetchAllPages(fetchPage);
    expect(fetchPage.mock.calls).toEqual([
      [1, 200],
      [2, 200],
      [3, 200],
    ]);
    expect(result.rows).toHaveLength(450);
    expect(result.rows[449]).toBe(449);
    expect(result.total).toBe(450);
  });

  it("makes one request for an empty or single-page list", async () => {
    const empty = source(0);
    expect(await fetchAllPages(empty)).toEqual({ rows: [], total: 0 });
    expect(empty).toHaveBeenCalledTimes(1);
    const exact = source(200);
    expect((await fetchAllPages(exact)).rows).toHaveLength(200);
    expect(exact).toHaveBeenCalledTimes(1);
  });

  it("caps at 5000 rows and reports the full total", async () => {
    const fetchPage = source(12_345);
    const result = await fetchAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(25);
    expect(result.rows).toHaveLength(5000);
    expect(result.total).toBe(12_345);
  });

  it("stops on a short page even when the total is stale", async () => {
    const fetchPage = vi.fn(async (page: number) => ({
      items: page === 1 ? [1, 2, 3] : [],
      total: 999,
    }));
    const result = await fetchAllPages(fetchPage, { pageSize: 10 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([1, 2, 3]);
  });

  it("propagates a request failure", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(fetchAllPages(fetchPage)).rejects.toThrow("boom");
  });
});
