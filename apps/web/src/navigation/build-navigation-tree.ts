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
    return {
      ...item,
      children: sortByOrder(children).map(attachChildren),
    };
  };

  const roots = byParent.get(undefined) ?? [];
  return sortByOrder(roots).map(attachChildren);
}

function sortByOrder(items: NavigationItem[]): NavigationItem[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Flattens a tree back into a list — used for search-within-sidebar and breadcrumb lookup. */
export function flattenNavigationTree(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) =>
    item.children ? [item, ...flattenNavigationTree(item.children)] : [item],
  );
}

/** Finds the item whose `route` matches the given pathname, if any. */
export function findNavigationItemByRoute(
  items: NavigationItem[],
  pathname: string,
): NavigationItem | undefined {
  return flattenNavigationTree(items).find((item) => item.route === pathname);
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
