#!/usr/bin/env node
/**
 * UI controls & headers capture (enterprise-ui-overhaul, round 2) — before/after evidence.
 *
 *   MSYS_NO_PATHCONV=1 PHASE=r2-before node scripts/acceptance/ui-controls.mjs
 *   MSYS_NO_PATHCONV=1 PHASE=r2-after  node scripts/acceptance/ui-controls.mjs
 *
 * For each scenario × variant: header metrics (top bar height, page/document
 * header band, y of the first content row), every visible control's kind /
 * height / background / border, fields visible above the fold, a full
 * screenshot, and zoomed control-state examples (rest, hover, keyboard focus,
 * expanded menu, invalid). READ-ONLY on Production: dialogs are opened on
 * existing demo records and closed with Escape; the only submit is an EMPTY
 * invoice form, which client-side validation rejects before any request.
 *
 * Env: PHASE, BASE, EMAIL/PW (tmp/.qa.env), SCENARIOS (csv), VARIANTS (csv),
 *      LEAD_ID, ORDER_ID (demo records for the dialog scenarios).
 * Output: tmp/ui-controls/<PHASE>/report.json + shots/*.png
 */
/* global document, window */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { API, BASE, EMAIL, PW, ROOT, apiClient, items, login } from "./_tour-lib.mjs";

const PHASE = process.env.PHASE ?? "r2-before";
const OUT = resolve(ROOT, "tmp/ui-controls", PHASE);
const SHOTS = resolve(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });
const envList = (name, fallback) =>
  process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : fallback;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, laptop: { width: 1280, height: 720 }, tablet: { width: 820, height: 1180 }, mobile: { width: 390, height: 844 } };
const VARIANTS = envList("VARIANTS", ["desktop-ar-light", "mobile-ar-light", "desktop-en-dark"]);
const SCENARIOS = envList("SCENARIOS", ["list", "leadConvert", "invoiceNew", "purchaseQuotationNew", "purchaseInvoiceNew", "paymentDeclare", "paymentReview", "reconciliation", "states"]);

// ---------------------------------------------------------------- records (read-only API lookups)
const token = await login(EMAIL, PW);
const A = apiClient(token);
// Existing demo records (already opened, so viewing them writes nothing).
const lead = { id: process.env.LEAD_ID ?? "2f3339af-a80f-41c9-9d55-9e9dcbc9016b" };
const order = process.env.ORDER_ID
  ? { id: process.env.ORDER_ID }
  : items((await A("GET", "/store-orders?search=DEMO-PDR-20260927&pageSize=50")).json).find((o) => o.declaredPaymentStatus === "UNPAID" && o.paymentType === "PREPAID") ?? null;
const methods = items((await A("GET", "/payment-methods?pageSize=100")).json);
const reconMethod = methods.find((m) => m.requiresReconciliation && /DEMO-PDR/.test(m.name ?? "")) ?? methods.find((m) => m.requiresReconciliation) ?? null;

async function settle(page, maxMs = 20000) {
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await page.evaluate(() => document.querySelectorAll('main [data-slot="skeleton"], main .animate-pulse').length).catch(() => 0);
    if (!busy) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
}

