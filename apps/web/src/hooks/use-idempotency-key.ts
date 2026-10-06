"use client";

import { useState } from "react";

/** A random v4-style id; `crypto.randomUUID` needs a secure context, so fall back to `getRandomValues`. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * R13 B2 — one idempotency key per opened create form. Every create request
 * the form sends carries it, so a double click or a retried request returns
 * the first document instead of creating a second one (server-enforced).
 */
export function useIdempotencyKey(): string {
  const [key] = useState(newIdempotencyKey);
  return key;
}
