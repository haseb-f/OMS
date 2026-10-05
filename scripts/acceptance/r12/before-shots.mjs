#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R12 — "before" screenshots from the R11 review stack (web :4601 / API :4605),
 * i.e. the state this round started from: dark-blue form dropdowns, a separate
 * "Search by phone/order number" button, KPI tiles / detail rows on agent screens.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:4601";
const API = process.env.API ?? "http://localhost:4605";
const OUT = "D:/Systems/OMS/specs/round12-contextual-ui/evidence";
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;
const browser = await chromium.launch();
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  await ctx.addInitScript(() => {
    localStorage.setItem("oms.locale", JSON.stringify("ar"));
    localStorage.setItem("theme", "light");
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  while (new URL(page.url()).pathname.includes("/login")) await page.waitForTimeout(300);
  return { ctx, page };
}
const settle = async (page, ms = 1500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

{
  const { ctx, page } = await session("demo-r7-sales-b@oms.local");
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.screenshot({ path: `${OUT}/before-store-orders-two-lookup-buttons.png`, clip: { x: 0, y: 60, width: 1200, height: 130 } });
  await page.getByRole("button", { name: /طلب جديد|New Order/ }).first().click();
  await page.locator('[role="dialog"]').first().waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/before-order-form-desktop.png` });
  await ctx.close();
}
{
  const { ctx, page } = await session("demo-r7-admin@oms.local");
  const t = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo-r7-admin@oms.local", password: PW }) })).json()).accessToken;
  const agents = (await (await fetch(`${API}/agents?pageSize=5`, { headers: { Authorization: "Bearer " + t } })).json()).items;
  await page.goto(`${BASE}/agents/${agents[0].id}`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  await page.screenshot({ path: `${OUT}/before-agent-overview.png` });
  await ctx.close();
}
{
  const { ctx, page } = await session("agent-a-admin.demo-agt@oms.local");
  await page.goto(`${BASE}/agent/statement`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  await page.screenshot({ path: `${OUT}/before-agent-statement-portal.png` });
  await ctx.close();
}
await browser.close();
console.log("before shots done");
