#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R14 — Production smoke checks after deploy. Read-only apart from the QA admin's own sign-in
 * session (created at login, revoked by the final logout). Never applies the recognition repair.
 *
 *   node scripts/acceptance/r14/r14-prod-smoke.mjs          (API defaults to Production)
 *
 * Password: tmp/.qa.env (QA_PASSWORD), never printed. Output: evidence/prod-smoke.json
 * (the dry-run report keeps order numbers and counts only — no customer data).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = (process.env.API ?? "https://oms.haseb.org/api").replace(/\/$/, "");
const WEB = API.replace(/\/api$/, "");
const OUT = "specs/round14-production-readiness/evidence";
mkdirSync(OUT, { recursive: true });
const pw = readFileSync("tmp/.qa.env", "utf8")
  .split(/\r?\n/)
  .find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "")
  .replace(/^["']|["']$/g, "")
  .trim();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 220) : ""}`,
  );
};

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: pw, rememberMe: true }),
});
const { accessToken } = await login.json();
check("login 200", login.status === 200, login.status);
const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
check("token carries a server session id (sid)", typeof claims.sid === "string");
check(
  "session lifetime is 12 h even with rememberMe:true",
  claims.exp - claims.iat === 12 * 3600,
  `${(claims.exp - claims.iat) / 3600} h`,
);
const auth = { Authorization: `Bearer ${accessToken}` };
const get = (path) => fetch(`${API}${path}`, { headers: auth });

const me = await get("/auth/me");
const meBody = await me.json();
check("/auth/me 200", me.status === 200, me.status);

const catalog = await (await get("/permissions/catalog")).json();
const names = JSON.stringify(catalog);
for (const p of [
  "shipping.assign_carrier",
  "job-titles.manage_permissions",
  "users.manage_permissions",
  "customers.view_financials",
  "company-partners.view",
]) {
  check(`permission catalog has ${p}`, names.includes(p));
}

for (const path of [
  "/store-orders?pageSize=1",
  "/company-partners/profiles",
  "/company-partners/periods",
  "/job-titles?pageSize=1",
  "/users?pageSize=1",
]) {
  const r = await get(path);
  check(`GET ${path} 200`, r.status === 200, r.status);
}

const list = await (await get("/store-orders?pageSize=1")).json();
const order = (list?.items ?? list?.data ?? [])[0];
if (order?.partnerId ?? order?.partner?.id) {
  const pid = order.partnerId ?? order.partner.id;
  const h = await get(`/customers/${pid}/history`);
  check("customer history endpoint 200", h.status === 200, h.status);
} else check("customer history endpoint (no order to probe)", true, "skipped — no store orders");

const repair = await fetch(`${API}/store-orders/recognition-repair`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ dryRun: true }),
});
const report = await repair.json();
check("recognition repair dry run 200", repair.status === 200, repair.status);
const summary = {
  dryRun: report.dryRun,
  counts: report.summary ?? null,
  orders: (report.orders ?? []).map((e) => ({
    order: e.internalOrderId,
    result: e.result,
    blockers: (e.blockers ?? []).map((b) => b.code ?? b),
  })),
  agentOrdersWithoutDispatch: (report.agentOrdersNotDispatched ?? []).map((o) => o.internalOrderId),
};
console.log("repair dry run:", JSON.stringify(summary).slice(0, 600));

const web = await fetch(`${WEB}/login`);
check("web /login 200", web.status === 200, web.status);

const out = await fetch(`${API}/auth/logout`, { method: "POST", headers: auth });
check("logout 2xx", out.status < 300, out.status);
const after = await get("/auth/me");
check("token refused after logout (server revocation)", after.status === 401, after.status);

writeFileSync(
  `${OUT}/prod-smoke.json`,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      api: API,
      user: meBody?.email ? "qa-admin" : null,
      results,
      repairDryRun: summary,
    },
    null,
    2,
  ),
);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
