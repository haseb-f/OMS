"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Direction as RadixDirection } from "radix-ui";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";

export type Direction = "ltr" | "rtl";

interface DirectionContextValue {
  direction: Direction;
  setDirection: (direction: Direction) => void;
}

const DirectionContext = createContext<DirectionContextValue | null>(null);

/**
 * Drives real RTL layout switching ("Native RTL," "Perfect RTL" in the
 * sidebar spec) — not just a cosmetic toggle. No translation content ships
 * with it: the Language Switch in the TopBar is a placeholder that only
 * flips direction, since no i18n/content system exists yet.
 */
export function DirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirection] = useLocalStorage<Direction>(STORAGE_KEYS.direction, "ltr");

  useEffect(() => {
    document.documentElement.dir = direction;
  }, [direction]);

  const value = useMemo(() => ({ direction, setDirection }), [direction, setDirection]);

  return (
    <DirectionContext.Provider value={value}>
      <RadixDirection.Provider dir={direction}>{children}</RadixDirection.Provider>
    </DirectionContext.Provider>
  );
}

export function useDirection() {
  const context = useContext(DirectionContext);
  if (!context) {
    throw new Error("useDirection must be used within a DirectionProvider");
  }
  return context;
}
