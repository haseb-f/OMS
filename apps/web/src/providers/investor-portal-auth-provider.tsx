"use client";

/**
 * Investor Portal's own auth context — deliberately separate from the
 * internal `AuthProvider` (mission Part 18/22/52). Scoped only to the
 * `/investor/*` route group (see `src/app/investor/layout.tsx`), not the
 * global `AppProviders`, so an internal admin session and a Portal session
 * never share any React state either.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  investorPortalAuthService,
  investorPortalService,
  type PortalMe,
} from "@/services/investor-portal-service";
import { ApiError } from "@/services/api-client";
import {
  getInvestorPortalToken,
  setInvestorPortalToken,
  clearInvestorPortalToken,
} from "@/lib/investor-portal-token";

export type InvestorPortalAuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface InvestorPortalAuthContextValue {
  investor: PortalMe | null;
  status: InvestorPortalAuthStatus;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshInvestor: () => Promise<void>;
}

const InvestorPortalAuthContext = createContext<InvestorPortalAuthContextValue | null>(null);

export function InvestorPortalAuthProvider({ children }: { children: ReactNode }) {
  const [investor, setInvestor] = useState<PortalMe | null>(null);
  const [status, setStatus] = useState<InvestorPortalAuthStatus>("loading");

  const refreshInvestor = useCallback(async () => {
    if (!getInvestorPortalToken()) {
      setInvestor(null);
      setStatus("unauthenticated");
      return;
    }
    setStatus((current) => (current === "authenticated" ? current : "loading"));
    try {
      const me = await investorPortalService.me();
      setInvestor(me);
      setStatus("authenticated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearInvestorPortalToken();
        setInvestor(null);
        setStatus("unauthenticated");
        return;
      }
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshInvestor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await investorPortalAuthService.login(email, password);
      setInvestorPortalToken(accessToken);
      await refreshInvestor();
    },
    [refreshInvestor],
  );

  const logout = useCallback(() => {
    clearInvestorPortalToken();
    setInvestor(null);
    setStatus("unauthenticated");
    if (typeof window !== "undefined") {
      window.location.href = "/investor/login";
    }
  }, []);

  return (
    <InvestorPortalAuthContext.Provider
      value={{ investor, status, isLoading: status === "loading", login, logout, refreshInvestor }}
    >
      {children}
    </InvestorPortalAuthContext.Provider>
  );
}

export function useInvestorPortalAuth() {
  const context = useContext(InvestorPortalAuthContext);
  if (!context) {
    throw new Error("useInvestorPortalAuth must be used within an InvestorPortalAuthProvider");
  }
  return context;
}
