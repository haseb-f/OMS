import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";

const me = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/services/auth-service", () => ({
  authService: { me: () => me(), login: vi.fn(), logout: vi.fn() },
}));

import { AuthProvider, useAuth } from "./auth-provider";
import { CompanyProvider } from "./company-provider";
import { __resetSessionChannelForTests } from "@/lib/session-sync";
import { clientCacheStats } from "@/lib/client-data-scope";
import * as apiClient from "@/services/api-client";

function setCookieToken(token: string | null) {
  document.cookie = token ? `oms_token=${token}; path=/` : "oms_token=; path=/; max-age=0";
}

function userFor(id: string, companyId = "c1") {
  return {
    id,
    email: `${id}@example.test`,
    username: id,
    fullName: id,
    jobTitle: null,
    mustChangePassword: false,
    roles: [],
    isSuperAdmin: false,
    permissions: [],
    companies: [
      {
        id: companyId,
        name: companyId,
        code: companyId,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        branches: [],
        defaultBranchId: null,
      },
    ],
  };
}

describe("SEC-03 M1 — cross-tab identity change (AuthProvider)", () => {
  const reload = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    __resetSessionChannelForTests();
    reload.mockReset();
    me.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload, pathname: "/sales/orders" },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    setCookieToken(null);
    __resetSessionChannelForTests();
  });

  function Probe({ onUser }: { onUser: (id: string | null) => void }) {
    const { user } = useAuth();
    useEffect(() => {
      onUser(user?.id ?? null);
    }, [user, onUser]);
    return null;
  }

  async function bootAs(id: string) {
    setCookieToken(`t-${id}`);
    me.mockResolvedValue(userFor(id));
    const seen: (string | null)[] = [];
    render(
      <AuthProvider>
        <Probe onUser={(value) => seen.push(value)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(seen).toContain(id));
  }

  it("DENIED: another tab signed in as someone else → caches reset + hard reload on focus", async () => {
    await bootAs("admin");
    const resetsBefore = clientCacheStats().resets;
    setCookieToken("t-agent");
    me.mockResolvedValue(userFor("agent"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(clientCacheStats().resets).toBeGreaterThan(resetsBefore);
  });

  it("DENIED: another tab logged out → reload (proxy then lands on /login)", async () => {
    await bootAs("admin");
    setCookieToken(null);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("ALLOWED: focus with the same session does nothing", async () => {
    await bootAs("admin");
    const calls = me.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(reload).not.toHaveBeenCalled();
    expect(me.mock.calls.length).toBe(calls);
  });
});

describe("SEC-03 L3 — company headers switch before child fetch effects", () => {
  it("a child's passive effect already sees the new company context", async () => {
    const spy = vi.spyOn(apiClient, "setActiveCompanyContext");
    const seenAtEffect: string[] = [];
    let setUserCompany: ((id: string) => void) | null = null;

    function Child() {
      const { user } = useAuth();
      useEffect(() => {
        const last = spy.mock.calls.at(-1)?.[0];
        if (user) seenAtEffect.push(`${user.companies[0].id}:${last}`);
      }, [user]);
      return null;
    }

    setCookieToken("t-admin");
    me.mockResolvedValue(userFor("admin", "c1"));
    function Harness() {
      const { refreshUser } = useAuth();
      setUserCompany = (id: string) => {
        me.mockResolvedValue(userFor("admin", id));
        void refreshUser();
      };
      return null;
    }
    render(
      <AuthProvider>
        <CompanyProvider>
          <Harness />
          <Child />
        </CompanyProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(seenAtEffect).toContain("c1:c1"));
    localStorage.clear();
    await act(async () => {
      setUserCompany?.("c2");
    });
    await waitFor(() => expect(seenAtEffect).toContain("c2:c2"));
    expect(seenAtEffect.every((entry) => entry.split(":")[0] === entry.split(":")[1])).toBe(true);
    spy.mockRestore();
    setCookieToken(null);
  });
});
