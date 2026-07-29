/** localStorage keys used by shell UI state (sidebar memory, pins, recents). Centralized to avoid typo'd duplicate keys across components. */
export const STORAGE_KEYS = {
  sidebarExpandedSection: "oms.sidebar.expandedSection",
  sidebarPinnedModules: "oms.sidebar.pinnedModules",
  sidebarRecentPages: "oms.sidebar.recentPages",
  direction: "oms.direction",
} as const;
