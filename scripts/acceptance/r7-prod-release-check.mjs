#!/usr/bin/env node
/**
 * R7 final — READ-ONLY Production release check (QA personas, GET requests only).
 * Proves on the deployed build: the new `store-orders.view_all` catalog row exists,
 * an ordinary sales persona sees only its own leads/orders and cannot read another
 * owner's order or its activities/shipments, the FX scheduler status is healthy and
 * the distribution eligibility list is served.
 *
 *   node scripts/acceptance/r7-prod-release-check.mjs            (BASE defaults to https://oms.haseb.org)
 *   SALES_EMAIL=qa-sales@... node scripts/acceptance/r7-prod-release-check.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const file of [resolve(ROOT, "tmp/.qa.env"), "D:/Systems/OMS/tmp/.qa.env"]) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = raw.indexOf("=");
    if (i > 0 && !raw.startsWith("#") && !process.env[raw.slice(0, i)]) process.env[raw.slice(0, i)] = raw.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  break;
}
const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = (process.env.API ?? `${BASE}/api`).replace(/\/$/, "");
const ADMIN = process.env.ADMIN_EMAIL ?? "qa-admin@oms.haseb.org";
const SALES = process.env.SALES_EMAIL ?? "qa-sales@oms.haseb.org";
const PW = process.env.PW ?? process.env.QA_PASSWORD ?? "";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, rememberMe: false }) });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${j.code ?? ""}`);
  return j.accessToken;
}
const get = async (token, path) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
};
const rowsOf = (j) => (Array.isArray(j) ? j : (j?.data ?? j?.items ?? j?.rows ?? []));

async function main() {
  if (!PW) throw new Error("no password (tmp/.qa.env QA_PASSWORD)");
  const admin = await login(ADMIN);
  const sales = await login(SALES);
  const me = await get(sales, "/auth/me");
  const salesId = me.json?.id ?? me.json?.user?.id;
  check("sales persona resolves its own user id", !!salesId, `http=${me.status}`);

  const catalog = await get(admin, "/permissions/catalog");
  const catalogText = JSON.stringify(catalog.json ?? {});
  check("catalog contains store-orders.view_all", catalogText.includes("store-orders.view_all"), `http=${catalog.status}`);

  const leads = await get(sales, "/leads?limit=200");
  const leadRows = rowsOf(leads.json);
  check("sales: every listed lead is own", leads.status === 200 && leadRows.every((l) => (l.salesEmployeeId ?? l.salesEmployee?.id) === salesId), `rows=${leadRows.length}`);

  const orders = await get(sales, "/store-orders?limit=200");
  const orderRows = rowsOf(orders.json);
  check("sales: every listed order is own", orders.status === 200 && orderRows.every((o) => (o.employeeId ?? o.employee?.id) === salesId), `rows=${orderRows.length}`);

  const all = await get(admin, "/store-orders?limit=200");
  const other = rowsOf(all.json).find((o) => (o.employeeId ?? o.employee?.id) && (o.employeeId ?? o.employee?.id) !== salesId && !o.agentId);
  if (other) {
    const byId = await get(sales, `/store-orders/${other.id}`);
    check("sales: another owner's order by id is 404", byId.status === 404, `http=${byId.status}`);
    const act = await get(sales, `/store-orders/${other.id}/activities`);
    check("sales: another owner's order activities are 404", act.status === 404, `http=${act.status}`);
    const ship = await get(sales, `/store-orders/${other.id}/shipments`);
    check("sales: another owner's order shipments are 403/404", ship.status === 404 || ship.status === 403, `http=${ship.status}`);
  } else {
    check("sales: another owner's order exists to test against", false, "no order owned by someone else found");
  }
  const own = orderRows[0];
  if (own) {
    const ownAct = await get(sales, `/store-orders/${own.id}/activities`);
    check("sales: own order activities are readable", ownAct.status === 200, `http=${ownAct.status}`);
  }

  const fx = await get(admin, "/exchange-rates/sync/status");
  check("fx: scheduler status healthy", fx.status === 200 && fx.json?.enabled === true && fx.json?.lastRun?.status === "SUCCESS", `enabled=${fx.json?.enabled} lastRun=${fx.json?.lastRun?.status} newest=${fx.json?.newestEffectiveDate}`);

  const dist = await get(admin, "/leads/distribution");
  check("distribution: eligibility payload served", dist.status === 200, `http=${dist.status}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed  (api=${API})`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
