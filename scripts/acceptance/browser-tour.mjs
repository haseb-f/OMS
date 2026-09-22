#!/usr/bin/env node
/**
 * Acceptance tour — browser (Playwright/chromium).
 *
 *   # local
 *   BASE=http://localhost:3001 EMAIL=admin@oms.local PW=... node scripts/acceptance/browser-tour.mjs
 *   # production (password from tmp/.qa.env QA_PASSWORD)
 *   BASE=https://oms.haseb.org node scripts/acceptance/browser-tour.mjs
 *
 * a) Page sweep — UI login, every route in navigation.config.ts: render/HTTP,
 *    error UI, error toasts, console errors, failed API requests, settle time,
 *    one screenshot per route (desktop / light / Arabic).
 * b) Affected workflows × {mobile 390x844, tablet 820x1180, desktop 1440x900}
 *    × {ar, en} × {light, dark}: store order detail, store order create line
 *    editor (+ edit line editor when the order state offers one), lead
 *    conversion dialog, GL, customer/supplier statements, exchange rates,
 *    product create/edit investment toggle, countries search.
 * c) Related-record round trip from the store order detail.
 *
 * Optional env: DEMO_STORE_ORDER_ID, DEMO_LEAD_ID, DEMO_PRODUCT_ID,
 *   SWEEP=0 / WORKFLOWS=0 / ROUNDTRIP=0 to skip a part,
 *   VIEWPORTS=mobile,tablet,desktop  LOCALES=ar,en  THEMES=light,dark,
 *   ONLY=<comma list of workflow ids>, HEADED=1.
 * Locale/theme are driven through the app's persisted keys (`oms.locale`,
 * JSON; next-themes `theme`) — the same storage the TopBar switches write.
 * Never submits a form except creating one RUN-tagged demo lead via the API
 * when no RUN lead exists (needed for the conversion dialog). Exit code 0.
 *
 * Output: tmp/acceptance/<RUN>/browser-tour-report.json,
 *         browser-tour-network.log (JSONL console + network),
 *         pages/<slug>.png, workflows/<workflow>-<viewport>-<locale>-<theme>.png
 */
/* global document, window, getComputedStyle */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  API,
  BASE,
  EMAIL,
  OUT,
  PW,
  ROOT,
  RUN,
  apiClient,
  createReport,
  errText,
  items,
  login,
  webRouteFile,
} from "./_tour-lib.mjs";

const { report, check, finish } = createReport("browser-tour");
const PAGES_DIR = resolve(OUT, "pages");
const WF_DIR = resolve(OUT, "workflows");
const RT_DIR = resolve(OUT, "roundtrip");
for (const d of [PAGES_DIR, WF_DIR, RT_DIR]) mkdirSync(d, { recursive: true });
const LOG = resolve(OUT, "browser-tour-network.log");
writeFileSync(LOG, "");
report.networkLog = LOG;
const rel = (p) => p.replace(`${ROOT}\\`, "").replace(`${ROOT}/`, "").replace(/\\/g, "/");

const API_ORIGIN = new URL(API).origin;
const API_PATH = new URL(API).pathname.replace(/\/$/, "");
const isApiUrl = (url) => url.startsWith(API) || (API_PATH === "" && url.startsWith(API_ORIGIN));

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};
const envList = (name, fallback) => (process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : fallback);
const VIEWPORT_KEYS = envList("VIEWPORTS", Object.keys(VIEWPORTS));
const LOCALES = envList("LOCALES", ["ar", "en"]);
const THEMES = envList("THEMES", ["light", "dark"]);
const ONLY = envList("ONLY", null);

const ERROR_UI = [
  /Application error: a client-side exception/i,
  /Unhandled Runtime Error/i,
  /This page could not be found/i,
  /\b404\b.*(not found|could not)/i,
  /Internal Server Error/i,
  /Something went wrong/i,
  /حدث خطأ غير متوقع/,
];

const log = (entry) => appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);

// ------------------------------------------------------------------ helpers
function monitor(page, label) {
  const state = { label, console: [], failed: [], pageErrors: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text().slice(0, 500);
    state.console.push(text);
    log({ kind: "console", label: state.label, url: page.url(), text });
  });
  page.on("pageerror", (err) => {
    state.pageErrors.push(err.message.slice(0, 500));
    log({ kind: "pageerror", label: state.label, url: page.url(), text: err.message.slice(0, 500) });
  });
  page.on("requestfailed", (req) => {
    if (!isApiUrl(req.url())) return;
    const failure = req.failure()?.errorText ?? "failed";
    if (/ERR_ABORTED|cancelled/i.test(failure)) return; // navigations abort in-flight fetches
    state.failed.push({ url: req.url(), status: 0, body: failure });
    log({ kind: "requestfailed", label: state.label, url: req.url(), error: failure });
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (res.status() < 400 || !isApiUrl(url)) return;
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = "";
    }
    const entry = { url, method: res.request().method(), status: res.status(), body };
    state.failed.push(entry);
    log({ kind: "api", label: state.label, ...entry });
  });
  state.reset = (newLabel) => {
    state.label = newLabel ?? state.label;
    state.console = [];
    state.failed = [];
    state.pageErrors = [];
  };
  return state;
}

