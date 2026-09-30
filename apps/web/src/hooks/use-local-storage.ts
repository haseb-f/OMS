"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * Persisted client-side UI state (sidebar pins/recents/expanded-section).
 * Not a data-fetching or business-state hook — purely shell preferences
 * that live in the browser, never the backend.
 */
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // Corrupt or inaccessible storage — fall back to defaultValue silently.
    }
    setIsHydrated(true);
  }, [key]);

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = next instanceof Function ? next(previous) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage unavailable (private browsing, quota) — state still updates in-memory.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update, isHydrated] as const;
}

/* ------------------------------------------------------------------ */
/* Flash-free variant                                                   */
/* ------------------------------------------------------------------ */

const LOCAL_STORAGE_EVENT = "oms:local-storage";

/** In-memory fallback so a preference still toggles when storage is blocked. */
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

/**
 * A persisted preference read synchronously on the client
 * (`useSyncExternalStore`), so a screen never paints the default first and
 * then jumps to the stored value (e.g. the report header collapse). The
 * server snapshot is the default. Same-tab writes and other tabs' `storage`
 * events both notify subscribers.
 */
export function useStoredPreference<T>(key: string, defaultValue: T) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const onStorage = (event: Event) => {
        const changed =
          event instanceof StorageEvent ? event.key : (event as CustomEvent<string>).detail;
        if (changed === null || changed === key) notify();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(LOCAL_STORAGE_EVENT, onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(LOCAL_STORAGE_EVENT, onStorage);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const value = useMemo<T>(() => {
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
    // `defaultValue` is a literal at every call site; the raw string is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const update = useCallback(
    (next: T) => {
      const raw = JSON.stringify(next);
      memory.set(key, raw);
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        // Storage unavailable (private mode, quota) — the in-memory copy serves.
      }
      window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_EVENT, { detail: key }));
    },
    [key],
  );
  return [value, update] as const;
}
