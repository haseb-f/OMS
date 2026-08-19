import type { NavigationItem } from "../types/navigation";

/**
 * Assembles the flat `navigation.config.ts` list into a nested tree
 * (populating `children`), applying `visible` filtering and `order`
 * sorting at every level. Permission/feature-flag filtering intentionally
 * happens in a separate step (`filterByAccess`) once those systems exist —
 * this function only knows about shape, not authorization.
 */
export function buildNavigationTree(items: NavigationItem[]): NavigationItem[] {
  const byParent = new Map<string | undefined, NavigationItem[]>();

  for (const item of items) {
    if (item.visible === false) continue;
    const siblings = byParent.get(item.parent) ?? [];
    siblings.push(item);
    byParent.set(item.parent, siblings);
  }

  const attachChildren = (item: NavigationItem): NavigationItem => {
    const children = byParent.get(item.id);
    if (!children) return item;
    const nested = sortByOrder(children)
      .map(attachChildren)
      .filter((child) => Boolean(child.route || child.children?.length));
    if (!nested.length) return item;
    return { ...item, children: nested };
  };

  const roots = byParent.get(undefined) ?? [];
  return sortByOrder(roots).map(attachChildren).filter(hasVisibleContent);
}

function hasVisibleContent(item: NavigationItem): boolean {
  if (item.children?.length) {
    return item.children.some(hasVisibleContent);
  }
  return Boolean(item.route);
}

function sortByOrder(items: NavigationItem[]): NavigationItem[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Permission filtering (ADR-0022 Part 4) — an item with no `permissions`
 * list is always visible (e.g. Dashboard); otherwise the user must hold
 * every listed permission. Filter the flat list with this BEFORE calling
 * `buildNavigationTree`, so a hidden parent's children never orphan into
 * the tree.
 *
 * SYSTEM_ADMIN bypass — `isSuperAdmin` shows every item regardless of its
 * `permissions` list, including sections whose coarse `*.view` gate (e.g.
 * `crm.view`, `finance.view`) has no corresponding Permission Matrix row to
 * grant through the normal UI.
 *
 * Auth-aware wrapper: while bootstrap is still loading (or failed for a
 * non-401 reason), permissions are unknown — not empty. Treating that as
 * "no access" would hide every gated module and leave only Dashboard until
 * a later re-render. Unknown state therefore returns the unfiltered list;
 * filtering starts only after `accessReady` is true.
 */
export function filterNavigationByAuth(
  items: NavigationItem[],
  userPermissions: string[],
  options: { isSuperAdmin?: boolean; accessReady?: boolean } = {},
): NavigationItem[] {
  if (!options.accessReady) return items;
  return filterByAccess(items, userPermissions, options.isSuperAdmin);
}

export function filterByAccess(
  items: NavigationItem[],
  userPermissions: string[],
  isSuperAdmin = false,
): NavigationItem[] {
  const hasAccess = (item: NavigationItem) =>
    isSuperAdmin ||
    !item.permissions?.length ||
    item.permissions.every((permission) => userPermissions.includes(permission));

  const visibleIds = new Set(items.filter(hasAccess).map((item) => item.id));
  // A child is only kept if its parent chain is fully visible too.
  const isReachable = (item: NavigationItem): boolean => {
    if (!visibleIds.has(item.id)) return false;
    if (!item.parent) return true;
    const parent = items.find((candidate) => candidate.id === item.parent);
    return parent ? isReachable(parent) : true;
  };

  return items.filter((item) => hasAccess(item) && isReachable(item));
}

/** Flattens a tree back into a list — used for search-within-sidebar and breadcrumb lookup. */
export function flattenNavigationTree(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) =>
    item.children ? [item, ...flattenNavigationTree(item.children)] : [item],
  );
}

/** Finds the item whose `route` exactly matches the given pathname, if any. */
export function findNavigationItemByRoute(
  items: NavigationItem[],
  pathname: string,
): NavigationItem | undefined {
  return flattenNavigationTree(items).find((item) => item.route === pathname);
}

/**
 * Falls back to the closest registered ANCESTOR route when nothing matches
 * exactly — e.g. `/crm/leads/8f2c...` has no nav entry of its own (a Lead
 * detail page is dynamic, per-record), but `/crm/leads` does, and is the
 * right "you are here" trail root. Only ever matches on a `/`-boundary
 * prefix (`/crm/leads` matches `/crm/leads/123`, never `/crm/leadsx`), and
 * picks the LONGEST such match so a more specific nested route always wins
 * over a shorter parent one.
 */
export function findNavigationAncestorByRoute(
  items: NavigationItem[],
  pathname: string,
): NavigationItem | undefined {
  const candidates = flattenNavigationTree(items).filter(
    (item) =>
      item.route &&
      item.route !== "/" &&
      (pathname === item.route || pathname.startsWith(`${item.route}/`)),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((longest, candidate) =>
    (candidate.route?.length ?? 0) > (longest.route?.length ?? 0) ? candidate : longest,
  );
}

/**
 * The closest registered parent list for a nested/detail pathname — e.g.
 * `/store-orders/STO-1` and `/store-orders/import` both resolve to
 * `/store-orders`. Used as the Back button fallback when in-app history
 * is not usable. Never returns `"/"` so a cold load does not dump the
 * user on the dashboard.
 */
export function findNavigationParentRoute(
  items: NavigationItem[],
  pathname: string,
): string | undefined {
  const candidates = flattenNavigationTree(items).filter(
    (item) =>
      item.route &&
      item.route !== "/" &&
      pathname !== item.route &&
      pathname.startsWith(`${item.route}/`),
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((longest, candidate) =>
    (candidate.route?.length ?? 0) > (longest.route?.length ?? 0) ? candidate : longest,
  ).route;
}

/** Walks up `parent` ids to build the breadcrumb trail (root-first) for the matched item. */
export function getNavigationBreadcrumb(
  flatItems: NavigationItem[],
  item: NavigationItem,
): NavigationItem[] {
  const byId = new Map(flatItems.map((i) => [i.id, i]));
  const trail: NavigationItem[] = [item];
  let current = item;
  while (current.parent) {
    const parent = byId.get(current.parent);
    if (!parent) break;
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}
