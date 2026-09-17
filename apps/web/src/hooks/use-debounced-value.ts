"use client";

import { useEffect, useState } from "react";

/**
 * The ONE search debounce delay in OMS. Every searchable surface (list
 * toolbars, entity comboboxes, filter popovers, lookup dialogs) waits the
 * same interval before hitting the API, so typing at a steady pace feels
 * identical whichever control the user is in — these used to be four
 * hand-picked values between 180ms and 350ms.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/** Trails `value` by `delayMs`, resetting the timer on every change. */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
