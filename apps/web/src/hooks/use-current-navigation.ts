"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { navigationConfig } from "@/navigation/navigation.config";
import {
  findNavigationItemByRoute,
  findNavigationAncestorByRoute,
  findNavigationParentRoute,
  getNavigationBreadcrumb,
} from "@/navigation/build-navigation-tree";
import { parseModuleOverviewPath } from "@/navigation/module-overview";

/**
 * Resolves the current route to its navigation entry + breadcrumb trail,
 * for the Sidebar's active highlight and the TopBar's title/breadcrumb.
 * `isExactMatch` is false on a dynamic sub-page (e.g. a Lead detail route)
 * that has no nav entry of its own — `current` is then its closest
 * registered ANCESTOR (the list page), and `BreadcrumbBar` appends one
 * more, page-supplied crumb for the actual current page — see
 * `useBreadcrumbLabel`.
 */
export function useCurrentNavigation() {
  const pathname = usePathname();
  // Query-aware so entries like `/reports/finance?report=generalLedger`
  // highlight themselves instead of their plain-path sibling.
  const search = useSearchParams()?.toString() ?? "";

  return useMemo(() => {
    // A module overview (`/modules/<id>`) is owned by its top-level entry: the trail is
    // Home › <Module>, and Back returns to Home.
    const moduleId = parseModuleOverviewPath(pathname);
    const moduleItem = moduleId
      ? navigationConfig.find((item) => item.id === moduleId && !item.parent)
      : undefined;
    if (moduleItem) {
      return {
        pathname,
        current: moduleItem,
        breadcrumb: [moduleItem],
        parentRoute: "/" as string | undefined,
        isExactMatch: true,
      };
    }
    const exact = findNavigationItemByRoute(navigationConfig, pathname, search);
    const current = exact ?? findNavigationAncestorByRoute(navigationConfig, pathname, search);
    const breadcrumb = current ? getNavigationBreadcrumb(navigationConfig, current) : [];
    const parentRoute = findNavigationParentRoute(navigationConfig, pathname);
    return { pathname, current, breadcrumb, parentRoute, isExactMatch: Boolean(exact) };
  }, [pathname, search]);
}
