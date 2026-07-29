"use client";

import { useCallback } from "react";
import { useLocalStorage } from "./use-local-storage";
import { STORAGE_KEYS } from "@/constants/storage-keys";

/** User-controlled pinned nav items ("Pinned Modules") — client-side preference, not business data. */
export function usePinnedItems() {
  const [pinnedIds, setPinnedIds] = useLocalStorage<string[]>(
    STORAGE_KEYS.sidebarPinnedModules,
    [],
  );

  const togglePin = useCallback(
    (id: string) => {
      setPinnedIds((previous) =>
        previous.includes(id) ? previous.filter((pinnedId) => pinnedId !== id) : [...previous, id],
      );
    },
    [setPinnedIds],
  );

  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds]);

  return { pinnedIds, togglePin, isPinned };
}