/** Header + control metrics inside `scopeSel` (main or the open dialog). */
function metrics(scopeSel) {
  const vh = window.innerHeight;
  const scope = document.querySelector(scopeSel) ?? document.querySelector("main") ?? document.body;
  const vis = (el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && b.bottom > 0 && b.top < vh;
  };
  const topbar = document.querySelector("header")?.getBoundingClientRect().height ?? null;
  const h1 = scope.querySelector("h1, [role='heading'][aria-level='1'], [data-slot='dialog-title']");
  const firstSurface = scope.querySelector("table, [data-slot='card'], form, [data-testid='document-line']");
  const kindOf = (el) => {
    if (el.matches("input[type='checkbox'], [role='checkbox'], [role='switch'], [role='radio']")) return null;
    if (el.matches("input, textarea")) return el.readOnly ? "input-readonly" : el.disabled ? "input-disabled" : "input";
    if (el.matches("[role='combobox'], [data-slot='select-trigger']")) return "trigger";
    if (el.matches("button, a[data-slot='button']")) {
      const v = el.getAttribute("data-variant");
      return v ? `button-${v}` : "button";
    }
    return null;
  };
  const controls = [...scope.querySelectorAll("input, textarea, button, [role='combobox'], a[data-slot='button']")]
    .filter(vis)
    .map((el) => {
      const kind = kindOf(el);
      if (!kind) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        kind,
        h: Math.round(b.height),
        w: Math.round(b.width),
        bg: cs.backgroundColor,
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        radius: cs.borderTopLeftRadius,
        font: cs.fontSize,
        text: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 40),
      };
    })
    .filter(Boolean);
  const fields = controls.filter((c) => c.kind.startsWith("input") || c.kind === "trigger");
  const aboveFold = fields.length;
  const byKind = {};
  for (const c of controls) {
    const k = (byKind[c.kind] ??= { n: 0, heights: new Set(), bgs: new Set(), borders: new Set() });
    k.n += 1;
    k.heights.add(c.h);
    k.bgs.add(c.bg);
    k.borders.add(c.border);
  }
  for (const k of Object.values(byKind)) {
    k.heights = [...k.heights].sort((a, b) => a - b);
    k.bgs = [...k.bgs];
    k.borders = [...k.borders];
  }
  const doc = document.documentElement;
  return {
    topbar,
    titleTop: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    contentTop: firstSurface ? Math.round(firstSurface.getBoundingClientRect().top) : null,
    headerBand: h1 && firstSurface ? Math.round(firstSurface.getBoundingClientRect().top - h1.getBoundingClientRect().top) : null,
    fieldsVisible: aboveFold,
    byKind,
    hOverflow: Math.max(0, doc.scrollWidth - doc.clientWidth),
    scrollHeight: (scope.scrollHeight ?? 0) || null,
    sample: controls.slice(0, 40),
  };
}

async function newContext(browser, variant, storageState) {
  const [vp, locale, theme] = variant.split("-");
  const viewport = VIEWPORTS[vp];
  const context = await browser.newContext({ viewport, colorScheme: theme, hasTouch: viewport.width < 768, isMobile: viewport.width < 768, storageState, locale: locale === "ar" ? "ar-SA" : "en-US" });
  await context.addInitScript(([loc, th]) => {
    try {
      window.localStorage.setItem("oms.locale", JSON.stringify(loc));
      window.localStorage.setItem("theme", th);
    } catch {
      /* storage blocked */
    }
  }, [locale, theme]);
  return context;
}

async function uiLogin(browser) {
  const context = await newContext(browser, "desktop-ar-light");
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 }), page.locator('button[type="submit"]').first().click()]);
  const state = await context.storageState();
  await context.close();
  return state;
}

