"use client";

import { useCallback, useState } from "react";

/** A fresh request key: `crypto.randomUUID` where available, otherwise a time + random fallback. */
export function createIdempotencyKey(): string {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * One idempotency key per form session (e.g. one open "New assembly" dialog):
 * the SAME key is sent by every submit of that session — a double click, a
 * retry after a timeout — so the server performs the operation at most once
 * and answers the repeat with the original record. `renew()` starts a new
 * session (call it after a success and whenever the dialog is closed).
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(createIdempotencyKey);
  const renew = useCallback(() => setKey(createIdempotencyKey()), []);
  return { key, renew };
}
