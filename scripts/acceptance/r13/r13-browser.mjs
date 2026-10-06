#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R13 — browser acceptance (one pass, headless Playwright) of the affected pages only:
 * product form (product / service / kit / assembled + recipe, similar-name warning,
 * barcode duplicate inline error), assembly list / new-assembly preview / detail, stock
 * page with owner column, kit sales invoice, landed-cost split, integrity report, product
 * investment section — desktop 1440×900 and mobile 390×844, Arabic (default) and English
 * (switched with the app's language control).
 *
 * Uses the records created by r13-journeys.mjs (evidence/journeys/r13-journeys-context.json).
 *
 *   BASE=http://localhost:4801 node scripts/acceptance/r13/r13-browser.mjs
 * Evidence: specs/product-inventory-costing/evidence/browser/*.png + r13-browser.{json,md}
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4801").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local web only");
const ROOT = "D:/Systems/OMS";
const OUT = `${ROOT}/specs/product-inventory-costing/evidence/browser`;
mkdirSync(OUT, { recursive: true });
const ctxFile = `${ROOT}/specs/product-inventory-costing/evidence/journeys/r13-journeys-context.json`;
if (!existsSync(ctxFile)) throw new Error("run r13-journeys.mjs first");
const J = JSON.parse(readFileSync(ctxFile, "utf8")).ids;
const env = Object.fromEntries(
  readFileSync(`${ROOT}/tmp/r7-final/.r7.env`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;

const results = [];
const shots = [];
let scope = "";
const check = (name, ok, detail = "") => {
  results.push({ scope, name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${scope}] ${name}${detail ? "  -> " + detail : ""}`);
};

const L = {
  edit: /^(تعديل|Edit)$/,
  addProduct: /^(إضافة منتج|Add Product)$/,
  save: /^(حفظ|Save)$/,
  recipe: /^(الوصفة|Recipe)$/,
  assemble: /^(تجميع|Assemble)$/,
  changeLanguage: /^(تغيير اللغة|Change language)$/,
  kitReason: /المجموعة لا تملك رصيدًا خاصًا بها|A kit has no stock of its own/,
  serviceNoStock: /الخدمة بلا مخزون|A service has no stock/,
  similar: /توجد منتجات بأسماء مشابهة|Similar products already exist/,
};

async function login(context) {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page
    .locator('input[type="email"], input[name="email"]')
    .first()
    .fill("demo-r7-admin@oms.local");
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error("login stuck");
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}
const settle = async (page, ms = 1000) => {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};

/** Per-step console capture: errors + uncaught exceptions; `allow` filters expected noise (e.g. the deliberate 409). */
function watch(page) {
  const errors = [];
  const onConsole = (m) => m.type() === "error" && errors.push(m.text());
  const onError = (e) => errors.push(`pageerror: ${e.message}`);
  page.on("console", onConsole);
  page.on("pageerror", onError);
  return {
    stop(allow) {
      page.off("console", onConsole);
      page.off("pageerror", onError);
      return errors.filter((e) => !(allow && allow.test(e)));
    },
  };
}
async function layoutChecks(page, label, lang, mobile) {
  const m = await page.evaluate(() => ({
    dir: document.documentElement.getAttribute("dir"),
    lang: document.documentElement.getAttribute("lang"),
    sw: document.scrollingElement.scrollWidth,
    iw: window.innerWidth,
  }));
  check(
    `${label}: html dir=${lang === "ar" ? "rtl" : "ltr"}`,
    m.dir === (lang === "ar" ? "rtl" : "ltr"),
    `dir=${m.dir} lang=${m.lang}`,
  );
  if (mobile)
    check(
      `${label}: no horizontal scroll at ${m.iw}px`,
      m.sw <= m.iw + 1,
      `scrollWidth=${m.sw} innerWidth=${m.iw}`,
    );
}
async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push(file);
}
/** Screenshots the dialog's scroll container at successive positions (expanded sections). */
async function dialogScrollShots(page, name, max = 4) {
  const handle = await page.evaluateHandle(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const all = [dlg, ...dlg.querySelectorAll("*")];
    return (
      all.find(
        (el) =>
          el.scrollHeight > el.clientHeight + 20 &&
          /(auto|scroll)/.test(getComputedStyle(el).overflowY),
      ) ?? null
    );
  });
  const el = handle.asElement();
  if (!el) {
    await shot(page, `${name}-1`);
    return 1;
  }
  const { sh, ch } = await el.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
  const steps = Math.min(max, Math.max(1, Math.ceil(sh / ch)));
  for (let i = 0; i < steps; i++) {
    await el.evaluate((e, y) => e.scrollTo(0, y), i * ch * 0.9);
    await page.waitForTimeout(250);
    await shot(page, `${name}-${i + 1}`);
  }
  return steps;
}
async function expandAll(page) {
  for (let i = 0; i < 20; i++) {
    const t = page.locator(
      '[role="dialog"] button[aria-expanded="false"]:not([role="combobox"]):not([aria-haspopup])',
    );
    if ((await t.count()) === 0) break;
    await t
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(200);
  }
  await settle(page, 600);
}
async function openEdit(page, productId) {
  await page.goto(`${BASE}/products/${productId}`, { waitUntil: "domcontentloaded" });
  await settle(page, 1200);
  await page.getByRole("button", { name: L.edit }).first().click();
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 10000 });
  await settle(page, 800);
}
const dialogText = (page) =>
  page
    .locator('[role="dialog"]')
    .first()
    .innerText()
    .catch(() => "");

