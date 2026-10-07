"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { authService, type AuthUser, type CurrentUser } from "@/services/auth-service";
import { ApiError } from "@/services/api-client";
import { getAuthToken, setAuthToken, clearAuthToken } from "@/lib/auth-token";
import {
  ANONYMOUS_FINGERPRINT,
  clearPerUserBrowserStorage,
  resetClientDataCaches,
  setIdentityFingerprint,
} from "@/lib/client-data-scope";
import {
  answerPresencePings,
  clearTabSession,
  detectRestoredSession,
  markTabSession,
} from "@/lib/browser-session";
import { LOGOUT_REDIRECT_PATH } from "@/navigation/post-login";
import {
  announceSessionChange,
  createSessionIdentityGuard,
  resetAndReload,
  subscribeSessionSignals,
} from "@/lib/session-sync";

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
  /** Resolves with the signed-in user (incl. `userType`) once `/auth/me` has loaded. */
  login: (email: string, password: string) => Promise<AuthUser>;
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
    let cancelled = false;
    void (async () => {
      // R14 (spec-1 §2) — a cookie that outlived the browser (no tab marker,
      // no other live tab answering within 400 ms) is signed out server-side
      // and sent to the bare login page instead of resuming the session.
      if (getAuthToken() && (await detectRestoredSession()) === "restored") {
        try {
          await authService.logout();
        } catch {
          // Best-effort revoke — the session also ends by idle/absolute expiry.
        }
        clearAuthToken();
        clearPerUserBrowserStorage();
        if (!cancelled) window.location.replace(LOGOUT_REDIRECT_PATH);
        return;
      }
      if (!cancelled) await refreshUser();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Answer other tabs' "is the session still open?" handshake while signed in.
  useEffect(() => answerPresencePings(() => Boolean(getAuthToken())), []);

  // SEC-03 M1 — this tab renders for exactly one identity. When another tab
  // logs out or signs in as someone else (the token cookie is shared), drop
  // every cache and hard-reload instead of showing the previous identity's
  // mounted state under the new session.
  const identityGuard = useMemo(
    () =>
      createSessionIdentityGuard({
        readToken: getAuthToken,
        fetchUserId: async () => {
          try {
            return (await authService.me()).id;
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) return null;
            throw error;
          }
        },
        onMismatch: resetAndReload,
      }),
    [],
  );
  const userId = user?.id ?? null;
  useEffect(() => {
    if (status === "authenticated") identityGuard.adopt(getAuthToken(), userId);
    else if (status === "unauthenticated") identityGuard.adopt(null, null);
  }, [identityGuard, status, userId]);
  useEffect(() => subscribeSessionSignals(() => void identityGuard.verify()), [identityGuard]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken, user: signedIn } = await authService.login(email, password);
      // SEC-02: nothing cached before this login (another user's session in
      // this tab, or the anonymous login page) survives into the new one.
      resetClientDataCaches();
      setAuthToken(accessToken);
      markTabSession();
      await refreshUser();
      announceSessionChange();
      return signedIn;
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
    clearTabSession();
    // SEC-02: drop every per-identity client cache and the per-user browser
    // storage BEFORE the next user can sign in in this same tab.
    clearPerUserBrowserStorage();
    if (!setIdentityFingerprint(ANONYMOUS_FINGERPRINT)) resetClientDataCaches();
    setUser(null);
    setStatus("unauthenticated");
    announceSessionChange();
    // Never `?next=` after a deliberate sign-out (D1-2).
    router.push(LOGOUT_REDIRECT_PATH);
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
