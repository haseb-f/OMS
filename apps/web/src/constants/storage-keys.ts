/** localStorage keys used by shell UI state (sidebar memory, pins, recents). Centralized to avoid typo'd duplicate keys across components. */
export const STORAGE_KEYS = {
  // Renamed again when the sidebar reverted to strict accordion (one
  // module at a time) — the previous key held a string[], not a single
  // id, so a new key avoids misreading that legacy shape.
  sidebarExpandedSection: "oms.sidebar.expandedModule",
  sidebarPinnedModules: "oms.sidebar.pinnedModules",
  sidebarRecentPages: "oms.sidebar.recentPages",
  locale: "oms.locale",
  activeCompanyId: "oms.company.activeId",
  activeBranchId: "oms.company.activeBranchId",
  recentCustomers: "oms.sales.recentCustomers",
  recentSuppliers: "oms.purchasing.recentSuppliers",
} as const;
