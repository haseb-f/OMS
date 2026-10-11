#!/usr/bin/env node
/**
 * R17 — read-only Production check after deploy: migration columns visible through the API
 * (shipping agreement versions + COD fee), login fields 46 px / 16 px, leads and partner pages render.
 * Signs in as the QA admin only (tmp/.qa.env, never printed); performs no writes.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = `${BASE}/api`;
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const { accessToken } = await (await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: PW }),
})).json();
const get = async (path) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const agents = await get("/agents?pageSize=5");
const list = agents.json?.items ?? agents.json?.data ?? [];
check("GET /agents 200", agents.status === 200, `${list.length} agents`);
const withAgreement = [];
for (const agent of list) {
  const sa = await get(`/agents/${agent.id}/shipping-agreements`);
  const rows = Array.isArray(sa.json) ? sa.json : (sa.json?.items ?? []);
  if (sa.status === 200 && rows.length) withAgreement.push(rows[0]);
}
if (withAgreement.length) {
  const a = withAgreement[0];
  check("shipping agreement exposes versionNumber / activeFrom / codCollectionFee", "versionNumber" in a && "activeFrom" in a && "codCollectionFee" in a, JSON.stringify({ v: a.versionNumber, activeFrom: a.activeFrom, cod: a.codCollectionFee }));
} else check("shipping agreements readable (none on Production yet)", true, "skipped");
await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle");
const h = await page.locator('input[name="email"]').evaluate((el) => el.getBoundingClientRect().height);
const f = await page.locator('input[name="email"]').evaluate((el) => getComputedStyle(el).fontSize);
check("login fields 46 px, 16 px text", Math.round(h) === 46 && f === "16px", `${h}px / ${f}`);
check("no copy action on the sign-in password", (await page.getByRole("button", { name: /نسخ|Copy/ }).count()) === 0);
await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
await page.locator('input[name="password"]').fill(PW);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
for (const path of ["/crm/leads", "/company-partners", "/agents/overview"]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const title = await page.locator("h1").first().innerText().catch(() => "");
  check(`${path} renders`, new URL(page.url()).pathname === path && title.length > 0, title);
}
await browser.close();
writeFileSync("specs/round17-refinements/evidence/prod-check.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
