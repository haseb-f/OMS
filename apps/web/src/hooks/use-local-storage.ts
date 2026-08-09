"use client";

import { useCallback, useEffect, useState } from "react";

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
