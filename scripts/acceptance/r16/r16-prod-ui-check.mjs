#!/usr/bin/env node
/**
 * R16 UI — read-only Production check after deploy: the new sign-in page (50px fields, no copy action,
 * 16px touch inputs, no horizontal overflow after sign-in on a phone) and the agents overview /
 * management split. Signs in as the QA admin only (password from tmp/.qa.env, never printed); no writes.
 */
import { chromium, devices } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const browser = await chromium.launch();

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await desktop.newPage();
await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle");
const h = await page.locator('input[name="email"]').evaluate((el) => el.getBoundingClientRect().height);
check("login fields ≈50px", h >= 48 && h <= 52, `${h}px`);
check("no copy action on the sign-in password", (await page.getByRole("button", { name: /نسخ|Copy/ }).count()) === 0);
check("reveal / hide kept", (await page.getByRole("button", { name: /إظهار|Show/ }).count()) === 1);
await page.screenshot({ path: "specs/round16-ui/evidence/prod-login-desktop.png" });
await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
await page.locator('input[name="password"]').fill(PW);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
for (const path of ["/agents/overview", "/agents"]) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const title = await page.locator("h1").first().innerText().catch(() => "");
  check(`${path} renders its own page`, new URL(page.url()).pathname === path && title.length > 0, title);
}
await desktop.close();

const phone = await browser.newContext({ ...devices["Pixel 7"] });
page = await phone.newPage();
await page.goto(`${BASE}/login`);
await page.waitForLoadState("networkidle");
const font = await page.locator('input[name="email"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check("touch inputs are 16px (no focus zoom)", font >= 16, `${font}px`);
await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
await page.locator('input[name="password"]').fill(PW);
await page.locator('button[type="submit"]').tap();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
await page.waitForLoadState("networkidle");
const fit = await page.evaluate(() => ({
  scale: window.visualViewport?.scale ?? null,
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
check("after sign-in on a phone: scale 1, no horizontal overflow", fit.scale === 1 && fit.overflowX <= 0, JSON.stringify(fit));
await phone.close();
await browser.close();
writeFileSync("specs/round16-ui/evidence/prod-ui-check.json", JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
