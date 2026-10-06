"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface LiveRefreshOptions {
  /** Auto refresh period in ms while the page is visible; `null` = manual only. */
  intervalMs?: number | null;
  /** Data older than this is reported as stale (default 3 min). */
  staleAfterMs?: number;
}

export interface LiveRefreshState<T> {
  /** Last good data — kept when a later refresh fails. */
  data: T | null;
  /** Error of the latest attempt (null once a refresh succeeds). */
  error: unknown;
  /** First load still running (no data and no error yet). */
  loading: boolean;
  /** A request is in flight (first load or refresh). */
  refreshing: boolean;
  /** Epoch ms of the last successful load. */
  lastRefreshedAt: number | null;
  /** True when the shown data is older than `staleAfterMs`. */
  isStale: boolean;
  /** Manual refresh; joins the in-flight request instead of starting another. */
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL = 60_000;
const DEFAULT_STALE = 180_000;
/** How often the stale flag is re-evaluated. */
const CLOCK_MS = 15_000;

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Live data for a report (R13 spec E): loads on mount and whenever `load`
 * changes (new filters), refreshes on demand and — when `intervalMs` is set —
 * every interval ONLY while the document is visible; on becoming visible it
 * refreshes at once if the data is older than one interval. Requests never
 * overlap: a refresh while one is in flight joins it; a new `load` aborts the
 * previous request and ignores its late answer. A failed refresh keeps the
 * last data and exposes the error, so the page can show "showing the last
 * figures" instead of blanking.
 */
export function useLiveRefresh<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { intervalMs = DEFAULT_INTERVAL, staleAfterMs = DEFAULT_STALE }: LiveRefreshOptions = {},
): LiveRefreshState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadRef = useRef(load);
  const inFlight = useRef<Promise<void> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lastRef = useRef<number | null>(null);

  const run = useCallback((restart: boolean): Promise<void> => {
    if (inFlight.current && !restart) return inFlight.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const gen = ++generation.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const next = await loadRef.current(current.signal);
        if (gen !== generation.current) return;
        const at = Date.now();
        lastRef.current = at;
        setData(next);
        setError(null);
        setLastRefreshedAt(at);
        setNow(at);
      } catch (err) {
        if (gen !== generation.current) return;
        setError(err);
      } finally {
        if (gen === generation.current) {
          inFlight.current = null;
          setRefreshing(false);
        }
      }
    })();
    inFlight.current = request;
    return request;
  }, []);

  // (Re)load whenever the loader changes — a new filter restarts the request.
  useEffect(() => {
    loadRef.current = load;
    void run(true);
  }, [load, run]);

  // Abort and ignore anything still running after unmount.
  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  // Auto refresh — only while visible; catch up when the tab becomes visible.
  useEffect(() => {
    if (!intervalMs) return;
    const timer = window.setInterval(() => {
      if (isVisible()) void run(false);
    }, intervalMs);
    const onVisibility = () => {
      if (!isVisible()) return;
      const last = lastRef.current;
      if (last === null || Date.now() - last >= intervalMs) void run(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, run]);

  // A light clock so `isStale` turns true without a new request.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => run(false), [run]);

  return {
    data,
    error,
    loading: data === null && error === null,
    refreshing,
    lastRefreshedAt,
    isStale: lastRefreshedAt !== null && now - lastRefreshedAt > staleAfterMs,
    refresh,
  };
}
