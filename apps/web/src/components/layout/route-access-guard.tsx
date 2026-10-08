"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { navigationConfig } from "@/navigation/navigation.config";
import {
  AGENT_PORTAL_HOME,
  PARTNER_PORTAL_HOME,
  resolveRouteAccess,
  routeAudienceMismatch,
} from "@/navigation/route-access";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AccessDenied } from "@/components/shared/access-denied";
import { useUserContext } from "@/providers/user-context";
import { pendingPasswordRedirect } from "@/config/account/change-password";

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
  const router = useRouter();
  const { user, status } = useUserContext();
  const requirement = useMemo(
    () => resolveRouteAccess(navigationConfig, pathname, search),
    [pathname, search],
  );

  // Agents milestone (spec §3) — the shell is shared, the audiences are not.
  // An external agent user lives in the `/agent` portal only, a partner login
  // (R15 D15-14) in `/partner` only; an internal user never renders a portal
  // page. The API enforces the same rule server-side.
  const audienceMismatch =
    status === "authenticated" && user ? routeAudienceMismatch(user.userType, pathname) : null;
  // A temporary password is not a working credential (both audiences): the
  // own-password page comes first, before the portal or any internal page.
  const passwordRedirect =
    status === "authenticated" ? pendingPasswordRedirect(user, pathname) : null;
  useEffect(() => {
    if (passwordRedirect) router.replace(passwordRedirect);
    else if (audienceMismatch === "agent-outside-portal") router.replace(AGENT_PORTAL_HOME);
    else if (audienceMismatch === "partner-outside-portal") router.replace(PARTNER_PORTAL_HOME);
  }, [passwordRedirect, audienceMismatch, router]);
  if (passwordRedirect) return null;
  if (audienceMismatch === "agent-outside-portal" || audienceMismatch === "partner-outside-portal")
    return null;
  if (audienceMismatch === "internal-in-portal") return <AccessDenied />;

  if (requirement.permissions.length === 0) return <>{children}</>;
  return (
    <PermissionGate permission={requirement.permissions} match={requirement.match}>
      {children}
    </PermissionGate>
  );
}
