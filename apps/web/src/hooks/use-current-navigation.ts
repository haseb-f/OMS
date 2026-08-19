"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { navigationConfig } from "@/navigation/navigation.config";
import {
  findNavigationItemByRoute,
  findNavigationAncestorByRoute,
  findNavigationParentRoute,
  getNavigationBreadcrumb,
} from "@/navigation/build-navigation-tree";

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

  return useMemo(() => {
    const exact = findNavigationItemByRoute(navigationConfig, pathname);
    const current = exact ?? findNavigationAncestorByRoute(navigationConfig, pathname);
    const breadcrumb = current ? getNavigationBreadcrumb(navigationConfig, current) : [];
    const parentRoute = findNavigationParentRoute(navigationConfig, pathname);
    return { pathname, current, breadcrumb, parentRoute, isExactMatch: Boolean(exact) };
  }, [pathname]);
}