/** Wait until no API request has been in flight for `quietMs` (max `maxMs`). */
async function settle(page, { quietMs = 700, maxMs = 25000 } = {}) {
  const started = Date.now();
  await page.waitForLoadState("load", { timeout: maxMs }).catch(() => {});
  const wantDir = page.omsLocale ? (page.omsLocale === "ar" ? "rtl" : "ltr") : null;
  let inflight = 0;
  let last = Date.now();
  const onReq = (r) => {
    if (isApiUrl(r.url())) {
      inflight += 1;
      last = Date.now();
    }
  };
  const onDone = (r) => {
    if (isApiUrl(r.url())) {
      inflight = Math.max(0, inflight - 1);
      last = Date.now();
    }
  };
  page.on("request", onReq);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  try {
    await page.waitForTimeout(300);
    while (Date.now() - started < maxMs) {
      // Hydrated + data loaded: html dir matches the stored locale (SSR always
      // renders the Arabic default), no skeletons, no full-page "Loading…".
      const probe = await page
        .evaluate(() => ({
          dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
          loading: /^(\s*)(جارٍ التحميل|جار التحميل|Loading)(…|\.\.\.)?\s*$/m.test(document.querySelector("main")?.innerText ?? ""),
          skeletons: document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length,
        }))
        .catch(() => ({ dir: null, loading: true, skeletons: 1 }));
      const hydrated = !wantDir || probe.dir === wantDir;
      if (inflight === 0 && Date.now() - last >= quietMs && probe.skeletons === 0 && !probe.loading && hydrated) break;
      await page.waitForTimeout(150);
    }
  } finally {
    page.off("request", onReq);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }
  return Date.now() - started;
}

async function uiErrors(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const errorUi = ERROR_UI.filter((re) => re.test(text)).map((re) => re.source);
  const dev = await devOverlay(page);
  const toasts = await page
    .locator('[data-sonner-toast][data-type="error"]')
    .allInnerTexts()
    .catch(() => []);
  return { errorUi, devOverlay: dev.dialog, devIssues: dev.issues, errorToasts: toasts.map((t) => t.slice(0, 200)) };
}

/** Next.js dev overlay (local dev only): an open error dialog is a failure; the issues badge is informational. */
async function devOverlay(page) {
  return page
    .evaluate(() => {
      const root = document.querySelector("nextjs-portal")?.shadowRoot;
      if (!root) return { dialog: null, issues: 0 };
      const dialog = root.querySelector("[data-nextjs-dialog]");
      const badge = root.querySelector("[data-next-badge]");
      const count = root.querySelector("[data-issues-count]");
      return {
        dialog: dialog ? (dialog.innerText || dialog.textContent || "").slice(0, 300) : null,
        issues: badge?.getAttribute("data-error") === "true" ? Number((count?.textContent ?? "1").replace(/\D/g, "")) || 1 : 0,
      };
    })
    .catch(() => ({ dialog: null, issues: 0 }));
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { ok: el.scrollWidth <= el.clientWidth + 1, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
}

/** Is the locator's box horizontally inside the viewport and non-empty? */
async function inViewportX(page, locator) {
  const count = await locator.count().catch(() => 0);
  if (!count) return { ok: false, reason: "missing" };
  const el = locator.first();
  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  const vp = page.viewportSize();
  if (!box || box.width < 4 || box.height < 4) return { ok: false, reason: `box ${JSON.stringify(box)}` };
  const visible = await el.isVisible().catch(() => false);
  const ok = visible && box.x >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height > 0 && box.y < vp.height + 1;
  return { ok, reason: `x=${Math.round(box.x)} w=${Math.round(box.width)} y=${Math.round(box.y)} vw=${vp.width}` };
}

async function newContext(browser, { viewport = "desktop", locale = "ar", theme = "light", storageState } = {}) {
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
  page.omsLocale = locale;
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  return { context, page };
}

const slugify = (route) => (route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?=&]+/g, "__"));

