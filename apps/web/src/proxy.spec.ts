// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

/** An unsigned token carrying only the claims the proxy reads (routing, never authorization). */
function token(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

function visit(path: string, claims?: Record<string, unknown>) {
  const request = new NextRequest(new URL(path, "https://oms.test"));
  if (claims) request.cookies.set("oms_token", token(claims));
  const response = proxy(request);
  const location = response.headers.get("location");
  return location ? new URL(location).pathname : null;
}

/** R15 (D15-14) — the proxy keeps a partner login in its own zone. */
describe("proxy — partner audience", () => {
  const partner = { sub: "u", typ: "partner", companyPartnerId: "p" };

  it("sends a signed-in partner from the login page to the partner portal", () => {
    expect(visit("/login", partner)).toBe("/partner");
    expect(visit("/login", { sub: "u", typ: "agent" })).toBe("/agent");
    expect(visit("/login", { sub: "u" })).toBe("/");
  });

  it("redirects a partner from any staff or agent page to /partner", () => {
    for (const path of [
      "/",
      "/dashboard",
      "/company-partners",
      "/modules/finance",
      "/agent/orders",
    ]) {
      expect([path, visit(path, partner)]).toEqual([path, "/partner"]);
    }
  });

  it("lets a partner open its portal, its own profile / password and the print preview", () => {
    for (const path of ["/partner", "/partner/statement", "/profile/password", "/print/list"]) {
      expect([path, visit(path, partner)]).toEqual([path, null]);
    }
  });

  it("never moves staff because of the partner zone", () => {
    expect(visit("/company-partners", { sub: "u" })).toBeNull();
    expect(visit("/dashboard", { sub: "u", typ: "agent" })).toBeNull();
  });
});
