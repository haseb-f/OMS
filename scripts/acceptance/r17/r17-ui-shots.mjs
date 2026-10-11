#!/usr/bin/env node
/**
 * R17 — before/after screenshots for the refinement round (local build only).
 *
 *   PHASE=before|after BASE=http://localhost:3001 node scripts/acceptance/r17/r17-ui-shots.mjs
 *
 * Demo personas (*@oms-demo.local) of the R15 manual database clone; password read at runtime from
 * tmp/r15-manual/.env and never written out. Output: specs/round17-refinements/evidence/<phase>/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const PHASE = process.env.PHASE ?? "before";
const ONLY = process.env.ONLY;
const OUT = `specs/round17-refinements/evidence/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const AGENT_ID = process.env.AGENT_ID ?? "b104b04d-e11c-41cd-b732-5e746025956a";
const metrics = {};
const browser = await chromium.launch();

async function context({ locale = "ar", scheme = "light", device = null, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({
    ...(device ?? { viewport: { width: 1440, height: 900 } }),
    colorScheme: scheme,
    reducedMotion,
  });
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {
      // private mode — default locale
    }
  }, locale);
  return ctx;
}
const settle = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await settle(page);
}
const run = async (name, fn) => {
  if (ONLY && !ONLY.split(",").some((p) => name.startsWith(p))) return;
  try {
    await fn();
    console.log("done", name);
  } catch (error) {
    console.log("FAILED", name, String(error?.message ?? error).slice(0, 200));
  }
};
const toGrid = async (page) => {
  const grid = page.getByRole("radio", { name: /شبك|بطاق|Grid|Cards/ }).first();
  if (await grid.count()) {
    await grid.click();
    await settle(page);
    return true;
  }
  return false;
};

// 5 — login
await run("login", async () => {
  for (const [label, opts] of [["desktop", {}], ["mobile", { device: devices["Pixel 7"] }]]) {
    const ctx = await context(opts);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await settle(page);
    metrics[`login-${label}`] = {
      inputHeight: await page.locator('input[name="email"]').evaluate((el) => el.getBoundingClientRect().height),
      fontSize: await page.locator('input[name="email"]').evaluate((el) => getComputedStyle(el).fontSize),
      copy: await page.getByRole("button", { name: /نسخ|Copy/ }).count(),
    };
    await shot(page, `login-${label}`);
    await ctx.close();
  }
});

// 1 — leads table + grid (company sales and agent sales)
for (const [who, email, path] of [["company", "sales@oms-demo.local", "/crm/leads"], ["agent", "agent2@oms-demo.local", "/agent/leads"]]) {
  await run(`leads-${who}`, async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await login(page, email);
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await shot(page, `leads-${who}-table`);
    if (await toGrid(page)) await shot(page, `leads-${who}-grid`);
    await ctx.close();
  });
}

// 2/3 — agreements (company admin)
await run("agreements", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const tab of ["agreements", "settings"]) {
    await page.goto(`${BASE}/agents/${AGENT_ID}?tab=${tab}`);
    await settle(page);
    await shot(page, `agent-${tab}`);
  }
  await ctx.close();
});

// 4 — report cards: agents overview, partners, agent dashboard, a financial report, hover / focus / reduced motion
await run("cards", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await login(page, "admin@oms-demo.local");
  for (const [name, path] of [["agents-overview", "/agents/overview"], ["partners", "/company-partners"], ["dashboard", "/dashboard"]]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await shot(page, `cards-${name}`);
    const card = page.locator('[data-slot="insight-surface"], [data-slot="insight-card"], [data-slot="summary-card"], [data-slot="report-card"]').first();
    if (await card.count()) {
      await card.hover();
      await page.waitForTimeout(400);
      await shot(page, `cards-${name}-hover`);
      metrics[`cards-${name}`] = await card.evaluate((el) => ({
        transition: getComputedStyle(el).transitionDuration,
        shadow: getComputedStyle(el).boxShadow.slice(0, 80),
        tabIndex: el.tabIndex,
        tag: el.tagName,
      }));
    }
  }
  await page.keyboard.press("Tab");
  await ctx.close();
  const rm = await context({ reducedMotion: "reduce" });
  const p2 = await rm.newPage();
  await login(p2, "admin@oms-demo.local");
  await p2.goto(`${BASE}/agents/overview`);
  await settle(p2);
  const card = p2.locator('[data-slot="insight-surface"], [data-slot="insight-card"], [data-slot="summary-card"]').first();
  if (await card.count()) metrics["cards-reduced-motion"] = await card.evaluate((el) => getComputedStyle(el).transitionDuration);
  await rm.close();
});
await run("cards-agent", async () => {
  const ctx = await context({ locale: "en", scheme: "dark" });
  const page = await ctx.newPage();
  await login(page, "agent@oms-demo.local");
  await page.goto(`${BASE}/agent/dashboard`);
  await settle(page);
  await shot(page, "cards-agent-dashboard-en-dark");
  await ctx.close();
});

await browser.close();
writeFileSync(`${OUT}/metrics.json`, JSON.stringify({ at: new Date().toISOString(), phase: PHASE, metrics }, null, 2));
console.log(JSON.stringify(metrics, null, 1));
