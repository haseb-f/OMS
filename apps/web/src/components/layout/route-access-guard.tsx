"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { navigationConfig } from "@/navigation/navigation.config";
import { resolveRouteAccess } from "@/navigation/route-access";
import { PermissionGate } from "@/components/shared/permission-gate";

/**
 * D2 — the ONE shell-level, config-driven route guard. Resolves the current
 * URL to its owning `navigation.config.ts` entry (exact match, else the
 * longest registered ancestor, so `/hr/employees/<id>` and `/…/new` inherit
 * their list entry) and, when that entry declares `permissions`, renders the
 * page through the shared `PermissionGate` — same loading/offline handling,
 * same `<AccessDenied />` — instead of letting the page mount and hit a 403.
 *
 * SEC-02: `/new` create routes use the reviewed `CREATE_ROUTE_PERMISSIONS`
 * override (the create key the API enforces, any-of) instead of the list's
 * `.view` key; `/<id>` detail routes keep the list's view requirement.
 *
 * Routes with no nav owner, or whose owner is ungated, render untouched.
 * Pages that also wrap themselves in `PermissionGate` keep working: when
 * this guard denies, the page never mounts (one Access Denied, not two);
 * when it allows, the page's own gate runs as before.
 */
export function RouteAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const requirement = useMemo(
    () => resolveRouteAccess(navigationConfig, pathname, search),
    [pathname, search],
  );

  if (requirement.permissions.length === 0) return <>{children}</>;
  return (
    <PermissionGate permission={requirement.permissions} match={requirement.match}>
      {children}
    </PermissionGate>
  );
}
