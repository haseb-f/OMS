"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { navigationConfig } from "@/navigation/navigation.config";
import {
  findNavigationItemByRoute,
  getNavigationBreadcrumb,
} from "@/navigation/build-navigation-tree";

/** Resolves the current route to its navigation entry + breadcrumb trail, for the Sidebar's active highlight and the TopBar's title/breadcrumb. */
export function useCurrentNavigation() {
  const pathname = usePathname();

  return useMemo(() => {
    const current = findNavigationItemByRoute(navigationConfig, pathname);
    const breadcrumb = current ? getNavigationBreadcrumb(navigationConfig, current) : [];
    return { pathname, current, breadcrumb };
  }, [pathname]);
}
