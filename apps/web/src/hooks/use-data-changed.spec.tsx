import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { notifyDataChanged, useDataChanged } from "./use-data-changed";

describe("useDataChanged (R22 §5 freshness)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("runs after a settlement operation signalled in this tab", () => {
    const onChange = vi.fn();
    renderHook(() => useDataChanged("settlement", onChange));
    act(() => notifyDataChanged("settlement"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("refetches when the person returns to the tab (focus), at most once per burst", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderHook(() => useDataChanged("settlement", onChange));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stays quiet while disabled (e.g. a draft whose form must not reload)", () => {
    const onChange = vi.fn();
    renderHook(() => useDataChanged("settlement", onChange, false));
    act(() => {
      notifyDataChanged("settlement");
      window.dispatchEvent(new Event("focus"));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("always calls the latest callback (no stale closure)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useDataChanged("settlement", cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    act(() => notifyDataChanged("settlement"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
