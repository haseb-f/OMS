#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R11 / Workstream D — real-browser mobile audit of the shell routes (company
 * and agent), at 360 and 390 px, touch + mobile emulation (not screenshots):
 *   - page-level horizontal overflow
 *   - elements poking outside the viewport that are NOT inside a bounded scroll container
 *   - small touch targets (reported, not failed)
 *   - create dialogs: fit the viewport, footer actions reachable, one scroller
 *
 *   BASE=http://localhost:4601 API=http://localhost:4605 node scripts/acceptance/r11/mobile-audit.mjs
 * Password: tmp/r7-final/.r7.env (R7_PW). Output: specs/round11-entry-recognition/evidence/mobile-audit.json
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4601").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4605").replace(/\/$/, "");
const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;
const OUT = "D:/Systems/OMS-r9-brand-grid/specs/round11-entry-recognition/evidence";
mkdirSync(OUT, { recursive: true });

const COMPANY = JSON.parse(readFileSync("D:/Systems/OMS-r9-brand-grid/scripts/acceptance/r11/company-routes.json", "utf8"));
const AGENT = ["/agent", "/agent/dashboard", "/agent/leads", "/agent/orders", "/agent/orders/new", "/agent/stock", "/agent/statement", "/agent/commission", "/agent/payouts", "/agent/team"];

async function token(email) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).accessToken;
}
const get = async (t, p) => (await fetch(API + p, { headers: { Authorization: "Bearer " + t } })).json().catch(() => null);

const admin = await token("demo-r7-admin@oms.local");
const agent = await token("agent-a-admin.demo-agt@oms.local");
const first = async (t, p) => (await get(t, p))?.items?.[0]?.id;
const details = [
  ["/store-orders/", await first(admin, "/store-orders?pageSize=1")],
  ["/crm/leads/", await first(admin, "/leads?pageSize=1")],
  ["/sales/invoices/", await first(admin, "/sales/invoices?pageSize=1")],
  ["/sales/orders/", await first(admin, "/sales/orders?pageSize=1")],
  ["/sales/customers/", await first(admin, "/partners?pageSize=1&role=CUSTOMER")],
  ["/purchasing/purchase-orders/", await first(admin, "/purchase-orders?pageSize=1")],
].filter(([, id]) => id).map(([prefix, id]) => prefix + id);
const agentDetails = [
  ["/agent/orders/", await first(agent, "/agent-portal/orders?pageSize=1")],
  ["/agent/leads/", await first(agent, "/agent-portal/leads?pageSize=1")],
].filter(([, id]) => id).map(([prefix, id]) => prefix + id);

const audit = (opts) => {
  const vw = window.innerWidth;
  const isScrollable = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) {
        const r = n.getBoundingClientRect();
        if (r.width > 0 && r.right <= vw + 2 && r.left >= -2) return true;
      }
    }
    return false;
  };
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("[aria-hidden='true'], [hidden]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    if (el.classList.contains("sr-only") || el.closest(".sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 2 || r.left < -2) && !isScrollable(el)) {
      offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), text: (el.textContent || "").trim().slice(0, 30), right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width) });
    }
  }
  // keep only outermost offenders
  const top = offenders.filter((o, i) => !offenders.slice(0, i).some((p) => p.left <= o.left && p.right >= o.right && p.w >= o.w)).slice(0, 4);
  const small = [...document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select")].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && r.height < 30 && r.width < 200 && !el.closest(".sr-only");
  }).length;
  return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, offenders: top, smallTargets: small, vw };
};

async function login(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error("login stuck");
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

const browser = await chromium.launch();
const report = { generatedAt: new Date().toISOString(), widths: {}, dialogs: [] };
const widths = (process.env.WIDTHS ?? "390,360").split(",").map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

for (const width of widths) {
  const rows = [];
  for (const [persona, email, routes] of [
    ["company", "demo-r7-admin@oms.local", [...COMPANY, ...details]],
    ["agent", "agent-a-admin.demo-agt@oms.local", [...AGENT, ...agentDetails]],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ar" });
    const page = await login(ctx, email);
    for (const route of routes) {
      if (ONLY && !ONLY.some((o) => route.includes(o))) continue;
      try {
        const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(900);
        const m = await page.evaluate(audit);
        const bad = m.overflow > 0 || m.offenders.length > 0;
        rows.push({ persona, route, status: res?.status(), ...m, bad });
        console.log(`${bad ? "BAD " : "ok  "} ${width} ${persona.padEnd(7)} ${route.padEnd(48)} overflow=${m.overflow} offenders=${m.offenders.length} small=${m.smallTargets}`);
      } catch (error) {
        rows.push({ persona, route, error: String(error).slice(0, 120), bad: true });
        console.log(`ERR  ${width} ${persona} ${route} ${String(error).slice(0, 80)}`);
      }
    }
    await ctx.close();
  }
  report.widths[width] = rows;
}

// ── dialogs: reachable footer actions, fits the viewport, one scroller ──
const DIALOGS = [
  { persona: "company", email: "demo-r7-admin@oms.local", route: "/store-orders", open: /طلب جديد|New Order/ },
  { persona: "company", email: "demo-r7-admin@oms.local", route: "/crm/leads", open: /إضافة|Add New|جديد/ },
  { persona: "company", email: "demo-r7-admin@oms.local", route: "/sales/customers", open: /إضافة|Add New|جديد/ },
];
if (!ONLY) {
  for (const width of widths) {
    for (const d of DIALOGS) {
      const ctx = await browser.newContext({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ar" });
      const page = await login(ctx, d.email);
      await page.goto(`${BASE}${d.route}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);
      const trigger = page.getByRole("button", { name: d.open }).first();
      const row = { width, route: d.route, opened: false };
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForTimeout(900);
        const dlg = page.locator('[role="dialog"]').first();
        if (await dlg.count()) {
          row.opened = true;
          Object.assign(row, await page.evaluate(() => {
            const dlg = document.querySelector('[role="dialog"]');
            const r = dlg.getBoundingClientRect();
            const vh = window.innerHeight;
            const buttons = [...dlg.querySelectorAll("button")].filter((b) => /حفظ|إنشاء|إلغاء|Create|Save|Cancel/.test(b.textContent || ""));
            const reachable = buttons.map((b) => { const br = b.getBoundingClientRect(); return br.bottom <= vh + 1 && br.top >= 0 && br.right <= window.innerWidth + 1 && br.left >= -1; });
            const scrollers = [...dlg.querySelectorAll("*")].filter((n) => { const cs = getComputedStyle(n); return /(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2; }).length;
            return { fitsWidth: r.left >= -1 && r.right <= window.innerWidth + 1, fitsHeight: r.top >= -1 && r.bottom <= vh + 1, footerButtons: buttons.length, footerReachable: reachable.length > 0 && reachable.every(Boolean), scrollers, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
          }));
          await page.screenshot({ path: `${OUT}/mobile-dialog-${d.route.replace(/\//g, "-")}-${width}.png` });
        }
      }
      report.dialogs.push(row);
      console.log(`${row.opened && row.fitsWidth && row.footerReachable ? "ok  " : "BAD "} dialog ${width} ${d.route} ${JSON.stringify(row)}`);
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(`${OUT}/mobile-audit${ONLY ? "-partial" : ""}.json`, JSON.stringify(report, null, 2));
const bad = Object.values(report.widths).flat().filter((r) => r.bad);
console.log(`\n${bad.length} route/width combinations with a problem, of ${Object.values(report.widths).flat().length}`);
