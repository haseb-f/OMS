"use client";

import { useEffect } from "react";
import { useLocalStorage } from "./use-local-storage";
import { useCurrentNavigation } from "./use-current-navigation";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const MAX_RECENT_PAGES = 5;

/** Tracks the last few visited navigation items (by id) for the Sidebar's "Recent Pages" group — pure UI convenience, not business data. */
export function useRecentPages() {
  const { current } = useCurrentNavigation();
  const [recentIds, setRecentIds] = useLocalStorage<string[]>(STORAGE_KEYS.sidebarRecentPages, []);

  useEffect(() => {
    if (!current) return;
    setRecentIds((previous) => {
      const withoutCurrent = previous.filter((id) => id !== current.id);
      return [current.id, ...withoutCurrent].slice(0, MAX_RECENT_PAGES);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  return recentIds;
}