function navRoutes() {
  const src = readFileSync(resolve(ROOT, "apps/web/src/navigation/navigation.config.ts"), "utf8");
  const routes = [];
  // Nav items are flat object literals (no nested braces) — parse one at a
  // time so an item without a route never borrows the next item's route.
  for (const block of src.match(/\{[^{}]*\}/g) ?? []) {
    const idMatch = block.match(/\bid:\s*"([^"]+)"/);
    const routeMatch = block.match(/\broute:\s*"([^"]+)"/);
    if (idMatch && routeMatch) routes.push({ id: idMatch[1], route: routeMatch[1] });
  }
  const seen = new Set();
  return routes.filter((r) => (seen.has(r.route) ? false : seen.add(r.route)));
}

// ------------------------------------------------------------------ setup
let api;
const demo = {};

async function setupData() {
  const token = await login();
  api = apiClient(token);
  check("api login", "PASS", EMAIL);

  // store order
  if (process.env.DEMO_STORE_ORDER_ID) {
    demo.storeOrderId = process.env.DEMO_STORE_ORDER_ID;
  } else {
    for (const search of [RUN, "DEMO-ACCEPTANCE"]) {
      const list = items((await api("GET", `/store-orders?search=${encodeURIComponent(search)}&pageSize=50&sortBy=createdAt&sortOrder=desc`)).json);
      const tagged = list.filter((o) => /DEMO-ACCEPTANCE/.test(`${o.partner?.name ?? ""} ${o.notes ?? ""} ${o.customerName ?? ""}`));
      const pick = tagged.find((o) => (o.invoices?.length ?? 0) > 0) ?? tagged[0];
      if (pick) {
        demo.storeOrderId = pick.id;
        break;
      }
    }
  }
  check("demo store order resolved", demo.storeOrderId ? "PASS" : "BLOCKED", demo.storeOrderId ?? "no DEMO-ACCEPTANCE store order — run investor-tour/data-tour first or set DEMO_STORE_ORDER_ID");

  // product (RUN-tagged, for the edit form)
  if (process.env.DEMO_PRODUCT_ID) demo.productId = process.env.DEMO_PRODUCT_ID;
  else {
    const list = items((await api("GET", `/products?search=DEMO-ACCEPTANCE&pageSize=20&sortBy=createdAt&sortOrder=desc`)).json);
    demo.product = list.find((p) => p.availableForInvestmentOpportunities) ?? list[0];
    demo.productId = demo.product?.id;
  }
  if (demo.productId && !demo.product) demo.product = (await api("GET", `/products/${demo.productId}`)).json;
  const catalog = items((await api("GET", "/products/catalog?pageSize=5&isSellable=true")).json);
  demo.lineProduct = demo.product?.isSellable !== false && demo.product ? demo.product : catalog[0];
  check("demo product resolved", demo.productId ? "PASS" : "SKIP", demo.product?.sku ?? "none — product edit check will be skipped");

  // lead for conversion dialog (open RUN lead; created via API if missing)
  if (process.env.DEMO_LEAD_ID) demo.leadId = process.env.DEMO_LEAD_ID;
  else {
    const list = items((await api("GET", `/leads?search=DEMO-ACCEPTANCE&pageSize=20`)).json);
    const open = list.find((l) => !["CONVERTED", "LOST", "DISQUALIFIED"].includes(l.status?.code ?? l.statusCode));
    if (open) demo.leadId = open.id;
    else {
      const countries = items((await api("GET", "/countries?pageSize=50&search=SA")).json);
      const country = countries.find((c) => c.code === "SA") ?? countries[0] ?? items((await api("GET", "/countries?pageSize=5")).json)[0];
      const currencies = items((await api("GET", "/currencies?pageSize=200")).json);
      const sar = currencies.find((c) => c.code === "SAR") ?? currencies[0];
      const created = await api("POST", "/leads", {
        customerName: `${RUN} Lead`,
        mobileNumber: `05${String(Date.now()).slice(-8)}`,
        countryId: country?.id,
        city: "Riyadh",
        productId: demo.lineProduct?.id,
        quantity: 1,
        currencyId: sar?.id,
        source: "MANUAL",
      });
      if (created.ok) {
        demo.leadId = created.json.id;
        report.createdRecords = [{ run: RUN, type: "Lead", id: created.json.id, number: created.json.leadNumber, webUrl: `${BASE}/crm/leads/${created.json.id}` }];
      } else check("create demo lead", "FAIL", `${created.status} ${errText(created.json)}`);
    }
  }
  check("demo lead resolved", demo.leadId ? "PASS" : "BLOCKED", demo.leadId ?? "no open DEMO-ACCEPTANCE lead");
  report.demo = { storeOrderId: demo.storeOrderId, productId: demo.productId, leadId: demo.leadId, lineProductSku: demo.lineProduct?.sku };
}

