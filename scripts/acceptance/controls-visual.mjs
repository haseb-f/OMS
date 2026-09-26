#!/usr/bin/env node
/**
 * Controls visual matrix (milestone system-audit-ui, AC-UI-6..8).
 *
 *   BASE=https://oms.haseb.org node scripts/acceptance/controls-visual.mjs
 *   BASE=http://localhost:3001 EMAIL=admin@oms.local PW=... node scripts/acceptance/controls-visual.mjs
 *
 * For each representative page × viewport (390/820/1440) × locale (ar/en) ×
 * theme (light/dark): no horizontal page scroll, every visible combobox
 * trigger has an accessible name and fits the viewport, the first form
 * combobox opens a list that stays inside the viewport, its search box
 * filters, and Escape closes it. Keyboard pass (desktop/ar/light): ArrowDown
 * opens, ArrowDown+Enter selects and closes. Read-only — never submits.
 *
 * Optional env: VIEWPORTS, LOCALES, THEMES (comma lists), PAGES (route list).
 * Output: tmp/acceptance/<RUN>/controls-visual-report.json + shots/controls/*.png
 */
/* global document, window, CSS */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BASE, EMAIL, OUT, PW, ROOT, createReport } from "./_tour-lib.mjs";

const { check, finish } = createReport("controls-visual");
const SHOTS = resolve(OUT, "shots/controls");
mkdirSync(SHOTS, { recursive: true });
const rel = (p) => p.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "").replace(/\\/g, "/");

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};
const envList = (name, fallback) =>
  process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : fallback;
const VIEWPORT_KEYS = envList("VIEWPORTS", Object.keys(VIEWPORTS));
const LOCALES = envList("LOCALES", ["ar", "en"]);
const THEMES = envList("THEMES", ["light", "dark"]);
const PAGES = envList("PAGES", [
  "/sales/orders/new",
  "/purchasing/purchase-orders/new",
  "/finance/journal-entries/new",
  "/crm/leads",
  "/finance/chart-of-accounts",
  "/store-orders/needs-review",
  "/hr/sales-targets",
]);

const POPUP_PARTS = ['[data-slot="popover-content"]', '[data-slot="select-content"]'];
const POPUP = POPUP_PARTS.join(", ");
/** Scope a descendant selector inside any popup (a comma list needs the prefix per part). */
const inPopup = (sel) => POPUP_PARTS.map((p) => `${p} ${sel}`).join(", ");
const slug = (route) => route.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "home";

async function settle(page, maxMs = 20000) {
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const busy = await page
      .evaluate(() => document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length)
      .catch(() => 1);
    if (!busy) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
}

async function newContext(browser, { viewport, locale, theme, storageState }) {
  const vp = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: vp,
    colorScheme: theme,
    hasTouch: vp.width < 768,
    isMobile: vp.width < 768,
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
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(90000);
  return { context, page };
}

async function uiLogin(browser) {
  const { context, page } = await newContext(browser, { viewport: "desktop", locale: "ar", theme: "light" });
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

/** Visible comboboxes in the main content (not the shell's own controls). */
async function auditTriggers(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    const scope = document.querySelector("main") ?? document.body;
    for (const el of scope.querySelectorAll('[role="combobox"], [data-slot="select-trigger"]')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const id = el.getAttribute("id");
      const labelledBy = el.getAttribute("aria-labelledby");
      const label =
        el.getAttribute("aria-label") ||
        (labelledBy && document.getElementById(labelledBy)?.textContent) ||
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent) ||
        el.closest("label")?.textContent ||
        "";
      const text = (el.textContent || "").trim();
      out.push({
        text: text.slice(0, 40),
        named: Boolean(label.trim()),
        // A filter trigger shows its own label ("Status", "All") — counts as its name.
        filterNamed: Boolean(text) && !el.closest("form, [role='dialog']"),
        inX: box.left >= -1 && box.right <= vw + 1,
        clipped: el.scrollWidth > el.clientWidth + 2 && !el.querySelector(".truncate"),
        height: Math.round(box.height),
      });
    }
    const doc = document.scrollingElement ?? document.documentElement;
    return { triggers: out, hScroll: doc.scrollWidth > doc.clientWidth + 1 };
  });
}

