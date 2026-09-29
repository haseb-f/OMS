import { describe, expect, it } from "vitest";
import {
  bulkSelectionCount,
  createEmptyBulkSelection,
  createMatchingSelectionSnapshot,
  matchingSelectionShortfall,
  resolveSelectionScope,
  selectionQuerySignature,
  selectionScopeMessageKey,
} from "./bulk-selection";

const page = ["o1", "o2", "o3"];
const ids347 = Array.from({ length: 347 }, (_, i) => `o${i + 1}`);
const Q = selectionQuerySignature({ status: ["PAID"] });
const complete = createMatchingSelectionSnapshot(Q, { ids: ids347, total: 347 });

describe("resolveSelectionScope", () => {
  it("is none when nothing is selected", () => {
    expect(resolveSelectionScope({ selectedIds: [], pageRowIds: page })).toBe("none");
  });

  it("is page when every selected row is on the current page, even if the whole page is selected", () => {
    expect(resolveSelectionScope({ selectedIds: ["o1", "o3"], pageRowIds: page })).toBe("page");
    expect(resolveSelectionScope({ selectedIds: page, pageRowIds: page })).toBe("page");
  });

  it("is acrossPages when a selected row is not on the current page", () => {
    expect(resolveSelectionScope({ selectedIds: ["o1", "o9"], pageRowIds: page })).toBe(
      "acrossPages",
    );
  });

  it("server mode: allMatching only when the selection equals a complete snapshot for the current query", () => {
    expect(
      resolveSelectionScope({
        selectedIds: ids347,
        pageRowIds: page,
        matchingSelection: complete,
        currentQuery: Q,
      }),
    ).toBe("allMatching");
  });

  it("never infers allMatching from a count that merely reaches the total", () => {
    // 347 selected ids, no snapshot (e.g. a stale selection) → not "all".
    expect(resolveSelectionScope({ selectedIds: ids347, pageRowIds: page })).toBe("acrossPages");
    // A different 347-id set than the snapshot → not "all".
    const other = ids347.map((id) => `x${id}`);
    expect(
      resolveSelectionScope({
        selectedIds: other,
        pageRowIds: page,
        matchingSelection: complete,
        currentQuery: Q,
      }),
    ).toBe("acrossPages");
  });

  it("drops to acrossPages once a row is unchecked from an all-matching selection", () => {
    expect(
      resolveSelectionScope({
        selectedIds: ids347.slice(1),
        pageRowIds: page,
        matchingSelection: complete,
        currentQuery: Q,
      }),
    ).toBe("acrossPages");
  });

  it("ignores a snapshot taken for another query", () => {
    expect(
      resolveSelectionScope({
        selectedIds: ids347,
        pageRowIds: page,
        matchingSelection: complete,
        currentQuery: selectionQuerySignature({ status: ["PENDING"] }),
      }),
    ).toBe("acrossPages");
  });

  it("a truncated or profitability-capped result is never allMatching", () => {
    const first10k = Array.from({ length: 10_000 }, (_, i) => `o${i}`);
    const truncated = createMatchingSelectionSnapshot(Q, { ids: first10k, total: 12_500 });
    expect(truncated.complete).toBe(false);
    expect(
      resolveSelectionScope({
        selectedIds: first10k,
        pageRowIds: page,
        matchingSelection: truncated,
        currentQuery: Q,
      }),
    ).toBe("acrossPages");

    const capped = createMatchingSelectionSnapshot(Q, {
      ids: ["o1", "o2"],
      total: 2,
      profitabilityFilterCapped: true,
    });
    expect(capped.complete).toBe(false);
    expect(
      resolveSelectionScope({
        selectedIds: ["o1", "o2"],
        pageRowIds: page,
        matchingSelection: capped,
        currentQuery: Q,
      }),
    ).toBe("page");
  });

  it("client mode: allMatching needs exactly the matching set (stale ids outside it do not count)", () => {
    const matchingIds = ["o1", "o2", "o3", "o4"];
    expect(resolveSelectionScope({ selectedIds: matchingIds, pageRowIds: page, matchingIds })).toBe(
      "allMatching",
    );
    // Same count, but one selected id no longer matches the filter.
    expect(
      resolveSelectionScope({
        selectedIds: ["o1", "o2", "o3", "stale"],
        pageRowIds: page,
        matchingIds,
      }),
    ).toBe("acrossPages");
    expect(resolveSelectionScope({ selectedIds: page, pageRowIds: page, matchingIds })).toBe(
      "page",
    );
  });
});

describe("matchingSelectionShortfall", () => {
  it("names why a select-all result is not the whole match set", () => {
    expect(matchingSelectionShortfall({ ids: ["a"], total: 1 })).toBeNull();
    expect(matchingSelectionShortfall({ ids: ["a"], total: 2 })).toBe("truncated");
    expect(
      matchingSelectionShortfall({ ids: ["a"], total: 1, profitabilityFilterCapped: true }),
    ).toBe("capped");
  });
});

describe("selectionScopeMessageKey", () => {
  it("maps every scope to its table.* summary key", () => {
    expect(selectionScopeMessageKey("page")).toBe("table.selectionScopePage");
    expect(selectionScopeMessageKey("acrossPages")).toBe("table.selectionScopeAcrossPages");
    expect(selectionScopeMessageKey("allMatching")).toBe("table.selectionScopeAllMatching");
  });
});

describe("selectionQuerySignature", () => {
  it("ignores key order, multi-select order and empty values", () => {
    const a = selectionQuerySignature({
      search: "",
      paymentStatus: ["PAID", "PENDING"],
      source: [],
      agentId: undefined,
      sortBy: "createdAt",
    });
    const b = selectionQuerySignature({
      sortBy: "createdAt",
      paymentStatus: ["PENDING", "PAID"],
      search: undefined,
    });
    expect(a).toBe(b);
  });

  it("changes when a filter, the search or the sort changes", () => {
    const base = { search: "ali", paymentStatus: ["PAID"], sortBy: "createdAt", sortOrder: "desc" };
    const signature = selectionQuerySignature(base);
    expect(selectionQuerySignature({ ...base, paymentStatus: ["PAID", "PENDING"] })).not.toBe(
      signature,
    );
    expect(selectionQuerySignature({ ...base, search: "alia" })).not.toBe(signature);
    expect(selectionQuerySignature({ ...base, sortOrder: "asc" })).not.toBe(signature);
  });

  it("serializes dates (date-range filters) instead of dropping them", () => {
    expect(selectionQuerySignature({ from: new Date("2026-09-01T00:00:00Z") })).not.toBe(
      selectionQuerySignature({ from: new Date("2026-09-02T00:00:00Z") }),
    );
    expect(selectionQuerySignature({ from: new Date("2026-09-01T00:00:00Z") })).not.toBe(
      selectionQuerySignature({}),
    );
  });

  it("keeps meaningful false/0 values and trims search whitespace", () => {
    expect(selectionQuerySignature({ includeArchived: false })).not.toBe(
      selectionQuerySignature({}),
    );
    expect(selectionQuerySignature({ search: " ali " })).toBe(
      selectionQuerySignature({ search: "ali" }),
    );
  });
});

describe("bulkSelectionCount", () => {
  it("counts filter-mode selections as total minus exclusions", () => {
    const selection = {
      ...createEmptyBulkSelection(),
      mode: "filter" as const,
      filterMatchCount: 347,
      excludeIds: ["o1", "o2"],
    };
    expect(bulkSelectionCount(selection)).toBe(345);
  });
});
