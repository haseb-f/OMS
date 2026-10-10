#!/usr/bin/env node
/**
 * R16 UI — before/after screenshots and measurements for the three UI specs.
 *
 *   PHASE=before|after BASE=http://localhost:3001 node scripts/acceptance/r16/r16-ui-shots.mjs
 *
 * Personas are the clean demo users of the R15 manual database (oms_r16_ui clone); the password is read
 * from tmp/r15-manual/.env at runtime and never written out. Password inputs are blanked before shots.
 * Output: specs/round16-ui/evidence/<phase>/*.png + metrics.json.
 * Mobile checks run in Chromium device emulation (isMobile + hasTouch); iOS Safari focus-zoom itself is not
 * reproducible here — the measured cause (input font-size < 16px on touch) is reported instead.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const PHASE = process.env.PHASE ?? "before";
const ONLY = process.env.ONLY;
const OUT = `specs/round16-ui/evidence/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const metrics = {};
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { ...devices["Pixel 7"], locale: "ar" };
const PHONE_LANDSCAPE = { ...devices["Pixel 7 landscape"], locale: "ar" };

const browser = await chromium.launch();
async function context(opts = {}, { locale = "ar", scheme = "light" } = {}) {
  const ctx = await browser.newContext({ ...DESKTOP, ...opts, colorScheme: scheme });
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {
      // private mode — default locale
    }
  }, locale);
  return ctx;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const settle = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
};
const blankPasswords = (page) =>
  page.evaluate(() => document.querySelectorAll('input[type="password"]').forEach((el) => (el.value = "")));
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await settle(page);
}
const viewportMetrics = (page) =>
  page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? null,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
const inputFont = (page, selector) =>
  page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const run = async (name, fn) => {
  if (ONLY && !ONLY.split(",").some((p) => name.startsWith(p))) return;
  try {
    await fn();
    console.log("done", name);
  } catch (error) {
    console.log("FAILED", name, error?.message ?? error);
    metrics[`${name}:error`] = String(error?.message ?? error).slice(0, 300);
  }
};

// ── S1 login ─────────────────────────────────────────────────────────────
for (const [locale, scheme] of [["ar", "light"], ["ar", "dark"], ["en", "light"]]) {
  await run(`s1-login-desktop-${locale}-${scheme}`, async () => {
    const ctx = await context({}, { locale, scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await settle(page);
    metrics[`login-desktop-${locale}-${scheme}`] = {
      inputHeight: await page.locator('input[name="email"]').evaluate((el) => el.getBoundingClientRect().height),
      copyButtons: await page.getByRole("button", { name: /نسخ|Copy/ }).count(),
      revealButtons: await page.getByRole("button", { name: /إظهار|Show/ }).count(),
    };
    await shot(page, `s1-login-desktop-${locale}-${scheme}`);
    await ctx.close();
  });
}
for (const [label, device] of [["portrait", PHONE], ["landscape", PHONE_LANDSCAPE]]) {
  await run(`s1-login-mobile-${label}`, async () => {
    const ctx = await context(device);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await settle(page);
    await shot(page, `s1-login-mobile-${label}`);
    const before = await viewportMetrics(page);
    await page.locator('input[name="email"]').tap();
    const fontEmail = await inputFont(page, 'input[name="email"]');
    const fontPassword = await inputFont(page, 'input[name="password"]');
    await page.locator('input[name="email"]').fill("admin@oms-demo.local");
    await page.locator('input[name="password"]').tap();
    await page.locator('input[name="password"]').fill(PW);
    // keyboard-open emulation: shrink the layout viewport like an on-screen keyboard would
    const { width, height } = page.viewportSize();
    await page.setViewportSize({ width, height: Math.round(height * 0.55) });
    const submitVisible = await page.locator('button[type="submit"]').isVisible();
    await blankPasswords(page);
    await shot(page, `s1-login-mobile-${label}-keyboard`);
    await page.locator('input[name="password"]').fill(PW);
    await page.setViewportSize({ width, height });
    await page.locator('button[type="submit"]').tap();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
    await settle(page);
    const after = await viewportMetrics(page);
    metrics[`login-mobile-${label}`] = { before, fontEmail, fontPassword, submitVisibleWithKeyboard: submitVisible, afterLogin: after, landedOn: new URL(page.url()).pathname };
    await shot(page, `s1-after-login-mobile-${label}`);
    await ctx.close();
  });
}

// ── S2 agents overview / management ─────────────────────────────────────
await run("s2-company", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const path of ["/agents", "/agents/overview"]) {
    const res = await page.goto(`${BASE}${path}`);
    await settle(page);
    metrics[`company${path}`] = { status: res?.status(), final: new URL(page.url()).pathname };
    await shot(page, `s2-company${path.replaceAll("/", "-")}`);
  }
  await ctx.close();
});
for (const [who, email] of [["agent-admin", "agent@oms-demo.local"], ["agent-sales", "agent2@oms-demo.local"]]) {
  await run(`s2-${who}`, async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await login(page, email);
    await page.goto(`${BASE}/agent/dashboard`);
    await settle(page);
    await shot(page, `s2-${who}-dashboard`);
    const card = page.locator('[data-slot="insight-card"], [data-slot="summary-card"]').first();
    if (await card.count()) {
      await card.hover();
      await page.waitForTimeout(300);
      await shot(page, `s2-${who}-dashboard-hover`);
    }
    await ctx.close();
  });
}

// ── S3 agent order entry ────────────────────────────────────────────────
for (const [who, email] of [["agent-admin", "agent@oms-demo.local"], ["agent-sales", "agent2@oms-demo.local"]]) {
  for (const [label, device] of [["desktop", {}], ["phone", PHONE]]) {
    await run(`s3-${who}-${label}`, async () => {
      const ctx = await context(device);
      const page = await ctx.newPage();
      await login(page, email);
      await page.goto(`${BASE}/agent/orders`);
      await settle(page);
      await page.getByRole("button", { name: /طلب جديد/ }).first().click();
      await page.waitForTimeout(1200);
      const dialog = page.locator('[role="dialog"]').first();
      const box = (await dialog.count()) ? await dialog.boundingBox() : null;
      metrics[`order-entry-${who}-${label}`] = {
        url: new URL(page.url()).pathname,
        dialogWidth: box ? Math.round(box.width) : null,
        viewport: page.viewportSize(),
        overflowX: (await viewportMetrics(page)).overflowX,
      };
      await shot(page, `s3-${who}-${label}`);
      await ctx.close();
    });
  }
}
await run("s3-company-reference", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "sales@oms-demo.local");
  await page.goto(`${BASE}/store-orders`);
  await settle(page);
  await page.getByRole("button", { name: /طلب جديد/ }).first().click();
  await page.waitForTimeout(1200);
  const box = await page.locator('[role="dialog"]').first().boundingBox();
  metrics["order-entry-company-reference"] = { dialogWidth: box ? Math.round(box.width) : null };
  await shot(page, "s3-company-reference");
  await ctx.close();
});

await browser.close();
writeFileSync(`${OUT}/metrics.json`, JSON.stringify({ at: new Date().toISOString(), phase: PHASE, metrics }, null, 2));
console.log(JSON.stringify(metrics, null, 1));