async function uiLogin(browser) {
  const { context, page } = await newContext(browser, { viewport: "desktop", locale: "ar", theme: "light" });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // Wait for hydration — a pre-hydration submit is a native GET that drops the fields.
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('input[name="email"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[name="password"], input[type="password"]').first().fill(PW);
  try {
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 }),
      page.locator('button[type="submit"]').first().click(),
    ]);
  } catch (error) {
    const shot = resolve(OUT, "login-failure.png");
    await page.screenshot({ path: shot }).catch(() => {});
    const alert = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    throw new Error(`UI login did not leave /login (${alert.join(" | ") || error.message.split("\n")[0]}) — ${rel(shot)}`);
  }
  const cookies = await context.cookies();
  const ok = cookies.some((c) => c.name === "oms_token" && c.value);
  check("UI login form", ok ? "PASS" : "FAIL", ok ? `landed on ${new URL(page.url()).pathname}` : "no oms_token cookie");
  return { context, page };
}

// ------------------------------------------------------------------ (a) sweep
async function pageSweep(context, page) {
  const routes = navRoutes();
  report.sweepRoutes = routes.length;
  const mon = monitor(page, "sweep");
  for (const { id, route } of routes) {
    mon.reset(`sweep ${route}`);
    const shot = resolve(PAGES_DIR, `${slugify(route)}.png`);
    const evidence = { route, screenshot: rel(shot) };
    try {
      const t0 = Date.now();
      const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      const settleMs = await settle(page);
      evidence.status = res?.status() ?? null;
      evidence.finalPath = new URL(page.url()).pathname;
      evidence.settleMs = Date.now() - t0;
      evidence.settleAfterDomMs = settleMs;
      const ui = await uiErrors(page);
      Object.assign(evidence, ui);
      evidence.consoleErrors = mon.console.slice(0, 10);
      evidence.pageErrors = mon.pageErrors.slice(0, 5);
      evidence.failedApi = mon.failed.slice(0, 10);
      evidence.routeFile = webRouteFile(route) ? "present" : "MISSING";
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      const hardFail =
        (evidence.status ?? 200) >= 400 ||
        ui.errorUi.length ||
        ui.devOverlay ||
        ui.errorToasts.length ||
        mon.failed.length ||
        mon.pageErrors.length ||
        evidence.finalPath.startsWith("/login");
      const status = hardFail ? "FAIL" : mon.console.length ? "WARN" : "PASS";
      const why = [
        `http ${evidence.status}`,
        `${evidence.settleMs}ms`,
        ui.errorUi.length ? `errorUI=${ui.errorUi.join("|")}` : "",
        ui.devOverlay ? "dev-overlay" : "",
        ui.errorToasts.length ? `toast=${ui.errorToasts.join(" | ")}` : "",
        mon.failed.length ? `api=${mon.failed.map((f) => `${f.status} ${f.url.replace(API, "")}`).join(", ")}` : "",
        mon.pageErrors.length ? `pageerror=${mon.pageErrors[0]}` : "",
        mon.console.length ? `console=${mon.console.length}` : "",
        evidence.routeFile === "MISSING" ? "no page.tsx" : "",
      ]
        .filter(Boolean)
        .join("; ");
      check(`sweep ${route} (${id})`, status, why, evidence);
    } catch (error) {
      await page.screenshot({ path: shot }).catch(() => {});
      check(`sweep ${route} (${id})`, "FAIL", error.message.split("\n")[0], evidence);
    }
  }
  void context;
}

// ------------------------------------------------------------------ (b) workflows
const TXT = {
  newOrder: /^(New Order|طلب جديد)$/,
  convert: /Convert to Order|تحويل إلى طلب/,
  addLine: /Add Line|إضافة سطر/,
  edit: /^(Edit|تعديل)$/,
  inventoryTab: /^(Inventory|المخزون)$/,
  addProduct: /Add Product|إضافة منتج/,
  next: /^(Next|التالي)$/,
  investToggle: /Available for investment opportunities|متاح لفرص الاستثمار/,
  lineEdit: /Correct agreed amounts|تصحيح المبالغ المتفق عليها|Edit (items|lines|products)|تعديل (البنود|المنتجات|الأصناف)/i,
};

