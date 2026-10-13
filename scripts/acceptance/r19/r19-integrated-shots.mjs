#!/usr/bin/env node
/**
 * R19 — integrated preview screenshots (A + B + C on one local build).
 *   BASE=http://localhost:3001 node scripts/acceptance/r19/r19-integrated-shots.mjs
 * Demo personas of the R15 manual clone; password from tmp/r15-manual/.env (never printed).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const OUT = "specs/round19-improvements/evidence/integrated";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const browser = await chromium.launch();
const shots = [];
async function shoot(name, email, path, { locale = "ar", theme = "light", device = null, after } = {}) {
  const ctx = await browser.newContext({ ...(device ?? { viewport: { width: 1440, height: 900 } }), colorScheme: theme });
  await ctx.addInitScript(([l, th]) => {
    try { localStorage.setItem("oms.locale", JSON.stringify(l)); localStorage.setItem("theme", th); } catch { /* private */ }
  }, [locale, theme]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  if (after) await after(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  for (let i = 0; i < 4; i++) {
    try { await page.screenshot({ path: `${OUT}/${name}.png` }); break; } catch { await page.waitForTimeout(500 * (i + 1)); }
  }
  shots.push({ name, overflow });
  console.log(`${overflow ? "OVERFLOW" : "ok"}  ${name}`);
  await ctx.close();
}
const admin = "admin@oms-demo.local";
await shoot("1-sales-live-ar-light", admin, "/reports/sales");
await shoot("2-sales-live-ar-dark", admin, "/reports/sales", { theme: "dark" });
await shoot("3-sales-employees-en-light", admin, "/reports/sales?tab=employees", { locale: "en" });
await shoot("4-agent-reports-ar-light", "agent@oms-demo.local", "/agent/reports");
await shoot("5-sales-live-ar-375", admin, "/reports/sales", { device: devices["iPhone 13"] });
await shoot("6-mobile-drawer-ar-dark", admin, "/reports/sales", {
  theme: "dark",
  device: devices["iPhone 13"],
  after: async (page) => {
    await page.locator('[data-sidebar="trigger"], button[aria-label*="القائمة"], button[aria-label*="menu" i]').first().click().catch(() => {});
    await page.waitForTimeout(800);
  },
});
await shoot("7-assembly-list-ar-light", admin, "/inventory/assembly");
await shoot("8-assembly-list-ar-dark", admin, "/inventory/assembly", { theme: "dark" });
await browser.close();
console.log(JSON.stringify(shots));
