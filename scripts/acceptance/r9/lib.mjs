import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);
export const PW = env.R7_PW;
export const BASE = process.env.BASE ?? "http://localhost:4601";
export const API = process.env.API ?? "http://localhost:4605";
export const PERSONAS = {
  admin: "demo-r7-admin@oms.local",
  sales: "demo-r7-sales-a@oms.local",
  finance: "demo-r7-finance@oms.local",
  agentAdmin: "agent-a-admin.demo-agt@oms.local",
  agentSales: "agent-a-sales1.demo-agt@oms.local",
};

export async function login(ctx, email, next) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error("login stuck " + page.url());
    await page.waitForTimeout(400);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}

export async function apiToken(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW, rememberMe: false }),
  });
  const j = await r.json().catch(() => ({}));
  return j.accessToken ?? null;
}

export { chromium, mkdirSync };