const dialogSel = '[role="dialog"]:not([data-state="closed"])';
async function openDialogByButton(page, re) {
  let b = page.getByRole("button", { name: re }).first();
  if (!(await b.isVisible().catch(() => false))) {
    // Phones collapse secondary header actions into the «المزيد» / More menu.
    const more = page.getByRole("button", { name: /^المزيد$|^More$/ }).first();
    if (!(await more.isVisible().catch(() => false))) return false;
    await more.click();
    b = page.getByRole("menuitem", { name: re }).first();
    if (!(await b.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  }
  await b.click();
  await page.locator(dialogSel).last().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
  return true;
}

const SCENARIO = {
  list: { route: "/crm/leads", scope: "main" },
  leadConvert: { route: () => (lead ? `/crm/leads/${lead.id}` : null), scope: dialogSel, open: (p) => openDialogByButton(p, /تحويل إلى طلب|Convert to order/i) },
  invoiceNew: { route: "/sales/invoices/new", scope: "main" },
  purchaseQuotationNew: { route: "/purchasing/purchase-quotations/new", scope: "main" },
  purchaseInvoiceNew: { route: "/purchasing/purchase-invoices/new", scope: "main" },
  paymentDeclare: { route: () => (order ? `/store-orders/${order.id}` : null), scope: dialogSel, open: (p) => openDialogByButton(p, /إبلاغ دفع العميل|Report customer payment|Declare/i) },
  paymentReview: { route: "/finance/payment-review", scope: "main" },
  tb: { route: "/reports/finance?report=trialBalance", scope: "main" },
  gl: { route: "/reports/finance?report=generalLedger", scope: "main" },
  pl: { route: "/reports/finance?report=incomeStatement", scope: "main" },
  bs: { route: "/reports/finance?report=balanceSheet", scope: "main" },
  cf: { route: "/reports/finance?report=cashFlow", scope: "main" },
  statement: { route: "/reports/finance?report=accountStatement", scope: "main" },
  aging: { route: "/reports/finance?report=arAging", scope: "main" },
  treasury: { route: "/reports/finance?report=cashAvailability", scope: "main" },
  reconciliation: { route: () => (reconMethod ? `/finance/payment-reconciliation/${reconMethod.id}` : "/finance/payment-reconciliation"), scope: "main" },
};

const report = { phase: PHASE, base: BASE, at: new Date().toISOString(), records: { lead: lead?.id ?? null, order: order?.internalOrderId ?? null, reconMethod: reconMethod?.name ?? null }, results: [] };
const browser = await chromium.launch();
try {
  const storageState = await uiLogin(browser);
  for (const variant of VARIANTS) {
    const context = await newContext(browser, variant, storageState);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    for (const name of SCENARIOS.filter((s) => s !== "states")) {
      const sc = SCENARIO[name];
      const route = typeof sc.route === "function" ? sc.route() : sc.route;
      const row = { scenario: name, variant, route };
      try {
        if (!route) throw new Error("no demo record for this scenario");
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        if (sc.open && !(await sc.open(page))) throw new Error("trigger button not visible");
        Object.assign(row, await page.evaluate(metrics, sc.scope));
        const shot = resolve(SHOTS, `${name}--${variant}.png`);
        await page.screenshot({ path: shot });
        row.screenshot = shot.replace(`${ROOT}\\`, "").replace(/\\/g, "/");
        if (sc.open) await page.keyboard.press("Escape").catch(() => {});
      } catch (e) {
        row.error = String(e?.message ?? e).split("\n")[0];
      }
      report.results.push(row);
      const k = row.byKind ?? {};
      console.log(`${variant.padEnd(17)} ${name.padEnd(21)} topbar=${row.topbar ?? "-"} band=${row.headerBand ?? "-"} content=${row.contentTop ?? "-"} fields=${row.fieldsVisible ?? "-"} input=${k.input?.heights ?? "-"} trigger=${k.trigger?.heights ?? "-"} ${row.error ? `ERROR ${row.error}` : ""}`);
    }
    // Control states: rest / hover / focus / expanded / invalid on the invoice editor (desktop only).
    if (SCENARIOS.includes("states") && variant.startsWith("desktop")) {
      try {
        await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: "domcontentloaded" });
        await settle(page);
        const trig = page.locator("main [role='combobox']").first();
        const input = page.locator("main input:not([type='checkbox'])").first();
        const clip = async (loc, name) => {
          const b = await loc.boundingBox();
          if (!b) return;
          await page.screenshot({ path: resolve(SHOTS, `state-${name}--${variant}.png`), clip: { x: Math.max(0, b.x - 16), y: Math.max(0, b.y - 12), width: Math.min(b.width + 32, 700), height: b.height + 24 } });
        };
        await clip(trig, "trigger-rest");
        await trig.hover();
        await page.waitForTimeout(250);
        await clip(trig, "trigger-hover");
        await trig.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await page.waitForTimeout(250);
        await clip(trig, "trigger-focus");
        await trig.click();
        await page.waitForTimeout(900);
        const b = await trig.boundingBox();
        await page.screenshot({ path: resolve(SHOTS, `state-trigger-expanded--${variant}.png`), clip: { x: Math.max(0, (b?.x ?? 0) - 40), y: Math.max(0, (b?.y ?? 0) - 12), width: 520, height: 420 } });
        await page.keyboard.press("Escape");
        await clip(input, "input-rest");
        await input.focus();
        await page.waitForTimeout(200);
        await clip(input, "input-focus");
        const save = page.getByRole("button", { name: /^حفظ$|^Save$/ }).first();
        if (await save.isVisible().catch(() => false)) {
          await save.click();
          await page.waitForTimeout(1200);
          await page.screenshot({ path: resolve(SHOTS, `state-invalid-form--${variant}.png`) });
        }
        report.results.push({ scenario: "states", variant, ok: true });
        console.log(`${variant.padEnd(17)} states                captured`);
      } catch (e) {
        report.results.push({ scenario: "states", variant, error: String(e?.message ?? e).split("\n")[0] });
        console.log(`${variant.padEnd(17)} states ERROR ${String(e?.message ?? e).split("\n")[0]}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
}
void API;