async function popupInViewport(page) {
  const popup = page.locator(POPUP).last();
  if (!(await popup.isVisible().catch(() => false))) return { ok: false, reason: "no popup" };
  const box = await popup.boundingBox();
  const vp = page.viewportSize();
  const ok = box && box.x >= -1 && box.x + box.width <= vp.width + 1 && box.y >= -1 && box.y + box.height <= vp.height + 1;
  return { ok, reason: box ? `x=${Math.round(box.x)} w=${Math.round(box.width)} y=${Math.round(box.y)} h=${Math.round(box.height)} vw=${vp.width} vh=${vp.height}` : "no box" };
}

async function exercisePage(page, route, combo) {
  const id = `${slug(route)}@${combo}`;
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  if (/\/login/.test(page.url())) return check(id, "BLOCKED", "redirected to login");
  const { triggers, hScroll } = await auditTriggers(page);
  const problems = [];
  if (hScroll) problems.push("horizontal page scroll");
  const unnamed = triggers.filter((t) => !t.named && !t.filterNamed);
  if (unnamed.length) problems.push(`unnamed triggers: ${unnamed.map((t) => t.text || "(empty)").join(" | ")}`);
  const outside = triggers.filter((t) => !t.inX);
  if (outside.length) problems.push(`triggers outside viewport: ${outside.length}`);
  const heights = [...new Set(triggers.map((t) => t.height))];

  // Open the first enabled combobox inside main and inspect its list.
  const first = page.locator('main [role="combobox"]:not([disabled]), main [data-slot="select-trigger"]:not([disabled])').first();
  let popupNote = "no combobox on page";
  if (await first.count()) {
    await first.scrollIntoViewIfNeeded().catch(() => {});
    await first.click();
    await page.waitForTimeout(600);
    const inVp = await popupInViewport(page);
    popupNote = inVp.reason;
    if (!inVp.ok) problems.push(`popup outside viewport (${inVp.reason})`);
    const search = page.locator(inPopup("input[cmdk-input]")).last();
    if (await search.isVisible().catch(() => false)) {
      await search.fill("zzqx-no-match");
      await page.waitForTimeout(900);
      const emptyShown = await page.locator(inPopup("[cmdk-empty]")).first().isVisible().catch(() => false);
      if (!emptyShown) problems.push("no empty state for non-matching search");
      await search.fill("");
      await page.waitForTimeout(700);
    }
    const shot = resolve(SHOTS, `${slug(route)}-${combo}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    if (await page.locator(POPUP).last().isVisible().catch(() => false)) problems.push("Escape did not close list");
    check(`${id} popup`, problems.length ? "FAIL" : "PASS", `${problems.join("; ") || "ok"} · triggers=${triggers.length} heights=${heights.join("/")} · ${popupNote}`, rel(shot));
    return;
  }
  check(`${id} popup`, problems.length ? "FAIL" : "PASS", `${problems.join("; ") || "ok"} · ${popupNote}`);
}

async function keyboardPass(browser, storageState) {
  const { context, page } = await newContext(browser, { viewport: "desktop", locale: "ar", theme: "light", storageState });
  try {
    await page.goto(`${BASE}/sales/orders/new`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const trigger = page.locator('main button[role="combobox"]:not([disabled])').first();
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(900);
    const opened = await page.locator(POPUP).last().isVisible().catch(() => false);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const closed = !(await page.locator(POPUP).last().isVisible().catch(() => false));
    check("keyboard ArrowDown opens / Enter selects+closes", opened && closed ? "PASS" : "FAIL", `opened=${opened} closedAfterEnter=${closed}`);
  } catch (error) {
    check("keyboard ArrowDown opens / Enter selects+closes", "FAIL", error.message.split("\n")[0]);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!PW) throw new Error("No password (PW / QA_PASSWORD) available");
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  try {
    const storageState = await uiLogin(browser);
    check("UI login", "PASS", EMAIL);
    await keyboardPass(browser, storageState);
    for (const viewport of VIEWPORT_KEYS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          const combo = `${viewport}-${locale}-${theme}`;
          const { context, page } = await newContext(browser, { viewport, locale, theme, storageState });
          try {
            for (const route of PAGES) {
              try {
                await exercisePage(page, route, combo);
              } catch (error) {
                check(`${slug(route)}@${combo} popup`, "FAIL", error.message.split("\n")[0]);
                await page.keyboard.press("Escape").catch(() => {});
              }
            }
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    finish("controls-visual-report.json");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
