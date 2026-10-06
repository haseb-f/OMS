import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdempotencyKey, useIdempotencyKey } from "./use-idempotency-key";

describe("useIdempotencyKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps ONE key for the whole session, across re-renders (double click / retry)", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    expect(first).toBeTruthy();
    rerender();
    rerender();
    expect(result.current.key).toBe(first);
  });

  it("starts a new session (a new key) only when renewed", () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    act(() => result.current.renew());
    expect(result.current.key).not.toBe(first);
    const second = result.current.key;
    act(() => result.current.renew());
    expect(result.current.key).not.toBe(second);
  });

  it("gives every dialog instance its own key", () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });
});

describe("createIdempotencyKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(createIdempotencyKey()).toBe("uuid-1");
  });

  it("falls back to getRandomValues (never Math.random) without randomUUID — unique v4-style ids", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => real.getRandomValues(bytes),
    });
    const keys = Array.from({ length: 50 }, () => createIdempotencyKey());
    expect(new Set(keys).size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
