import { filterNavigationByAuth } from "@/navigation/build-navigation-tree";
import type { NavigationItem } from "@/types/navigation";

/**
 * Pages offered on the dashboard of a user with no dashboard figures: the
 * user's own pinned / recent pages first, then — so the landing is never an
 * empty screen — the first page of each module they may open (navigation
 * order, one per module). Pure: the caller supplies the permission state.
 */
export function buildLandingShortcuts({
  navigation,
  permissions,
  isSuperAdmin,
  pinnedIds,
  recentIds,
  limit = 8,
}: {
  navigation: NavigationItem[];
  permissions: string[];
  isSuperAdmin: boolean;
  pinnedIds: readonly string[];
  recentIds: readonly string[];
  limit?: number;
}): { personal: NavigationItem[]; suggested: NavigationItem[] } {
  const allowed = filterNavigationByAuth(navigation, permissions, {
    isSuperAdmin,
    accessReady: true,
    userType: "INTERNAL",
  });
  const byId = new Map(allowed.map((item) => [item.id, item]));

  const seen = new Set<string>();
  const personal = [...pinnedIds, ...recentIds]
    .map((id) => byId.get(id))
    .filter((item): item is NavigationItem => {
      if (!item?.route || item.route === "/" || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit);
  if (personal.length > 0) return { personal, suggested: [] };

  const rank = (item: NavigationItem) => item.order ?? Number.MAX_SAFE_INTEGER;
  const topLevel = (item: NavigationItem): string => {
    let current = item;
    while (current.parent && byId.get(current.parent)) current = byId.get(current.parent)!;
    return current.id;
  };
  const moduleOrder = new Map<string, number>();
  for (const item of allowed) if (!item.parent) moduleOrder.set(item.id, rank(item));

  const modulesSeen = new Set<string>();
  const suggested = allowed
    .filter((item) => item.route && item.route !== "/" && item.parent)
    .sort(
      (a, b) =>
        (moduleOrder.get(topLevel(a)) ?? 0) - (moduleOrder.get(topLevel(b)) ?? 0) ||
        rank(a) - rank(b),
    )
    .filter((item) => {
      const moduleId = topLevel(item);
      if (modulesSeen.has(moduleId)) return false;
      modulesSeen.add(moduleId);
      return true;
    })
    .slice(0, limit);
  return { personal: [], suggested };
}