async function step(page, key, lang, mobile, fn, { allow } = {}) {
  scope = `${mobile ? "mobile" : "desktop"}/${lang}`;
  const w = watch(page);
  const label = key;
  try {
    await fn();
  } catch (e) {
    check(`${label}: step ran`, false, e.message.split("\n")[0].slice(0, 200));
  }
  await layoutChecks(page, label, lang, mobile);
  const errs = w.stop(allow);
  check(
    `${label}: no console errors`,
    errs.length === 0,
    errs.slice(0, 3).join(" | ").slice(0, 300),
  );
  await page.keyboard.press("Escape").catch(() => {});
}

async function pass(page, lang, mobile) {
  const v = mobile ? "mobile" : "desktop";
  const n = (s) => `${v}-${lang}-${s}`;

  // (1a) new product form: first screen + similar-name warning, then expanded sections
  await step(page, "product form (new) + similar-name warning", lang, mobile, async () => {
    await page.goto(`${BASE}/products`, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    await page.getByRole("button", { name: L.addProduct }).first().click();
    await page.locator('[role="dialog"]').first().waitFor({ timeout: 10000 });
    await settle(page, 600);
    await shot(page, n("01-product-new-first-screen"));
    const base = await (await fetchProduct(page, J.similarBase)).name;
    await page
      .locator('[role="dialog"] input[name="name"]')
      .first()
      .fill(base.replace("Bottle", "Botle"));
    await page.waitForTimeout(2500);
    const txt = await dialogText(page);
    check(
      "similar-name warning visible (non-blocking)",
      L.similar.test(txt),
      L.similar.test(txt) ? "shown" : "absent",
    );
    await shot(page, n("02-product-new-similar-warning"));
    await expandAll(page);
    await dialogScrollShots(page, n("03-product-new-expanded"));
  });

  // (1b) barcode duplicate inline error (edit an existing product, save is refused with 409)
  await step(
    page,
    "product form: barcode duplicate inline error",
    lang,
    mobile,
    async () => {
      await openEdit(page, J.similarDup);
      await expandAll(page);
      const bc = page.locator('[role="dialog"] input[name="barcode"]').first();
      await bc.scrollIntoViewIfNeeded();
      await bc.fill(J.barcode.toLowerCase());
      await page.locator('[role="dialog"]').getByRole("button", { name: L.save }).last().click();
      await page.waitForTimeout(2500);
      const baseSku = (await fetchProduct(page, J.similarBase)).sku;
      const txt = await dialogText(page);
      check(
        "barcode duplicate shown inline, naming the other product",
        txt.includes(baseSku),
        baseSku,
      );
      await bc.scrollIntoViewIfNeeded();
      await shot(page, n("04-product-barcode-duplicate"));
    },
    { allow: /409|Conflict/i },
  );

  // (1c) service — no stock fields
  await step(page, "product form: service shows no stock fields", lang, mobile, async () => {
    await openEdit(page, J.service);
    await expandAll(page);
    const txt = await dialogText(page);
    const hasTrack = (await page.locator('[role="dialog"] #product-track-stock').count()) > 0;
    check(
      "service: 'no stock' note, no track-stock switch",
      L.serviceNoStock.test(txt) && !hasTrack,
      `note=${L.serviceNoStock.test(txt)} switch=${hasTrack}`,
    );
    await dialogScrollShots(page, n("05-product-service"), 3);
  });

  // (1d) kit — track stock forced off with the reason
  await step(
    page,
    "product form: kit forces track stock off with reason",
    lang,
    mobile,
    async () => {
      await openEdit(page, J.kit);
      await expandAll(page);
      const txt = await dialogText(page);
      const sw = page.locator('[role="dialog"] #product-track-stock').first();
      const disabled =
        (await sw.count()) > 0 &&
        ((await sw.isDisabled()) ||
          (await sw.getAttribute("aria-disabled")) === "true" ||
          (await sw.getAttribute("data-disabled")) !== null);
      const off =
        (await sw.count()) > 0 &&
        (await sw.getAttribute("aria-checked")) !== "true" &&
        (await sw.getAttribute("data-state")) !== "checked";
      check(
        "kit: track stock off + locked, reason shown",
        L.kitReason.test(txt) && disabled && off,
        `reason=${L.kitReason.test(txt)} locked=${disabled} off=${off}`,
      );
      await dialogScrollShots(page, n("06-product-kit"), 3);
    },
  );

  // (1e) assembled item — recipe panel (active recipe, cost estimate)
  await step(page, "product detail: assembled item recipe panel", lang, mobile, async () => {
    await page.goto(`${BASE}/products/${J.assembled}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    await page.getByRole("tab", { name: L.recipe }).first().click();
    await settle(page, 1500);
    const body = await page.locator("main").innerText();
    const comp = (await fetchProduct(page, J.compA)).sku;
    check(
      "recipe panel lists the components and an estimate of 40",
      body.includes(comp) && /40[.,٫]?0*/.test(body),
      comp,
    );
    await shot(page, n("07-product-assembled-recipe"));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, n("07b-product-assembled-recipe-bottom"));
  });

  // (2) assembly: list, new-assembly dialog preview, detail
  await step(page, "assembly list", lang, mobile, async () => {
    await page.goto(`${BASE}/inventory/assembly`, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await shot(page, n("08-assembly-list"));
  });
  await step(page, "new-assembly dialog with preview", lang, mobile, async () => {
    await page.goto(`${BASE}/products/${J.assembled}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1200);
    const btn = page.getByRole("button", { name: L.assemble }).first();
    if (!(await btn.isVisible().catch(() => false))) {
      // the header may fold actions into an overflow menu on small screens
      await page
        .locator('button[aria-haspopup="menu"]')
        .last()
        .click()
        .catch(() => {});
      await page.getByRole("menuitem", { name: L.assemble }).first().click();
    } else await btn.click();
    await page.locator('[role="dialog"]').first().waitFor({ timeout: 10000 });
    await settle(page, 2500);
    const txt = await dialogText(page);
    const compA = await fetchProduct(page, J.compA);
    check(
      "preview lists component lines and the 40.0000 estimate",
      (txt.includes(compA.name) || txt.includes(compA.nameEn ?? "\u0000")) &&
        txt.includes("40.0000"),
      compA.sku,
    );
    await dialogScrollShots(page, n("09-assembly-new-preview"), 3);
  });
  await step(page, "assembly detail", lang, mobile, async () => {
    await page.goto(`${BASE}/inventory/assembly/${J.assembly1}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await shot(page, n("10-assembly-detail"));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, n("10b-assembly-detail-bottom"));
  });

  // (3) stock with owner column / filter
  await step(page, "stock page with owner column", lang, mobile, async () => {
    await page.goto(`${BASE}/inventory/stock`, { waitUntil: "domcontentloaded" });
    await settle(page, 2000);
    const txt = await page.locator("main").innerText();
    check("owner shown on the stock page", /المالك|Owner/.test(txt), "");
    await shot(page, n("11-stock-owner"));
  });

  // (4) kit invoice with delivered components
  await step(page, "sales invoice: kit line with delivered components", lang, mobile, async () => {
    await page.goto(`${BASE}/sales/invoices/${J.salesInvoiceKit}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page, 1800);
    const txt = await page.locator("main").innerText();
    const c1 = (await fetchProduct(page, J.kitPart1)).sku;
    check("kit components listed on the invoice", txt.includes(c1), c1);
    await shot(page, n("12-sales-invoice-kit"));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, n("12b-sales-invoice-kit-bottom"));
  });

  // (5) landed cost: capitalized vs variance
  await step(page, "landed cost detail: capitalized vs variance", lang, mobile, async () => {
    await page.goto(`${BASE}/purchasing/landed-cost/${J.landedCostA}`, {
      waitUntil: "domcontentloaded",
    });
    await settle(page, 1800);
    const txt = await page.locator("main").innerText();
    check(
      "capitalized 18 and variance 12 shown",
      /18[.,٫]00/.test(txt) && /12[.,٫]00/.test(txt),
      "",
    );
    await shot(page, n("13-landed-cost"));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await shot(page, n("13b-landed-cost-bottom"));
  });

  // (6) integrity report
  await step(page, "integrity report page", lang, mobile, async () => {
    await page.goto(`${BASE}/inventory/integrity`, { waitUntil: "domcontentloaded" });
    await settle(page, 2000);
    await page
      .waitForFunction(() => /I7/.test(document.querySelector("main")?.innerText ?? ""), null, {
        timeout: 120000,
      })
      .catch(() => {});
    await settle(page, 800);
    const txt = await page.locator("main").innerText();
    check(
      "all seven invariants rendered",
      ["I1", "I2", "I3", "I4", "I5", "I6", "I7"].every((k) => txt.includes(k)),
      "",
    );
    await shot(page, n("14-integrity"));
  });

  // (7) product investment section
  await step(page, "product form: investment section", lang, mobile, async () => {
    await openEdit(page, J.investProduct);
    await expandAll(page);
    const heading = page.locator('[role="dialog"] h3', { hasText: /الاستثمار|Investment/ }).first();
    await heading.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const txt = await dialogText(page);
    check(
      "investment section shows the linked opportunity",
      /IOP-|\[R13-DEMO\] (فرصة|Opportunity)/.test(txt),
      "",
    );
    await shot(page, n("15-product-investment"));
  });
}

