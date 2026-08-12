"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authService, type CurrentUser } from "@/services/auth-service";
import { ApiError } from "@/services/api-client";
import { getAuthToken, setAuthToken, clearAuthToken } from "@/lib/auth-token";

/**
 * The auth bootstrap's one source of truth — every consumer (`UserContext`,
 * `PermissionGate`) reads this instead of inferring readiness from `user`
 * being non-null, which is exactly the race that used to flash "Access
 * Denied" on a hard refresh (see `PermissionGate`'s doc comment).
 *
 *   loading         — `GET /auth/me` for this session hasn't resolved yet.
 *                      `user`/`permissions` are unknown, NOT "empty".
 *   authenticated   — resolved; `user` (and its `permissions`) are real.
 *   unauthenticated — no token, or the token was rejected (401). `proxy.ts`
 *                      already redirects this case at the edge before the
 *                      shell renders; this status exists so client state
 *                      never contradicts that redirect while it lands.
 *   error           — the bootstrap call itself failed for a reason OTHER
 *                      than "the token is invalid" (network/server error).
 *                      We genuinely don't know the user's permissions —
 *                      this must never be treated as "no permissions".
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  user: CurrentUser | null;
  status: AuthStatus;
  /** Convenience — always `status === "loading"`. */
  isLoading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refreshUser = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    setStatus((current) => (current === "authenticated" ? current : "loading"));
    try {
      const currentUser = await authService.me();
      setUser(currentUser);
      setStatus("authenticated");
    } catch (error) {
      // A genuine 401 means the token is invalid/expired — `apiClient`'s
      // global 401 handler already clears it and starts a full-page
      // redirect to /login; mirrored here so this tab's own state can't
      // render stale "authenticated" content in the moment before that
      // navigation lands.
      if (error instanceof ApiError && error.status === 401) {
        clearAuthToken();
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      // Network/server error — the auth/permission state is unknown, not
      // empty. Never sign the user out over a transient failure, and never
      // let this look like "authenticated with zero permissions".
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe: boolean) => {
      const { accessToken } = await authService.login(email, password, rememberMe);
      setAuthToken(accessToken, rememberMe);
      await refreshUser();
    },
    [refreshUser],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Best-effort — the token is discarded locally regardless.
    }
    clearAuthToken();
    setUser(null);
    setStatus("unauthenticated");
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ user, status, isLoading: status === "loading", login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
