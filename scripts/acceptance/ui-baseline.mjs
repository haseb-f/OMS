#!/usr/bin/env node
/**
 * UI baseline capture (milestone enterprise-ui-overhaul) — before/after evidence.
 *
 *   PHASE=before BASE=https://oms.haseb.org node scripts/acceptance/ui-baseline.mjs
 *   PHASE=after  BASE=https://oms.haseb.org node scripts/acceptance/ui-baseline.mjs
 *
 * For each representative page × variant, records a screenshot plus layout metrics:
 *   - visibleRows: table body rows fully inside the viewport (density evidence)
 *   - contentTop: px from the viewport top to the first table/report row or main card
 *   - hOverflow: page-level horizontal overflow in px (must be 0)
 *   - rowHeight / headerHeight of the first table (px)
 * Read-only: never clicks a mutating control.
 *
 * Env: PHASE (default before), PAGES (route csv, or "nav" = every route in
 *      navigation.config.ts), VARIANTS (csv of vp-locale-theme,
 *      e.g. desktop-ar-light,mobile-en-dark), EMAIL/PW (tmp/.qa.env).
 * Output: tmp/ui-baseline/<PHASE>/report.json + shots/*.png
 */
/* global document, window */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BASE, EMAIL, PW, ROOT } from "./_tour-lib.mjs";

const PHASE = process.env.PHASE ?? "before";
const OUT = resolve(ROOT, "tmp/ui-baseline", PHASE);
const SHOTS = resolve(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 720 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};
const envList = (name, fallback) =>
  process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : fallback;
/** Every sidebar route (navigation.config.ts), for full-coverage sweeps. */
function navRoutes() {
  const cfg = readFileSync(resolve(ROOT, "apps/web/src/navigation/navigation.config.ts"), "utf8");
  return [...new Set([...cfg.matchAll(/route: "([^"]+)"/g)].map((m) => m[1]))];
}
const PAGES = process.env.PAGES === "nav" ? navRoutes() : envList("PAGES", [
  "/",
  "/crm/leads",
  "/store-orders",
  "/sales/invoices",
  "/sales/invoices/new",
  "/finance/journal-entries",
  "/finance/chart-of-accounts",
  "/reports/finance?report=trialBalance",
  "/reports/finance?report=incomeStatement",
  "/reports/finance?report=balanceSheet",
  "/inventory/movements",
  "/finance/payment-review",
]);
const VARIANTS = envList("VARIANTS", [
  "desktop-ar-light",
  "laptop-ar-light",
  "desktop-en-dark",
  "tablet-ar-light",
  "mobile-ar-light",
]);
const slug = (s) => s.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "home";

async function settle(page, maxMs = 20000) {
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await page
      .evaluate(() => document.querySelectorAll('main [data-slot="skeleton"], main .animate-pulse').length)
      .catch(() => 0);
    if (!busy) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(400);
}

async function newContext(browser, { vp, locale, theme, storageState }) {
  const viewport = VIEWPORTS[vp];
  const context = await browser.newContext({
    viewport,
    colorScheme: theme,
    hasTouch: viewport.width < 768,
    isMobile: viewport.width < 768,
    storageState,
    locale: locale === "ar" ? "ar-SA" : "en-US",
  });
  await context.addInitScript(
    ([loc, th]) => {
      try {
        window.localStorage.setItem("oms.locale", JSON.stringify(loc));
        window.localStorage.setItem("theme", th);
      } catch {
        /* storage blocked */
      }
    },
    [locale, theme],
  );
  return context;
}

async function uiLogin(browser) {
  const context = await newContext(browser, { vp: "desktop", locale: "ar", theme: "light" });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PW);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  const state = await context.storageState();
  await context.close();
  return state;
}

function metrics() {
  const vh = window.innerHeight;
  const doc = document.documentElement;
  const hOverflow = Math.max(0, doc.scrollWidth - doc.clientWidth);
  const main = document.querySelector("main") ?? document.body;
  // Mobile/tablet lists render cards, not rows — count list cards too.
  const cards = [...main.querySelectorAll("[data-slot='mobile-row'], [data-mobile-row]")].filter((c) => {
    const b = c.getBoundingClientRect();
    return b.height > 0 && b.top >= 0 && b.bottom <= vh;
  }).length;
  const rows = [...main.querySelectorAll("table tbody tr, [role='row']")].filter((r) => {
    const b = r.getBoundingClientRect();
    return b.height > 0 && b.width > 0 && !r.closest("thead");
  });
  const visibleRows = rows.filter((r) => {
    const b = r.getBoundingClientRect();
    return b.top >= 0 && b.bottom <= vh;
  }).length;
  const firstRow = rows[0]?.getBoundingClientRect();
  const firstCard = main.querySelector("table, [data-slot='card'], form")?.getBoundingClientRect();
  const th = main.querySelector("table thead tr")?.getBoundingClientRect();
  const heights = rows.slice(0, 10).map((r) => r.getBoundingClientRect().height);
  const med = heights.length ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] : null;
  return {
    visibleRows,
    visibleCards: cards,
    totalRows: rows.length,
    contentTop: Math.round(firstRow?.top ?? firstCard?.top ?? -1),
    rowHeight: med ? Math.round(med) : null,
    headerHeight: th ? Math.round(th.height) : null,
    hOverflow,
    title: document.querySelector("main h1")?.textContent?.trim() ?? null,
    errorText: /حدث خطأ|Something went wrong|Application error|Unhandled Runtime Error/.test(main.innerText.slice(0, 3000)),
  };
}

const report = { phase: PHASE, base: BASE, at: new Date().toISOString(), results: [] };
const browser = await chromium.launch();
try {
  const storageState = await uiLogin(browser);
  for (const variant of VARIANTS) {
    const [vp, locale, theme] = variant.split("-");
    const context = await newContext(browser, { vp, locale, theme, storageState });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    for (const route of PAGES) {
      const shot = resolve(SHOTS, `${slug(route)}--${variant}.png`);
      const row = { route, variant };
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        Object.assign(row, await page.evaluate(metrics));
        await page.screenshot({ path: shot });
        row.screenshot = shot.replace(`${ROOT}\\`, "").replace(/\\/g, "/");
      } catch (e) {
        row.error = String(e?.message ?? e).split("\n")[0];
      }
      report.results.push(row);
      console.log(
        `${variant.padEnd(18)} ${route.padEnd(42)} rows=${row.visibleRows ?? "-"}/${row.totalRows ?? "-"} top=${row.contentTop ?? "-"} rowH=${row.rowHeight ?? "-"} hOverflow=${row.hOverflow ?? "-"}${row.error ? ` ERROR ${row.error}` : ""}`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
}