/** Fill the first document line of a ProductLineItemsGrid inside `scope`. */
async function fillFirstLine(page, scope, { qty = 2, price = 150 } = {}) {
  let line = scope.locator('[data-testid="document-line"]').filter({ visible: true }).first();
  if (!(await line.count())) {
    const add = scope.getByRole("button", { name: TXT.addLine }).first();
    if (await add.count()) await add.click();
    line = scope.locator('[data-testid="document-line"]').filter({ visible: true }).first();
  }
  if (!(await line.count())) return { ok: false, reason: "no document-line rendered" };
  const picker = line.locator('[role="combobox"]').first();
  await picker.click();
  const search = page.locator("[cmdk-input]").filter({ visible: true }).last();
  const term = demo.lineProduct?.sku ?? "";
  if (term && (await search.count())) await search.fill(term);
  const option = page.locator('[cmdk-item], [role="option"]').filter({ visible: true }).first();
  await option.waitFor({ timeout: 15000 });
  await option.click();
  await page.waitForTimeout(400);
  line = scope.locator('[data-testid="document-line"]').filter({ visible: true }).first();
  const qtyInput = line.locator('input[type="number"]').filter({ visible: true }).first();
  const priceInput = line.locator('input[placeholder="0.00"]').filter({ visible: true }).first();
  if (await qtyInput.count()) await qtyInput.fill(String(qty));
  if (await priceInput.count()) await priceInput.fill(String(price));
  await page.waitForTimeout(300);
  const checks = {
    product: await inViewportX(page, line.locator('[role="combobox"]').first()),
    quantity: await inViewportX(page, qtyInput),
    price: await inViewportX(page, priceInput),
  };
  const values = {
    quantity: await qtyInput.inputValue().catch(() => null),
    price: await priceInput.inputValue().catch(() => null),
  };
  const ok = Object.values(checks).every((c) => c.ok) && Number(values.quantity) === qty && Number(String(values.price).replace(/,/g, "")) === price;
  return { ok, checks, values };
}

/** First visible match within `timeout`, or null — never throws. */
async function visible(locator, timeout = 15000) {
  const first = locator.filter({ visible: true }).first();
  try {
    await first.waitFor({ state: "visible", timeout });
    return first;
  } catch {
    return null;
  }
}

