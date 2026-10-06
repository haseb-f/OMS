import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIMILAR_NAME_DEBOUNCE_MS,
  similarNameQuery,
  useSimilarProductNames,
} from "./use-similar-product-names";

const similarNames = vi.fn();
vi.mock("@/services/products-service", () => ({
  productsService: { similarNames: (...args: unknown[]) => similarNames(...args) },
}));

const match = {
  id: "p-1",
  sku: "PRD-000001",
  name: "قلم جاف",
  displayName: "قلم جاف",
  categoryName: "أدوات",
  status: "ACTIVE",
  match: "CONTAINS",
};

/** Lets the debounce timer and the resolved promise settle. */
async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("similarNameQuery", () => {
  it("looks up only names of at least 3 characters, trimmed", () => {
    expect(similarNameQuery("  قل ")).toBeNull();
    expect(similarNameQuery("  قلم ")).toBe("قلم");
    expect(similarNameQuery("ab")).toBeNull();
    expect(similarNameQuery("  abc  ")).toBe("abc");
    expect(similarNameQuery("")).toBeNull();
  });
});

describe("useSimilarProductNames", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    similarNames.mockReset();
    similarNames.mockResolvedValue({ items: [match] });
  });
  afterEach(() => vi.useRealTimers());

  it("waits for a typing pause, then asks once with the final text", async () => {
    const { result, rerender } = renderHook(({ name }) => useSimilarProductNames({ name }), {
      initialProps: { name: "" },
    });
    rerender({ name: "قلم" });
    rerender({ name: "قلم ج" });
    rerender({ name: "قلم جاف" });
    expect(similarNames).not.toHaveBeenCalled();

    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(similarNames).toHaveBeenCalledTimes(1);
    expect(similarNames).toHaveBeenCalledWith({
      name: "قلم جاف",
      excludeId: undefined,
      categoryId: undefined,
    });
    expect(result.current).toEqual([match]);
  });

  it("passes the edited product and category so a product is never its own look-alike", async () => {
    renderHook(() =>
      useSimilarProductNames({ name: "قلم جاف", excludeId: "me", categoryId: "cat-1" }),
    );
    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(similarNames).toHaveBeenCalledWith({
      name: "قلم جاف",
      excludeId: "me",
      categoryId: "cat-1",
    });
  });

  it("does not ask for a too-short name or when disabled, and clears when the name is shortened", async () => {
    const { result, rerender } = renderHook(
      ({ name, enabled }) => useSimilarProductNames({ name, enabled }),
      { initialProps: { name: "قل", enabled: true } },
    );
    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(similarNames).not.toHaveBeenCalled();

    rerender({ name: "قلم جاف", enabled: false });
    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(similarNames).not.toHaveBeenCalled();

    rerender({ name: "قلم جاف", enabled: true });
    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(result.current).toEqual([match]);

    rerender({ name: "قل", enabled: true });
    expect(result.current).toEqual([]);
  });

  it("a failed look-up shows nothing and never throws", async () => {
    similarNames.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useSimilarProductNames({ name: "قلم جاف" }));
    await settle(SIMILAR_NAME_DEBOUNCE_MS);
    expect(similarNames).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });
});