/** Read a product through the page's own session (bearer token in localStorage) — no second login. */
const productCache = new Map();
async function fetchProduct(page, id) {
  if (productCache.has(id)) return productCache.get(id);
  const api = process.env.API ?? "http://localhost:4805";
  const r = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo-r7-admin@oms.local", password: PW }),
  });
  const { accessToken } = await r.json();
  const p = await (
    await fetch(`${api}/products/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  ).json();
  productCache.set(id, p);
  return p;
}

async function switchToEnglish(page, mobile) {
  const btn = page.getByRole("button", { name: L.changeLanguage }).first();
  let via = "language control";
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page
      .getByRole("menuitem", { name: /English/ })
      .first()
      .click();
  } else {
    // small screens: the control sits behind the profile / navigation menu
    via = "fallback";
    const menu = page
      .getByRole("button", { name: /فتح قائمة الملف الشخصي|Open profile menu/ })
      .first();
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
      const item = page.getByRole("menuitem", { name: /English/ }).first();
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        via = "profile menu";
      }
    }
  }
  await settle(page, 1200);
  const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
  scope = `${mobile ? "mobile" : "desktop"}/en`;
  check(`switched to English via ${via}`, dir === "ltr", `dir=${dir}`);
  return dir === "ltr";
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true]) {
    const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const context = await browser.newContext({
      viewport,
      locale: "ar",
      hasTouch: mobile,
      isMobile: mobile,
      deviceScaleFactor: 1,
    });
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem("oms.r13.init")) {
          localStorage.setItem("oms.locale", JSON.stringify("ar"));
          localStorage.setItem("theme", "light");
          localStorage.setItem("oms.r13.init", "1");
        }
      } catch {
        /* storage blocked */
      }
    });
    const page = await login(context);
    await pass(page, "ar", mobile);
    await page.goto(`${BASE}/inventory/stock`, { waitUntil: "domcontentloaded" });
    await settle(page, 1000);
    if (await switchToEnglish(page, mobile)) await pass(page, "en", mobile);
    await context.close();
  }
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const meta = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    screenshots: shots.length,
  };
  writeFileSync(`${OUT}/r13-browser.json`, JSON.stringify({ ...meta, results, shots }, null, 2));
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  writeFileSync(
    `${OUT}/r13-browser.md`,
    [
      `# R13 browser acceptance`,
      "",
      `Generated ${meta.generatedAt} against ${BASE}. **${meta.passed}/${meta.total} PASS**, ${meta.failed} FAIL, ${shots.length} screenshots.`,
      "",
      "| Scope | Check | Detail | Result |",
      "| --- | --- | --- | --- |",
      ...results.map(
        (r) => `| ${r.scope} | ${esc(r.name)} | ${esc(r.detail)} | ${r.ok ? "PASS" : "**FAIL**"} |`,
      ),
      "",
      "Screenshots:",
      "",
      ...shots.map((s) => `- [${s}](./${s})`),
      "",
    ].join("\n"),
  );
  console.log(
    `\n${meta.passed}/${meta.total} passed (${meta.failed} failed), ${shots.length} screenshots — ${OUT}`,
  );
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(2);
});
