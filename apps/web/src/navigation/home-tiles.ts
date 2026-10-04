import type { MessageKey } from "../i18n/translate";
import type { HomeTone, NavigationItem } from "../types/navigation";
import type { IconName } from "./icon-registry";
import {
  buildNavigationTree,
  filterNavigationByAuth,
  flattenNavigationTree,
} from "./build-navigation-tree";
import { isModuleEntry, moduleOverviewPath } from "./module-overview";
import { isRouteAccessAllowed, resolveRouteAccess, routeAudienceMismatch } from "./route-access";

/**
 * Home launcher model (design-system §12.17). Pure: the caller supplies the
 * permission state. The launcher never invents a destination or a permission
 * rule — it is derived from the SAME `navigation.config.ts` entries and the
 * SAME filters (`filterNavigationByAuth`, `resolveRouteAccess`) that decide
 * sidebar visibility and the route guard, so a tile exists only where the
 * route would open. The destination itself is enforced again by the shell
 * route guard and, for every figure and record, by the API's permission guards.
 */

export type UserType = "INTERNAL" | "AGENT" | undefined;

export interface HomeAccessInput {
  permissions: readonly string[];
  isSuperAdmin: boolean;
  userType: UserType;
}

export interface HomeTile {
  id: string;
  titleKey: MessageKey;
  icon?: IconName;
  tone: HomeTone;
  /** Where the tile opens: a module's overview (`/modules/<id>`), or a page entry's own route. */
  href: string;
  /** Up to three authorized pages inside a module — a caption, not links. */
  previewKeys: MessageKey[];
}

/** Stable fallback palette (by position) for an item that declares no `homeTone`. */
export const HOME_TONE_CYCLE: readonly HomeTone[] = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "sky",
  "rose",
  "teal",
  "indigo",
  "orange",
  "slate",
];

const PREVIEW_COUNT = 3;

function tileHref(item: NavigationItem): string | undefined {
  // A module (an entry that groups pages) always opens its overview — even with a
  // single authorized page — so the user picks the destination, never lands on the first.
  if (isModuleEntry(item)) return moduleOverviewPath(item.id);
  return item.route;
}

/**
 * One tile per authorized top-level entry (an internal module, or an agent
 * portal page). An entry with no authorized page never appears; Home itself
 * (`homeHidden`) is not a tile.
 */
export function buildHomeTiles(
  navigation: NavigationItem[],
  { permissions, isSuperAdmin, userType }: HomeAccessInput,
): HomeTile[] {
  const allowed = filterNavigationByAuth(navigation, [...permissions], {
    isSuperAdmin,
    accessReady: true,
    userType: userType === "AGENT" ? "AGENT" : "INTERNAL",
  });
  const roots = buildNavigationTree(allowed).filter((item) => !item.homeHidden);
  return roots.flatMap((item, index) => {
    const href = tileHref(item);
    if (!href) return [];
    const leaves = flattenNavigationTree(item.children ?? []).filter((child) => child.route);
    return [
      {
        id: item.id,
        titleKey: item.titleKey,
        icon: item.icon,
        tone: item.homeTone ?? HOME_TONE_CYCLE[index % HOME_TONE_CYCLE.length],
        href,
        previewKeys: leaves.slice(0, PREVIEW_COUNT).map((leaf) => leaf.titleKey),
      },
    ];
  });
}

export interface HomeActionDefinition {
  id: string;
  titleKey: MessageKey;
  icon: IconName;
  tone: HomeTone;
  /** A creation route; its permission is `CREATE_ROUTE_PERMISSIONS` (the page's own gate). */
  route: string;
}

/** Frequent creation actions, in reading order. Permissions come from the route table, never from here. */
export const HOME_ACTIONS: readonly HomeActionDefinition[] = [
  {
    id: "new-quotation",
    titleKey: "home.actions.newQuotation",
    icon: "file-text",
    tone: "sky",
    route: "/sales/quotations/new",
  },
  {
    id: "new-order",
    titleKey: "home.actions.newOrder",
    icon: "shopping-cart",
    tone: "emerald",
    route: "/sales/orders/new",
  },
  {
    id: "new-invoice",
    titleKey: "home.actions.newInvoice",
    icon: "receipt",
    tone: "blue",
    route: "/sales/invoices/new",
  },
  {
    id: "new-receipt",
    titleKey: "home.actions.newReceipt",
    icon: "banknote",
    tone: "teal",
    route: "/sales/payments/new",
  },
  {
    id: "new-purchase-order",
    titleKey: "home.actions.newPurchaseOrder",
    icon: "shopping-bag",
    tone: "amber",
    route: "/purchasing/purchase-orders/new",
  },
  {
    id: "new-purchase-invoice",
    titleKey: "home.actions.newPurchaseInvoice",
    icon: "receipt",
    tone: "orange",
    route: "/purchasing/purchase-invoices/new",
  },
  {
    id: "new-journal-entry",
    titleKey: "home.actions.newJournalEntry",
    icon: "book-text",
    tone: "indigo",
    route: "/finance/journal-entries/new",
  },
  {
    id: "new-agent-order",
    titleKey: "home.actions.newAgentOrder",
    icon: "shopping-cart",
    tone: "emerald",
    route: "/agent/orders/new",
  },
];

export interface HomeAction extends HomeActionDefinition {
  href: string;
}

/**
 * The creation actions this user may open: the route's own access rule
 * (`resolveRouteAccess` — create override first), the user's audience, and the
 * super-admin bypass the guard applies.
 */
export function buildHomeActions(
  navigation: NavigationItem[],
  { permissions, isSuperAdmin, userType }: HomeAccessInput,
  definitions: readonly HomeActionDefinition[] = HOME_ACTIONS,
): HomeAction[] {
  const audience = userType === "AGENT" ? "AGENT" : "INTERNAL";
  const hasPermission = (permission: string) =>
    (isSuperAdmin && audience === "INTERNAL") || permissions.includes(permission);
  return definitions
    .filter((action) => routeAudienceMismatch(audience, action.route) === null)
    .filter((action) =>
      isRouteAccessAllowed(resolveRouteAccess(navigation, action.route), hasPermission),
    )
    .map((action) => ({ ...action, href: action.route }));
}
