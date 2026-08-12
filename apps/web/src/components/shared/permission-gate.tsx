"use client";

import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { EnterpriseButton } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { PageLoading } from "./page-loading";
import { AccessDenied } from "./access-denied";

/**
 * TASK-060 Part 6 — page-level View gate: wrap a page's content once at the
 * top; if the current user lacks `permission`, the entire page becomes
 * `<AccessDenied />` instead of the real content ever mounting (never just a
 * visually-hidden div — the business content, and any data it would fetch,
 * simply never renders).
 *
 * This is the ONE global auth/permission route guard every protected page
 * uses — never a per-page loading hack. It is deliberately status-aware,
 * not just permission-aware: on a hard refresh, `AuthProvider`'s
 * `GET /auth/me` bootstrap hasn't resolved yet, so `hasPermission()` would
 * otherwise see an empty permission set and render `<AccessDenied />` for a
 * fully-authorized user until that call finishes — exactly the "flashes
 * Access Denied, then loads" bug this fixes at its root. An empty
 * permission set only ever means "denied" once `status === "authenticated"`;
 * while loading it means "not known yet".
 */
export function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const { refreshUser } = useAuth();
  const { status, hasPermission } = useUserContext();

  if (status === "loading") {
    return <PageLoading />;
  }

  if (status === "unauthenticated") {
    // `proxy.ts` already redirects an unauthenticated request to /login at
    // the edge, and `apiClient`'s global 401 handler does the same
    // client-side for an expired session — this only covers the brief
    // window before that navigation lands. Render nothing rather than a
    // misleading "Access Denied".
    return null;
  }

  if (status === "error") {
    // The bootstrap call itself failed (network/server error) — the
    // permission state is genuinely unknown, not empty. Never render
    // "Access Denied" for a state that isn't actually a denial.
    return (
      <EmptyState
        icon={WifiOff}
        title={t("common.offline")}
        description={t("common.offlineDescription")}
        action={
          <EnterpriseButton type="button" variant="outline" onClick={() => void refreshUser()}>
            {t("common.retry")}
          </EnterpriseButton>
        }
      />
    );
  }

  if (!hasPermission(permission)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}
