"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";
import { registerClientCache } from "@/lib/client-data-scope";

const restorableCache = new Map<string, unknown>();
// SEC-02: list filters/search text belong to the identity that typed them.
registerClientCache(() => restorableCache.clear());

/**
 * List/detail round-trip state — survives unmount when the user opens a
 * record and hits Back, without putting filters in the URL. Memory-only
 * (tab session); a full reload starts from `initial`.
 */
export function useRestorableState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() =>
    restorableCache.has(key) ? (restorableCache.get(key) as T) : initial,
  );
  const [activeKey, setActiveKey] = useState(key);

  if (key !== activeKey) {
    setActiveKey(key);
    setState(restorableCache.has(key) ? (restorableCache.get(key) as T) : initial);
  }

  useEffect(() => {
    restorableCache.set(key, state);
  }, [key, state]);

  return [state, setState];
}

/** Same cache, keyed by the current pathname so sibling lists never collide. */
export function usePathRestorableState<T>(
  suffix: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname();
  return useRestorableState(`oms.list:${pathname}:${suffix}`, initial);
}
