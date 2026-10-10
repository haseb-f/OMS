#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R15 — Production smoke checks after deploy, as the QA super admin (API; the browser pass is
 * r15-prod-browser.mjs). Read-only except:
 *   - the QA admin's own sign-in session (revoked by the final logout);
 *   - APPLY=1: the D15-20 stock backfill apply (open orders reserve / move to transit / mark) — run only
 *     after reviewing the dry run printed by a run without APPLY.
 *
 *   node scripts/acceptance/r15/r15-prod-smoke.mjs            (dry run)
 *   APPLY=1 node scripts/acceptance/r15/r15-prod-smoke.mjs    (apply the backfill)
 *
 * Password: tmp/.qa.env (QA_PASSWORD), never printed. Output: evidence/prod-smoke[-apply].json (order
 * numbers, codes and counts only — no customer data).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = (process.env.API ?? "https://oms.haseb.org/api").replace(/\/$/, "");
const APPLY = process.env.APPLY === "1";
const OUT = "specs/round15-completion/evidence";
mkdirSync(OUT, { recursive: true });
const pw = readFileSync("tmp/.qa.env", "utf8")
  .split(/\r?\n/)
  .find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "")
  .replace(/^["']|["']$/g, "")
  .trim();

const results = [];
const check = (name, ok, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ name, ok: !!ok, detail: (d ?? "").slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  -> " + d.slice(0, 240) : ""}`);
  return !!ok;
};

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: pw }),
});
const { accessToken } = await login.json();
check("qa-admin login 200", login.status === 200, login.status);
const auth = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { s: r.status, j };
};
const get = (path) => call("GET", path);
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));

// 1. The R15 permission catalogue (migrations + provisioning ran).
const catalog = JSON.stringify((await get("/permissions/catalog")).j ?? {});
for (const key of [
  "crm.leads.import",
  "store-orders.import",
  "agent.leads.import",
  "agent.orders.import",
  "reports.sales.view",
  "reports.sales.view_all",
  "shipping.receive_returns",
  "sales.receipts.reverse",
  "company-partners.users.manage",
]) {
  check(`permission catalogue has ${key}`, catalog.includes(`"${key}"`));
}

// 2. System warehouses (D15-4).
const warehouses = list((await get("/warehouses?page=1&pageSize=100")).j);
for (const [code, role] of [
  ["WH-TRANSIT", "TRANSIT"],
  ["WH-DAMAGED", "DAMAGED"],
]) {
  const w = warehouses.find((x) => x.code === code);
  check(
    `${code} exists with role ${role}`,
    w?.role === role,
    w ? `${w.code} ${w.role}` : "missing",
  );
}

// 3. Agent shipping agreements migrated from the commission tariffs (D15-13).
const agents = list((await get("/agents?page=1&pageSize=50")).j);
const agentReport = [];
for (const a of agents) {
  const r = await get(`/agents/${a.id}/shipping-agreements`);
  const items = list(r.j);
  agentReport.push({
    agent: a.agentNumber,
    status: a.status,
    http: r.s,
    agreements: items.map(
      (x) => `${x.agreementNumber}/${x.status}/rates=${x.rates?.length ?? x.rateCount ?? "?"}`,
    ),
  });
}
check(
  "shipping agreements readable for every agent",
  agentReport.every((a) => a.http === 200),
  agentReport,
);
for (const code of ["AG-0001", "AG-0002"]) {
  const a = agentReport.find((x) => x.agent === code);
  check(
    `${code}: its old tariff became an ACTIVE shipping agreement (ASA-…)`,
    a?.agreements.some((x) => /^ASA-.*\/ACTIVE\//.test(x)),
    a?.agreements ?? "agent missing",
  );
}

// 4. Store orders before / after the stock backfill (D15-20).
const totals = {};
for (const st of ["PENDING", "RESERVED", "SHORT", "IN_TRANSIT", "DELIVERED", "NOT_REQUIRED"]) {
  const r = await get(`/store-orders?page=1&pageSize=1&stockStatus=${st}`);
  totals[st] = r.j?.total ?? null;
}
check(
  "store-order stock-status filter answers",
  Object.values(totals).every((v) => v !== null),
  totals,
);

const dry = await call("POST", "/store-orders/stock-backfill", { dryRun: true });
const summarize = (rep) => ({
  summary: rep?.summary,
  orders: (rep?.orders ?? []).map((o) => ({
    order: o.internalOrderId,
    agent: o.isAgentOrder,
    action: o.action,
    before: o.before,
    ledger: o.ledgerState,
    after: o.after,
    short: o.short?.length ?? 0,
    error: o.error ? String(o.error).slice(0, 160) : undefined,
  })),
});
check("stock backfill dry run 200 (super admin)", dry.s === 200, dry.s);
check("dry run reports no failure", (dry.j?.summary?.failed ?? 1) === 0, dry.j?.summary);
let applied = null;
if (APPLY) {
  const ap = await call("POST", "/store-orders/stock-backfill", { dryRun: false });
  applied = summarize(ap.j);
  check("stock backfill APPLY 200", ap.s === 200, ap.s);
  check("apply reports no failure", (ap.j?.summary?.failed ?? 1) === 0, ap.j?.summary);
  const again = await call("POST", "/store-orders/stock-backfill", { dryRun: true });
  check(
    "after apply: a new dry run finds no pending order (idempotent)",
    again.s === 200 && again.j?.summary?.candidates === 0,
    again.j?.summary,
  );
  // D15-20 (owner approved 2026-10-10): the R14 recognition repair — a delivered, never-recognised order is
  // invoiced and issued from its warehouse (its backfill reservation released).
  const rp = await call("POST", "/store-orders/recognition-repair", { dryRun: false });
  applied.repair = {
    summary: rp.j?.summary,
    orders: (rp.j?.orders ?? []).map((e) => ({ order: e.internalOrderId, result: e.result })),
  };
  check("recognition repair APPLY 200", rp.s === 200, rp.s);
  check("repair reports no failure", (rp.j?.summary?.failed ?? 1) === 0, rp.j?.summary);
  const rpAgain = await call("POST", "/store-orders/recognition-repair", { dryRun: true });
  check(
    "after the repair: nothing left to recognise",
    rpAgain.s === 200 && (rpAgain.j?.summary?.recognizable ?? 1) === 0,
    rpAgain.j?.summary,
  );
  const after = {};
  for (const st of ["PENDING", "RESERVED", "SHORT", "IN_TRANSIT", "DELIVERED", "NOT_REQUIRED"]) {
    after[st] = (await get(`/store-orders?page=1&pageSize=1&stockStatus=${st}`)).j?.total ?? null;
  }
  applied.stockTotalsAfter = after;
  check("after apply: no order left PENDING", after.PENDING === 0, after);
}

// 5. Boundaries that need no data.
const pp = await get("/partner-portal/me");
check("internal token on /partner-portal/me → refused", pp.s === 403 || pp.s === 401, pp.s);
const rep = await get("/sales-reports/performance");
check("sales report answers for the super admin", rep.s === 200, `${rep.s} scope=${rep.j?.scope}`);

const out = await fetch(`${API}/auth/logout`, { method: "POST", headers: auth });
check("logout", out.status < 300, out.status);

writeFileSync(
  `${OUT}/prod-smoke${APPLY ? "-apply" : ""}.json`,
  JSON.stringify(
    {
      api: API,
      at: new Date().toISOString(),
      results,
      agents: agentReport,
      stockTotalsBefore: totals,
      dryRun: summarize(dry.j),
      applied,
    },
    null,
    2,
  ),
);
const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} passed${APPLY ? " (APPLY)" : " (dry run)"}`,
);
