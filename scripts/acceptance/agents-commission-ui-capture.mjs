#!/usr/bin/env node
/**
 * Commission policy correction — one visual pass over the affected pages
 * (specs/agents-fulfillment-partners/commission-policy.md). Local only:
 * reads QA passwords from tmp/.qa.env (never printed) and saves screenshots
 * to docs/user-guide/evidence/commission-20260929/.
 *
 * Env: WEB (default http://localhost:3011), AGENT_ID (agent with the A1
 * example), AGREEMENT_AGENT_ID + AGREEMENT_NUMBER (draft to preview),
 * PRODUCT_SKU (agent-owned product), PORTAL_EMAIL (agent admin user).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "docs/user-guide/evidence/commission-20260929");
const WEB = (process.env.WEB ?? "http://localhost:3011").replace(/\/$/, "");
const envFile = [resolve(ROOT, "tmp/.qa.env"), "D:/Systems/OMS/tmp/.qa.env"].find(existsSync);
const env = Object.fromEntries(
  (envFile ? readFileSync(envFile, "utf8") : "")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const QA_PW = process.env.QA_PASSWORD ?? env.QA_PASSWORD;
const AGENT_PW = process.env.AGENT_DEMO_PASSWORD ?? env.AGENT_DEMO_PASSWORD;
if (!QA_PW) throw new Error("QA_PASSWORD missing (env or tmp/.qa.env)");
mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log(...args);

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function login(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await settle(page);
}

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage });
  log(`saved ${name}.png`);
}

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    log(`SKIPPED ${name}: ${error.message.split("\n")[0]}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text().slice(0, 200)));
await login(page, "qa-admin@oms.haseb.org", QA_PW);

await step("commission tab", async () => {
  await page.goto(`${WEB}/agents/${process.env.AGENT_ID}?tab=commission`);
  await settle(page);
  await page.getByText("تقرير العمولة", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => {});
  await shot(page, "01-commission-report-internal");
});

await step("agreement preview", async () => {
  await page.goto(`${WEB}/agents/${process.env.AGREEMENT_AGENT_ID}?tab=agreements`);
  await settle(page);
  const row = page.locator("tr", { hasText: process.env.AGREEMENT_NUMBER }).first();
  await row.locator("button").last().click();
  await page.getByRole("menuitem", { name: /تفعيل/ }).click();
  await page.getByText("مستحق الشركة").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, "02-agreement-activation-preview", false);
  await page.keyboard.press("Escape");
});

await step("agreement form", async () => {
  const row = page.locator("tr", { hasText: process.env.AGREEMENT_NUMBER }).first();
  await row.locator("button").last().click();
  await page.getByRole("menuitem", { name: /تعديل/ }).click();
  await page.getByText("نسبة المنتجات المادية").first().waitFor({ timeout: 10000 });
  await shot(page, "03-agreement-form-rates", false);
  await page.keyboard.press("Escape");
});

await step("product commission", async () => {
  await page.goto(`${WEB}/products`);
  await settle(page);
  // The list's own filter box (the top bar search opens the command palette).
  const search = page.getByPlaceholder(/تصفية/).first();
  await search.fill(process.env.PRODUCT_SKU);
  await settle(page);
  const row = page.locator("tr", { hasText: process.env.PRODUCT_SKU }).first();
  await row.locator("button").last().click();
  await page.getByRole("menuitem", { name: /تعديل/ }).first().click();
  const history = page.getByText("سجل النسب الخاصة").first();
  await history.waitFor({ timeout: 10000 });
  await history.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, "04-product-commission-setting", false);
  await page.keyboard.press("Escape");
});

await step("carrier reconciliation", async () => {
  await page.goto(`${WEB}/finance/carrier-reconciliation`);
  await settle(page);
  await shot(page, "05-carrier-reconciliation-kinds-recovery");
});

await step("mobile commission tab", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/agents/${process.env.AGENT_ID}?tab=commission`);
  await settle(page);
  await shot(page, "06-commission-report-mobile");
});

if (process.env.PORTAL_EMAIL && AGENT_PW) {
  const portal = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" })
  ).newPage();
  await step("portal commission", async () => {
    await login(portal, process.env.PORTAL_EMAIL, AGENT_PW);
    await portal.goto(`${WEB}/agent/commission`);
    await settle(portal);
    await shot(portal, "07-agent-portal-commission");
  });
}

log(`console errors: ${consoleErrors.length}`);
for (const error of [...new Set(consoleErrors)].slice(0, 5)) log(`  ${error}`);
await browser.close();