async function dialogOverflow(dialog) {
  return dialog
    .evaluate((el) => ({ ok: el.scrollWidth <= el.clientWidth + 1, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    .catch(() => ({ ok: true, note: "no dialog element" }));
}

const WORKFLOWS = [
  {
    id: "store-order-detail",
    needs: "storeOrderId",
    run: async (page) => {
      await page.goto(`${BASE}/store-orders/${demo.storeOrderId}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const group = await visible(page.locator('[data-testid="trace-group"]'), 20000);
      const panel = await page.locator('[data-testid="trace-group"]').count();
      return { ok: Boolean(group), detail: `related-record groups=${panel}` };
    },
  },
  {
    id: "store-order-create-lines",
    run: async (page) => {
      await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const trigger = await visible(page.getByRole("button", { name: TXT.newOrder }));
      if (!trigger) return { ok: false, detail: "New Order button not visible" };
      await trigger.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      const line = await fillFirstLine(page, dialog);
      const dOverflow = await dialogOverflow(dialog);
      return { ok: line.ok && dOverflow.ok, detail: JSON.stringify({ line, dialogOverflow: dOverflow }) };
    },
  },
  {
    id: "store-order-edit-lines",
    needs: "storeOrderId",
    run: async (page) => {
      await page.goto(`${BASE}/store-orders/${demo.storeOrderId}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      await visible(page.locator('[data-testid="trace-group"]'), 20000);
      const trigger = await visible(page.getByRole("button", { name: TXT.lineEdit }), 3000);
      if (!trigger) return { ok: null, detail: "order state offers no line editor (invoiced/verified orders are locked)" };
      await trigger.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      const inputs = dialog.locator("input").filter({ visible: true });
      const n = await inputs.count();
      const boxes = [];
      for (let i = 0; i < Math.min(n, 6); i += 1) boxes.push(await inViewportX(page, inputs.nth(i)));
      const dOverflow = await dialogOverflow(dialog);
      return { ok: n > 0 && boxes.every((b) => b.ok) && dOverflow.ok, detail: JSON.stringify({ inputs: n, boxes, dialogOverflow: dOverflow }) };
    },
  },
  {
    id: "lead-conversion-dialog",
    needs: "leadId",
    run: async (page) => {
      await page.goto(`${BASE}/crm/leads/${demo.leadId}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      let trigger = await visible(page.getByRole("button", { name: TXT.convert }), 20000);
      if (!trigger) {
        const more = await visible(page.getByRole("button", { name: /More actions|مزيد من الإجراءات|المزيد/ }), 2000);
        if (more) await more.click();
        trigger = await visible(page.getByRole("menuitem", { name: TXT.convert }), 3000);
      }
      if (!trigger) return { ok: false, detail: "Convert to Order action not visible" };
      await trigger.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      const line = await fillFirstLine(page, dialog);
      const dOverflow = await dialogOverflow(dialog);
      return { ok: line.ok && dOverflow.ok, detail: JSON.stringify({ line, dialogOverflow: dOverflow }) };
    },
  },
  ...["generalLedger", "customerStatement", "supplierStatement"].map((report) => ({
    id: `reports-${report}`,
    run: async (page) => {
      await page.goto(`${BASE}/reports/finance?report=${report}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const tables = await page.locator("table").filter({ visible: true }).count();
      return { ok: true, detail: `visible tables=${tables}` };
    },
  })),
  {
    id: "exchange-rates",
    run: async (page) => {
      await page.goto(`${BASE}/finance/exchange-rates`, { waitUntil: "domcontentloaded" });
      await settle(page);
      return { ok: true, detail: "" };
    },
  },
  {
    id: "product-create-toggle",
    run: async (page) => {
      await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
      await settle(page);
      const trigger = await visible(page.getByRole("button", { name: TXT.addProduct }));
      if (!trigger) return { ok: false, detail: "Add Product button not visible" };
      await trigger.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      if (!(await dialog.getByText(TXT.investToggle).count())) {
        // Wizard: fill the three required basics, then Next until the Inventory step.
        await dialog.locator('input[name="name"]').first().fill(`${RUN} UI check (not saved)`).catch(() => {});
        const selects = dialog.locator('[role="combobox"]').filter({ visible: true });
        for (let i = 0; i < Math.min(await selects.count(), 2); i += 1) {
          const txt = (await selects.nth(i).innerText().catch(() => "")).trim();
          if (txt) continue;
          await selects.nth(i).click();
          await page.getByRole("option").filter({ visible: true }).first().click().catch(() => {});
        }
        for (let i = 0; i < 3 && !(await dialog.getByText(TXT.investToggle).count()); i += 1) {
          const next = dialog.getByRole("button", { name: TXT.next }).filter({ visible: true }).first();
          if (!(await next.count())) break;
          await next.click();
          await page.waitForTimeout(400);
        }
      }
      const toggle = dialog.getByText(TXT.investToggle).first();
      const vis = await inViewportX(page, toggle);
      const dOverflow = await dialogOverflow(dialog);
      return { ok: vis.ok && dOverflow.ok, detail: JSON.stringify({ toggle: vis, dialogOverflow: dOverflow }) };
    },
  },
  {
    id: "product-edit-toggle",
    needs: "productId",
    run: async (page) => {
      await page.goto(`${BASE}/products/${demo.productId}`, { waitUntil: "domcontentloaded" });
      await settle(page);
      let edit = await visible(page.getByRole("button", { name: TXT.edit }), 20000);
      if (!edit) edit = await visible(page.getByLabel(TXT.edit), 2000);
      if (!edit) return { ok: false, detail: "Edit action not visible" };
      await edit.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      if (!(await dialog.getByText(TXT.investToggle).filter({ visible: true }).count())) {
        const tab = dialog.getByRole("tab", { name: TXT.inventoryTab }).first();
        if (await tab.count()) await tab.click();
        await page.waitForTimeout(400);
      }
      const toggle = dialog.getByText(TXT.investToggle).first();
      const vis = await inViewportX(page, toggle);
      const checkbox = dialog.locator("label", { hasText: TXT.investToggle }).locator('[role="checkbox"]').first();
      const checked = (await checkbox.getAttribute("data-state").catch(() => null)) ?? (await checkbox.getAttribute("aria-checked").catch(() => null));
      const expectChecked = demo.product?.availableForInvestmentOpportunities === true;
      const stateOk = checked == null || !expectChecked || /checked|true/.test(checked);
      const dOverflow = await dialogOverflow(dialog);
      return { ok: vis.ok && stateOk && dOverflow.ok, detail: JSON.stringify({ toggle: vis, checked, expectChecked, dialogOverflow: dOverflow }) };
    },
  },
  {
    id: "countries-search",
    run: async (page, helpers) => {
      await page.goto(`${BASE}/master-data/countries`, { waitUntil: "domcontentloaded" });
      await settle(page);
      // The list toolbar's filter box ("تصفية..." / "Filter...") — not the TopBar global search.
      const search = await visible(
        page.locator('main input[type="search"], main input[placeholder*="تصفية"], main input[placeholder*="Filter" i], main input[placeholder*="بحث"], main input[placeholder*="Search" i]'),
      );
      if (!search) return { ok: false, detail: "list filter input not visible" };
      const out = {};
      for (const term of ["السعودية", "Saudi"]) {
        await search.fill(term);
        await page.waitForTimeout(700);
        await settle(page, { quietMs: 500, maxMs: 10000 });
        // Ignore the empty-state line that echoes the query ("No results for "Saudi"").
        const lines = (await page.locator("body").innerText().catch(() => ""))
          .split("\n")
          .filter((l) => !l.includes(`"${term}"`) && !l.includes(`“${term}”`));
        out[term] = lines.some((l) => /السعودية|Saudi Arabia/.test(l));
        if (helpers?.shot) await page.screenshot({ path: helpers.shot(`search-${term === "Saudi" ? "en" : "ar"}`) }).catch(() => {});
      }
      return { ok: Object.values(out).every(Boolean), detail: JSON.stringify(out) };
    },
  },
];

async function workflows(browser, storageState) {
  const list = WORKFLOWS.filter((w) => !ONLY || ONLY.includes(w.id));
  for (const wf of list) {
    if (wf.needs && !demo[wf.needs]) {
      check(`workflow ${wf.id}`, "BLOCKED", `missing demo ${wf.needs}`);
      continue;
    }
    for (const vk of VIEWPORT_KEYS) {
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          const combo = `${vk}-${locale}-${theme}`;
          const id = `workflow ${wf.id} [${combo}]`;
          const shot = resolve(WF_DIR, `${wf.id}-${combo}.png`);
          let ctx;
          try {
            ctx = await newContext(browser, { viewport: vk, locale, theme, storageState });
            const mon = monitor(ctx.page, id);
            const res = await wf.run(ctx.page, { shot: (suffix) => resolve(WF_DIR, `${wf.id}-${combo}-${suffix}.png`) });
            await ctx.page.waitForTimeout(250);
            const scroll = await noHorizontalScroll(ctx.page);
            const dir = await ctx.page.evaluate(() => document.documentElement.dir || getComputedStyle(document.documentElement).direction);
            const themeApplied = await ctx.page.evaluate(() => document.documentElement.classList.contains("dark"));
            const ui = await uiErrors(ctx.page);
            await ctx.page.screenshot({ path: shot }).catch(() => {});
            const problems = [];
            if (res.ok === false) problems.push("check failed");
            if (!scroll.ok) problems.push(`horizontal scroll ${scroll.scrollWidth}>${scroll.clientWidth}`);
            if ((locale === "ar") !== (dir === "rtl")) problems.push(`dir=${dir}`);
            if ((theme === "dark") !== themeApplied) problems.push(`theme not applied (dark=${themeApplied})`);
            if (ui.errorUi.length || ui.devOverlay) problems.push(`error UI ${ui.errorUi.join("|") || ui.devOverlay}`);
            if (ui.errorToasts.length) problems.push(`error toast ${ui.errorToasts.join(" | ")}`);
            if (mon.failed.length) problems.push(`api ${mon.failed.map((f) => `${f.status} ${f.method ?? ""} ${f.url.replace(API, "")}`).join(", ")}`);
            if (mon.pageErrors.length) problems.push(`pageerror ${mon.pageErrors[0]}`);
            const status = problems.length ? "FAIL" : res.ok === null ? "SKIP" : "PASS";
            check(id, status, [problems.join("; "), res.detail].filter(Boolean).join(" — "), {
              screenshot: rel(shot),
              scroll,
              dir,
              dark: themeApplied,
              failedApi: mon.failed.slice(0, 8),
              consoleErrors: mon.console.slice(0, 5),
            });
          } catch (error) {
            if (ctx) await ctx.page.screenshot({ path: shot }).catch(() => {});
            check(id, "FAIL", error.message.split("\n")[0], { screenshot: rel(shot) });
          } finally {
            await ctx?.context.close().catch(() => {});
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ (c) round trip
async function roundTrip(browser, storageState) {
  if (!demo.storeOrderId) {
    check("round trip", "BLOCKED", "no demo store order");
    return;
  }
  const { context, page } = await newContext(browser, { viewport: "desktop", locale: "en", theme: "light", storageState });
  const mon = monitor(page, "roundtrip");
  const origin = `${BASE}/store-orders/${demo.storeOrderId}`;
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await settle(page);
    await visible(page.locator('[data-testid="related-record-link"]'), 20000);
    const links = page.locator('[data-testid="related-record-link"]');
    const n = await links.count();
    const seen = new Set();
    const targets = [];
    for (let i = 0; i < n; i += 1) {
      const kind = await links.nth(i).getAttribute("data-kind");
      const text = (await links.nth(i).innerText()).trim().replace(/\s+/g, " ");
      if (seen.has(`${kind}|${text}`)) continue;
      seen.add(`${kind}|${text}`);
      targets.push({ index: i, kind, text });
    }
    check("round trip: related records present", targets.length ? "PASS" : "FAIL", targets.map((t) => `${t.kind}:${t.text}`).join(", ") || "no related-record links on store order detail");
    const kindsWanted = /SALES_INVOICE|JOURNAL_ENTRY|SHIPMENT|DELIVERY|INVENTORY_MOVEMENT|CUSTOMER_RECEIPT|PAYMENT/;
    for (const target of targets.filter((t) => kindsWanted.test(t.kind ?? ""))) {
      const id = `round trip ${target.kind} ${target.text}`;
      mon.reset(id);
      const shot = resolve(RT_DIR, `${target.kind}-${target.text.replace(/[^\w-]+/g, "_").slice(0, 40)}.png`);
      try {
        if (!page.url().startsWith(origin)) {
          await page.goto(origin, { waitUntil: "domcontentloaded" });
          await settle(page);
        }
        const link = page.locator('[data-testid="related-record-link"]').nth(target.index);
        await link.scrollIntoViewIfNeeded().catch(() => {});
        await link.click();
        const preview = page.locator('[data-testid="record-preview"]').last();
        await preview.waitFor({ timeout: 15000 });
        await settle(page, { maxMs: 10000 });
        const previewText = (await preview.innerText().catch(() => "")).slice(0, 200);
        const openFull = page.locator('[data-testid="record-preview-open-full"]').filter({ visible: true }).first();
        if (!(await openFull.count())) {
          await page.screenshot({ path: shot }).catch(() => {});
          const bad = mon.failed.length > 0;
          check(id, bad ? "FAIL" : "PASS", `preview only (kind has no full page)${bad ? ` api=${mon.failed.map((f) => `${f.status} ${f.url.replace(API, "")}`).join(",")}` : ""}`, { screenshot: rel(shot), previewText });
          await page.keyboard.press("Escape").catch(() => {});
          continue;
        }
        await Promise.all([page.waitForURL((u) => !u.href.startsWith(origin), { timeout: 30000 }), openFull.click()]);
        await settle(page);
        const dest = new URL(page.url()).pathname;
        const ui = await uiErrors(page);
        await page.screenshot({ path: shot }).catch(() => {});
        const destOk = Boolean(webRouteFile(dest)) && !ui.errorUi.length && !ui.devOverlay && !mon.failed.length;
        // back to the order
        await page.goBack({ waitUntil: "domcontentloaded" });
        await settle(page);
        const backOk = page.url().startsWith(origin) && (await page.locator('[data-testid="trace-group"]').count()) > 0;
        const problems = [];
        if (!webRouteFile(dest)) problems.push(`no page for ${dest}`);
        if (ui.errorUi.length || ui.devOverlay) problems.push(`error UI ${ui.errorUi.join("|")}`);
        if (mon.failed.length) problems.push(`api ${mon.failed.map((f) => `${f.status} ${f.url.replace(API, "")}`).join(", ")}`);
        if (!backOk) problems.push(`back navigation landed on ${page.url()}`);
        check(id, destOk && backOk ? "PASS" : "FAIL", `→ ${dest} → back ${backOk ? "ok" : "broken"}${problems.length ? ` — ${problems.join("; ")}` : ""}`, {
          screenshot: rel(shot),
          destination: dest,
          previewText,
        });
      } catch (error) {
        await page.screenshot({ path: shot }).catch(() => {});
        check(id, "FAIL", error.message.split("\n")[0], { screenshot: rel(shot) });
      }
    }
  } catch (error) {
    check("round trip", "FAIL", error.message.split("\n")[0]);
  } finally {
    await context.close().catch(() => {});
  }
}

// ------------------------------------------------------------------ main
async function main() {
  try {
    await setupData();
  } catch (error) {
    check("api setup", "FAIL", error.message);
  }
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  try {
    let storageState;
    try {
      const { context, page } = await uiLogin(browser);
      storageState = await context.storageState();
      if (process.env.SWEEP !== "0") await pageSweep(context, page);
      await context.close();
    } catch (error) {
      check("UI login / sweep", "FAIL", error.message.split("\n")[0]);
    }
    if (!storageState) {
      check("workflows", "BLOCKED", "no authenticated browser session");
      return;
    }
    if (process.env.WORKFLOWS !== "0") await workflows(browser, storageState);
    if (process.env.ROUNDTRIP !== "0") await roundTrip(browser, storageState);
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  check("unexpected error", "FAIL", error?.stack ?? String(error));
}
finish("browser-tour-report.json");
process.exit(0);
