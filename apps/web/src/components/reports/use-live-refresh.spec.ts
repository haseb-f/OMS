import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveRefresh } from "./use-live-refresh";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A loader whose calls resolve only when the test says so. */
function deferredLoader() {
  const pending: Array<{ resolve: (value: number) => void; reject: (error: unknown) => void }> = [];
  const load = vi.fn<(signal: AbortSignal) => Promise<number>>(
    () =>
      new Promise<number>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { load, pending };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLiveRefresh", () => {
  it("loads once on mount and never overlaps requests (manual refresh joins the in-flight one)", async () => {
    const { load, pending } = deferredLoader();
    const { result } = renderHook(() => useLiveRefresh(load, { intervalMs: 60_000 }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    // Refresh + interval tick while the first request is still running.
    void act(() => {
      void result.current.refresh();
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0].resolve(7);
    });
    await flush();
    expect(result.current.data).toBe(7);
    expect(result.current.lastRefreshedAt).not.toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it("auto-refreshes only while visible and catches up when the tab becomes visible", async () => {
    const load = vi.fn(async () => 1);
    renderHook(() => useLiveRefresh(load, { intervalMs: 60_000 }));
    await flush();
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      setVisibility("visible");
    });
    expect(load).toHaveBeenCalledTimes(3);

    // Becoming visible again with fresh data does not refetch.
    await act(async () => {
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps the last data on failure, exposes the error, and flags stale data after 3 minutes", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("down");
      return 42;
    });
    const { result } = renderHook(() => useLiveRefresh(load, { intervalMs: null }));
    await flush();
    expect(result.current.data).toBe(42);
    expect(result.current.isStale).toBe(false);

    fail = true;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toBe(42);
    expect(result.current.error).toBeInstanceOf(Error);

    await act(async () => {
      vi.advanceTimersByTime(195_000);
    });
    expect(result.current.isStale).toBe(true);
    // Manual only: no interval requests happened.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a new loader restarts the request and ignores the late answer of the old one", async () => {
    const first = deferredLoader();
    const second = deferredLoader();
    const { result, rerender } = renderHook(
      ({ load }) => useLiveRefresh(load, { intervalMs: null }),
      {
        initialProps: { load: first.load },
      },
    );
    rerender({ load: second.load });
    expect(second.load).toHaveBeenCalledTimes(1);
    expect(first.load.mock.calls[0][0].aborted).toBe(true);
    await act(async () => {
      second.pending[0].resolve(2);
      first.pending[0].resolve(1);
    });
    await flush();
    expect(result.current.data).toBe(2);
  });
});
