"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { useAuth, type AuthStatus } from "./auth-provider";
import { useLocale } from "./locale-provider";
import type { CurrentUser } from "@/services/auth-service";

interface UserContextValue {
  user: CurrentUser | null;
  /** Mirrors `AuthProvider`'s status — `PermissionGate` (and anything else gating on `hasPermission`) must check this before treating an empty/false permission check as real. */
  status: AuthStatus;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  hasPermission: (permission: string) => boolean;
  /** No avatar upload feature exists yet — always null, never a fabricated image. */
  avatarUrl: string | null;
  language: string;
  theme: string | undefined;
}

const UserContext = createContext<UserContextValue | null>(null);

/**
 * Part 3 foundation: a single place every future business module reads
 * "who is the current user, what can they do, and what are their active
 * preferences" from — composed from AuthProvider (identity/roles/
 * permissions), LocaleProvider (language), and next-themes (theme), rather
 * than duplicating that state.
 */
export function UserContextProvider({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const { locale } = useLocale();
  const { theme } = useTheme();

  const value = useMemo<UserContextValue>(() => {
    const permissions = user?.permissions ?? [];
    const isSuperAdmin = user?.isSuperAdmin ?? false;
    return {
      user,
      status,
      roles: user?.roles ?? [],
      permissions,
      isSuperAdmin,
      hasPermission: (permission: string) => isSuperAdmin || permissions.includes(permission),
      avatarUrl: null,
      language: locale,
      theme,
    };
  }, [user, status, locale, theme]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  const context = useContext(UserContext);
  if (!context) throw new Error("useUserContext must be used within a UserContextProvider");
  return context;
}
