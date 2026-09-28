import { beforeEach, describe, expect, it, vi } from "vitest";

const lists = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock("@/services/master-data-service", () => ({
  createMasterDataService: (path: string) => {
    const list = vi.fn();
    lists.set(path, list);
    return { list };
  },
}));

import { fetchAllCurrencies, fetchAllPaymentMethods } from "./use-reference-data";

/** A paged fake list endpoint holding `count` rows. */
const pagedRows = (count: number, row: (i: number) => Record<string, unknown>) => {
  const rows = Array.from({ length: count }, (_, i) => row(i));
  return ({ page, pageSize }: { page: number; pageSize: number }) =>
    Promise.resolve({
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
    });
};

describe("reference-data pickers load every row", () => {
  beforeEach(() => {
    for (const list of lists.values()) list.mockReset();
  });

  it("currencies page past the first 200 rows", async () => {
    const list = lists.get("/currencies")!;
    list.mockImplementation(pagedRows(450, (i) => ({ id: `c${i}`, code: `C${i}` })));
    const rows = await fetchAllCurrencies();
    expect(rows).toHaveLength(450);
    expect(rows.at(-1)).toMatchObject({ id: "c449" });
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls[1][0]).toMatchObject({ page: 2 });
  });

  it("payment methods page past 200 and still drop deleted rows", async () => {
    const list = lists.get("/payment-methods")!;
    list.mockImplementation(
      pagedRows(230, (i) => ({ id: `m${i}`, deletedAt: i === 210 ? "2026-01-01" : null })),
    );
    const rows = await fetchAllPaymentMethods();
    expect(rows).toHaveLength(229);
    expect(rows.some((row) => row.id === "m229")).toBe(true);
    expect(rows.some((row) => row.id === "m210")).toBe(false);
  });

  it("a short list is a single request", async () => {
    const list = lists.get("/currencies")!;
    list.mockImplementation(pagedRows(3, (i) => ({ id: `c${i}` })));
    expect(await fetchAllCurrencies()).toHaveLength(3);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
