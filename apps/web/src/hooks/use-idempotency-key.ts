"use client";

import { useCallback, useState } from "react";

/**
 * A fresh request key (UUID v4). `crypto.randomUUID` needs a secure context,
 * so fall back to `crypto.getRandomValues` — never `Math.random`.
 */
export function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Alias kept for callers that read better with "new". */
export const newIdempotencyKey = createIdempotencyKey;

/**
 * One idempotency key per form session (one opened create form / dialog): the
 * SAME key is sent by every submit of that session — a double click, a retry
 * after a timeout — so the server performs the operation at most once and
 * answers the repeat with the original record. `renew()` starts a new session
 * (call it after a success and whenever the dialog is closed).
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(createIdempotencyKey);
  const renew = useCallback(() => setKey(createIdempotencyKey()), []);
  return { key, renew };
}
