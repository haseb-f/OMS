"use client";

import type { ReactNode } from "react";
import { useUserContext } from "@/providers/user-context";
import { AccessDenied } from "./access-denied";

/**
 * TASK-060 Part 6 — page-level View gate: wrap a page's content once at the
 * top; if the current user lacks `permission`, the entire page becomes
 * `<AccessDenied />` instead of the real content ever mounting (never just a
 * visually-hidden div — the business content, and any data it would fetch,
 * simply never renders).
 */
export function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { hasPermission } = useUserContext();
  if (!hasPermission(permission)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}
