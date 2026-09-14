"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/services/api-client";

/**
 * Minimal fetch-on-mount/deps-change hook — this codebase has no
 * react-query dependency, so every other provider (`AuthProvider`, etc.)
 * already uses this same plain `useEffect` + `useState` shape; the Portal's
 * read-only pages follow the identical convention rather than introducing a
 * new data-fetching library.
 *
 * The caller passes an already-memoized `fetcher` (via `useCallback` with
 * its own literal deps array) — this hook re-fetches whenever THAT function
 * identity changes, rather than accepting its own dynamic deps array, which
 * `react-hooks/use-memo` requires to be a literal.
 */
export function usePortalQuery<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets loading/error state for the new fetch, mirrors AuthProvider.refreshUser's own effect shape
    setIsLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, reloadToken]);

  return { data, error, isLoading, reload: () => setReloadToken((n) => n + 1) };
}
