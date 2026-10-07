import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api-client";
import { markSigningOut, setAuthToken } from "@/lib/auth-token";

/**
 * R14 (D1-2) — a deliberate sign-out revokes the server session, so requests
 * still in flight answer 401. Those must not trigger the session-expiry
 * redirect (`/login?next=<page>`); only a genuine expiry does.
 */
describe("api-client 401 during a deliberate sign-out", () => {
  let assigned: string | null;

  beforeEach(() => {
    assigned = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "SESSION_REVOKED" }), { status: 401 })),
    );
    // Capture `window.location.href = …` without navigating jsdom.
    const location = { ...window.location, pathname: "/store-orders", search: "?page=2" };
    Object.defineProperty(location, "href", {
      get: () => "http://localhost/store-orders?page=2",
      set: (value: string) => {
        assigned = value;
      },
    });
    vi.stubGlobal("location", location);
    Object.defineProperty(window, "location", { value: location, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects to /login?next= on a genuine session expiry", async () => {
    setAuthToken("t");
    await apiClient.get("/auth/me").catch(() => undefined);
    expect(assigned).toBe(`/login?next=${encodeURIComponent("/store-orders?page=2")}`);
  });

  it("does not redirect while the user is signing out", async () => {
    setAuthToken("t");
    markSigningOut();
    await apiClient.get("/auth/me").catch(() => undefined);
    expect(assigned).toBeNull();
  });
});
