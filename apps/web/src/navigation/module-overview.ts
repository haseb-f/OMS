import type { MessageKey } from "../i18n/translate";
import type { NavigationGroupId, NavigationItem } from "../types/navigation";
import type { IconName } from "./icon-registry";
import {
  buildNavigationTree,
  filterNavigationByAuth,
  flattenNavigationTree,
} from "./build-navigation-tree";

/**
 * Module overview model (design-system §12.17): the page a Home module tile
 * opens, listing the module's destinations. Pure — the caller supplies the
 * permission state and the navigation entries. It is derived from the SAME
 * `navigation.config.ts` entries and the SAME filter the sidebar and the route
 * guard use (`filterNavigationByAuth`), so a destination is listed only where
 * its route would open; there is no second menu configuration. Sub-groups
 * (`group`) are the sidebar's own.
 */

export const MODULE_OVERVIEW_PREFIX = "/modules";

/** `/modules/<id>` — the overview of the top-level navigation entry `<id>`. */
export function moduleOverviewPath(moduleId: string): string {
  return `${MODULE_OVERVIEW_PREFIX}/${encodeURIComponent(moduleId)}`;
}

/** The module id of an overview pathname, or null for any other path. */
export function parseModuleOverviewPath(pathname: string): string | null {
  const match = /^\/modules\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** A top-level entry that groups pages opens an overview; a page entry opens itself. */
export function isModuleEntry(item: NavigationItem): boolean {
  return flattenNavigationTree(item.children ?? []).some((child) => Boolean(child.route));
}

export interface ModuleDestination {
  id: string;
  titleKey: MessageKey;
  /** `home.destinations.<id>` — one line saying what the page is for. */
  descriptionKey: MessageKey;
  icon?: IconName;
  route: string;
}

export interface ModuleSection {
  groupId: NavigationGroupId | null;
  destinations: ModuleDestination[];
}

export interface ModuleOverview {
  id: string;
  titleKey: MessageKey;
  icon?: IconName;
  sections: ModuleSection[];
}

export interface ModuleOverviewAccess {
  permissions: readonly string[];
  isSuperAdmin: boolean;
  userType: "INTERNAL" | "AGENT" | undefined;
}

export function destinationDescriptionKey(id: string): MessageKey {
  return `home.destinations.${id}` as MessageKey;
}

/**
 * The overview of one module for this user, or null when the module does not
 * exist or none of its pages is authorized (direct navigation then shows the
 * no-access state). Sections follow the sidebar: ungrouped pages first, then
 * each group in the order given by `groupOrder`.
 */
export function buildModuleOverview(
  navigation: NavigationItem[],
  { permissions, isSuperAdmin, userType }: ModuleOverviewAccess,
  moduleId: string,
  groupOrder: Readonly<Record<NavigationGroupId, { order: number }>>,
): ModuleOverview | null {
  const allowed = filterNavigationByAuth(navigation, [...permissions], {
    isSuperAdmin,
    accessReady: true,
    userType: userType === "AGENT" ? "AGENT" : "INTERNAL",
  });
  const root = buildNavigationTree(allowed).find((item) => item.id === moduleId);
  if (!root || root.homeHidden || !isModuleEntry(root)) return null;

  const leaves = flattenNavigationTree(root.children ?? []).filter((child) => child.route);
  const byGroup = new Map<NavigationGroupId | null, ModuleDestination[]>();
  for (const leaf of leaves) {
    const key = leaf.group ?? null;
    const list = byGroup.get(key) ?? [];
    list.push({
      id: leaf.id,
      titleKey: leaf.titleKey,
      descriptionKey: destinationDescriptionKey(leaf.id),
      icon: leaf.icon,
      route: leaf.route as string,
    });
    byGroup.set(key, list);
  }
  const sections = [...byGroup.entries()]
    .sort(([a], [b]) => (a ? groupOrder[a].order : -1) - (b ? groupOrder[b].order : -1))
    .map(([groupId, destinations]) => ({ groupId, destinations }));

  return { id: root.id, titleKey: root.titleKey, icon: root.icon, sections };
}
