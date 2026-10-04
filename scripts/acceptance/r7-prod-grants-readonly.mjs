#!/usr/bin/env node
/**
 * R7 - READ-ONLY audit of who holds the wide sales permissions in a deployed
 * environment. Logs in as the QA admin persona (credentials from the
 * environment or tmp/.qa.env, never printed) and only issues GET requests.
 *
 *   node scripts/acceptance/r7-prod-grants-readonly.mjs
 *   BASE=https://oms.haseb.org OUT=tmp/r7-grants.json node ...
 *
 * Output: a redacted summary (counts + role-less identifiers) to stdout and the
 * per-user rows to OUT (default tmp/r7-prod-grants.json, git-ignored).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(resolve(ROOT, "tmp/.qa.env"));
loadEnvFile(resolve(process.cwd(), "tmp/.qa.env"));
loadEnvFile("D:/Systems/OMS/tmp/.qa.env");

const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = (process.env.API ?? `${BASE}/api`).replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PW = process.env.PW ?? process.env.QA_PASSWORD ?? "";
const OUT = resolve(ROOT, process.env.OUT ?? "tmp/r7-prod-grants.json");

const WIDE = ["crm.leads.manage", "store-orders.manage", "store-orders.view_all", "crm.leads.edit", "shipping.view", "finance.view", "customers.lookup_global", "orders.lookup_global", "customers.lookup_advanced"];

async function main() {
  if (!PW) throw new Error("no password (tmp/.qa.env QA_PASSWORD)");
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW, rememberMe: false }),
  });
  const body = await login.json().catch(() => ({}));
  if (!body.accessToken) throw new Error(`login failed: ${login.status}`);
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${body.accessToken}` } });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const users = [];
  for (let page = 1; page <= 20; page++) {
    const r = await get(`/users?page=${page}&limit=100`);
    const rows = Array.isArray(r.json) ? r.json : (r.json?.data ?? r.json?.items ?? []);
    if (!rows.length) break;
    users.push(...rows);
    if (rows.length < 100) break;
  }
  const rows = [];
  for (const u of users) {
    if (u.userType && u.userType !== "INTERNAL") continue;
    const perms = await get(`/users/${u.id}/permissions`);
    const names = new Set(
      (Array.isArray(perms.json) ? perms.json : (perms.json?.granted ?? perms.json?.permissions ?? [])).map((p) => (typeof p === "string" ? p : p.name)),
    );
    rows.push({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      active: u.isActive,
      locked: u.isLocked,
      department: u.department?.name ?? u.departmentId ?? null,
      jobTitle: u.jobTitle?.name ?? u.jobTitleId ?? null,
      salesDistributionEligible: u.salesDistributionEligible ?? null,
      held: WIDE.filter((p) => names.has(p)),
      permissionCount: names.size,
    });
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), api: API, rows }, null, 2));

  const count = (p) => rows.filter((r) => r.held.includes(p)).length;
  console.log(JSON.stringify({
    api: API,
    internalUsers: rows.length,
    holders: Object.fromEntries(WIDE.map((p) => [p, count(p)])),
    leadsEditNotFlagged: rows.filter((r) => r.active && !r.locked && r.held.includes("crm.leads.edit") && r.salesDistributionEligible === false).length,
    flaggedEligible: rows.filter((r) => r.salesDistributionEligible === true).length,
    out: OUT,
  }, null, 2));
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
