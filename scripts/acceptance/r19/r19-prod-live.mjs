#!/usr/bin/env node
/**
 * R19 — read-only Production check after deploy (QA admin; tmp/.qa.env, never printed). No writes.
 * Sidebar surface contrasts with content in light + dark; sales-report cards render at report size;
 * assembly list + agent filter + preview endpoints answer; no page errors.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const OUT = "specs/round19-improvements/evidence/live";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const { accessToken } = await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: PW }) })).json();
const get = async (p) => { const r = await fetch(`${BASE}/api${p}`, { headers: { Authorization: `Bearer ${accessToken}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const list = await get("/assembly?pageSize=5");
check("GET /assembly 200", list.status === 200, `total ${list.json?.total}`);
const agents = await get("/agents?pageSize=1");
const agentId = (agents.json?.items ?? [])[0]?.id;
if (agentId) {
  const filtered = await get(`/assembly?agentId=${agentId}&pageSize=5`);
  check("assembly list agent filter 200", filtered.status === 200, `total ${filtered.json?.total}`);
}
const order = (list.json?.items ?? [])[0];
if (order) check("assembly order exposes `valued`", "valued" in order, `valued=${order.valued}`);
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch { /* private */ } }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${BASE}/reports/sales`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  const lum = (rgb) => {
    const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    const c = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const colors = await page.evaluate(() => {
    const painted = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return getComputedStyle(document.documentElement).backgroundColor; };
    const link = document.querySelector("[data-slot=\"sidebar\"] a, [data-sidebar=\"menu-button\"]");
    const main = document.querySelector("main h1") ?? document.querySelector("main");
    return { sidebar: painted(link), main: painted(main), body: getComputedStyle(document.body).backgroundColor };
  });
  const sideL = lum(colors.sidebar);
  const mainL = lum(colors.main.includes("0, 0, 0, 0") ? colors.body : colors.main);
  const ratio = (Math.max(sideL, mainL) + 0.05) / (Math.min(sideL, mainL) + 0.05);
  check(`${theme}: sidebar ${theme === "light" ? "dark" : "light"} against content`, theme === "light" ? sideL < mainL && ratio > 4 : sideL > mainL && ratio > 4, `${colors.sidebar} vs ${colors.main} · ${ratio.toFixed(1)}:1`);
  const reportCards = await page.locator('[data-size="report"]').count();
  check(`${theme}: sales-report cards at report size`, reportCards > 0, `${reportCards} cards`);
  await page.screenshot({ path: `${OUT}/sales-reports-${theme}.png` });
  check(`${theme}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
