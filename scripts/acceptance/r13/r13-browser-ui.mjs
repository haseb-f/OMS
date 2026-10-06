#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R13 — UI-DRIVEN browser journeys (headless Playwright). Unlike r13-browser.mjs (which only VIEWS records
 * created through the API), every business record here is created and acted on THROUGH THE UI:
 *
 *  1. Products → Add product: PURCHASED tracked component X (category default unit prefilled + "from category"
 *     hint), component Y, a SERVICE (no stock fields), a KIT (track stock forced off with reason), an ASSEMBLED item.
 *  2. Similar-name warning while typing a near-duplicate name; the save still goes through.
 *  3. Recipes: ASSEMBLED = X×2 + Y×1, KIT = Y×1 — created and activated on the product's Recipe tab.
 *  4. Opening inventory for X and Y from Inventory → Movements (with a unit cost); stock page shows them.
 *  5. Inventory → Assembly → New assembly with preview → ASM- number → detail → reverse (reason) → assemble again.
 *  6. Tracking lock: turning "Track stock" off on X (has stock) is refused with PRODUCT_TRACKING_LOCKED.
 *  7. Kit availability on the KIT's recipe tab (matches the API).
 *  8. Inventory → Integrity: no FAIL card.
 *  9. Agent portal (agent persona): stock + orders render, no cost columns, no console errors.
 * 10. English once on the product list and the assembly list (dir=ltr).
 * Steps 1 and 5 are repeated at 390×844 (mobile) with a no-horizontal-scroll assertion.
 *
 * The API is used ONLY to read state for assertions (GET) — never to create or change data.
 *
 *   BASE=http://localhost:4801 API=http://localhost:4805 node scripts/acceptance/r13/r13-browser-ui.mjs
 * Evidence: specs/product-inventory-costing/evidence/browser-ui/*.png + r13-browser-ui.{json,md}
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4801").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4805").replace(/\/$/, "");
for (const url of [BASE, API]) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error("local hosts only");
}
const ROOT = "D:/Systems/OMS";
const OUT = `${ROOT}/specs/product-inventory-costing/evidence/browser-ui`;
mkdirSync(OUT, { recursive: true });
const ctxFile = `${ROOT}/specs/product-inventory-costing/evidence/journeys/r13-journeys-context.json`;
if (!existsSync(ctxFile))
  throw new Error("run r13-journeys.mjs first (category / warehouse context)");
const J = JSON.parse(readFileSync(ctxFile, "utf8")).ids;
const env = Object.fromEntries(
  readFileSync(`${ROOT}/tmp/r7-final/.r7.env`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;
const ADMIN = "demo-r7-admin@oms.local";
const AGENT = process.env.AGENT_EMAIL ?? "agent-a-admin.demo-agt@oms.local";

const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const TAG = "[R13-UI]";
const NAMES = {
  compX: `${TAG} Component X ${RUN}`,
  compY: `${TAG} Component Y ${RUN}`,
  similar: `${TAG} Componet X ${RUN}`,
  service: `${TAG} Service ${RUN}`,
  kit: `${TAG} Kit ${RUN}`,
  assembled: `${TAG} Assembled ${RUN}`,
  mobile: `${TAG} Mobile Part ${RUN}`,
};
const ids = {};

// ── result bookkeeping ───────────────────────────────────────────────────────
const results = [];
const shots = [];
let current = { step: "", scope: "" };
const check = (name, ok, detail = "") => {
  results.push({ ...current, name, ok: !!ok, detail: String(detail) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  [${current.step} ${current.scope}] ${name}${detail !== "" ? "  -> " + detail : ""}`,
  );
};
const latin = (s) =>
  String(s)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٬/g, ",");

// ── Arabic (default) / English labels, from apps/web/src/i18n/messages ───────
const L = {
  addProduct: /^(إضافة منتج|Add Product)$/,
  save: /^(حفظ|Save)$/,
  edit: /^(تعديل|Edit)$/,
  itemType: /^(نوع الصنف|Item type)/,
  supplyMethod: /^(طريقة التوريد|Supply method)/,
  service: /^(خدمة|Service)$/,
  kitRadio: /^(مجموعة \(Kit\)|Kit)$/,
  assembledRadio: /^(مجمَّع|Assembled)$/,
  category: /^(الفئة|Category)/,
  unit: /^(وحدة القياس|Unit)/,
  status: /^(الحالة|Status)/,
  active: /^(نشط|Active)$/,
  fromCategory: /تمت تعبئة الوحدة والضريبة من الفئة/,
  created: /تم إنشاء المنتج بنجاح/,
  returnToList: /^(العودة إلى قائمة المنتجات|Return to product list)$/,
  similar: /توجد منتجات بأسماء مشابهة/,
  serviceNoStock: /الخدمة بلا مخزون/,
  kitReason: /المجموعة لا تملك رصيدًا خاصًا بها/,
  assembledReason: /الصنف المجمَّع يُتتبَّع دائمًا في المخزون/,
  recipeTab: /^(الوصفة|Recipe)$/,
  createRecipe: /^(إنشاء وصفة|Create recipe)$/,
  activate: /^(تفعيل|Activate)$/,
  activated: /تم تفعيل الإصدار/,
  newMovement: /^(حركة جديدة|New movement)/,
  openingInventory: /^(الرصيد الافتتاحي|Opening inventory)$/,
  openingDone: /تم تسجيل الرصيد الافتتاحي/,
  product: /^(المنتج|Product)/,
  warehouse: /^(المستودع|Warehouse)/,
  quantity: /^(الكمية|Quantity)$/,
  unitCost: /^(متوسط التكلفة|Average cost)/,
  newAssembly: /^(تجميع جديد|New assembly)$/,
  assemble: /^(تجميع|Assemble)$/,
  submitAssembly: /^(تنفيذ التجميع|Assemble now|Post assembly)$/,
  assemblyPosted: /تم ترحيل التجميع (ASM-[\w-]+)/,
  openAssembly: /^(فتح أمر التجميع|Open assembly)$/,
  more: /^(المزيد|More)$/,
  reverse: /^(عكس التجميع|Reverse assembly)$/,
  reversed: /تم عكس التجميع/,
  posted: /مُرحّل/,
  reversedBadge: /معكوس/,
  trackingLocked: /لا يمكن إيقاف تتبع المخزون أو تحويل المنتج إلى خدمة ما دام له رصيد أو حجوزات/,
  kitAvailability: /توفّر المجموعة[\s\S]*?المجموعات المتاحة الآن:\s*([\d,]+)/,
  integrityFail: /غير سليم(?!ة)/,
  addNew: /^(إضافة جديد|Add new)$/,
  defaultUnit: /^(الوحدة الافتراضية|Default unit)/,
  saved: /تم الحفظ|Saved/,
  changeLanguage: /^(تغيير اللغة|Change language)$/,
};

// ── read-only API (assertions only) ──────────────────────────────────────────
let TOKEN = null;
async function apiLogin() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PW }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`api login ${r.status}`);
  TOKEN = j.accessToken;
}
async function get(path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

// ── browser helpers ──────────────────────────────────────────────────────────
async function newContext(browser, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    locale: "ar",
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("oms.r13ui.init")) {
        localStorage.setItem("oms.locale", JSON.stringify("ar"));
        localStorage.setItem("theme", "light");
        localStorage.setItem("oms.r13ui.init", "1");
      }
    } catch {
      /* storage blocked */
    }
  });
  return context;
}
async function login(context, email) {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error(`login stuck for ${email}`);
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}
const settle = async (page, ms = 800) => {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page, 1000);
}
async function shot(page, name) {
  const file = `${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push(file);
}
const dialog = (page) => page.locator('[role="dialog"]').last();
const toastWith = (page, re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first();

/** Opens an EntityCombobox / SearchableSelect trigger, types the search and clicks the matching option. */
async function pick(page, trigger, search, optionText) {
  await trigger.click();
  const input = page.locator("[cmdk-input]").last();
  await input.waitFor({ state: "visible", timeout: 10000 });
  if (search) await input.fill(search);
  const option = page.getByRole("option").filter({ hasText: optionText }).first();
  await option.waitFor({ state: "visible", timeout: 20000 });
  await option.click();
  await page.waitForTimeout(300);
}
/** A Radix Select: open the trigger, click the option by name. */
async function choose(page, trigger, optionName) {
  await trigger.click();
  await page.getByRole("option", { name: optionName }).first().click();
  await page.waitForTimeout(200);
}
/** Clicks a header action; on a phone it may sit in the overflow ("More") menu. */
async function headerAction(page, name) {
  const btn = page.getByRole("button", { name }).first();
  if (await btn.isVisible().catch(() => false)) return btn.click();
  await page.getByRole("button", { name: L.more }).first().click();
  await page.getByRole("menuitem", { name }).first().click();
}
async function noHorizontalScroll(page, label) {
  const m = await page.evaluate(() => ({
    sw: document.scrollingElement.scrollWidth,
    iw: window.innerWidth,
  }));
  check(`${label}: no horizontal scroll at ${m.iw}px`, m.sw <= m.iw + 1, `scrollWidth=${m.sw}`);
}
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
/** One step: runs `fn`, records a crash as a FAIL, then the console-error check. */
async function step(page, stepId, scope, fn, { allow } = {}) {
  current = { step: stepId, scope };
  const w = watch(page);
  try {
    await fn();
  } catch (e) {
    check("step ran to completion", false, e.message.split("\n")[0].slice(0, 240));
    await shot(
      page,
      `fail-${stepId}-${scope.replace(/[^\w]+/g, "-")}-${Date.now().toString(36)}`,
    ).catch(() => {});
  }
  const errs = w.stop(allow);
  check("no console errors", errs.length === 0, errs.slice(0, 3).join(" | ").slice(0, 300));
  await page.keyboard.press("Escape").catch(() => {});
}
const isPost = (re) => (r) => r.request().method() === "POST" && re.test(new URL(r.url()).pathname);

// ── flows ────────────────────────────────────────────────────────────────────
/**
 * Products → Add product → fill → Save. kind: PURCHASED | SERVICE | KIT | ASSEMBLED.
 * Returns the created product row (from the UI's own POST response).
 */
async function createProduct(page, { key, name, kind, shotName, afterName }) {
  await go(page, "/products");
  await page.getByRole("button", { name: L.addProduct }).first().click();
  const dlg = dialog(page);
  await dlg.waitFor({ timeout: 10000 });
  await settle(page, 400);
  await dlg.locator('input[name="name"]').first().fill(name);
  if (afterName) await afterName(dlg);

  if (kind === "SERVICE") {
    await dlg
      .getByRole("radiogroup", { name: L.itemType })
      .getByRole("radio", { name: L.service })
      .click();
  } else if (kind === "KIT" || kind === "ASSEMBLED") {
    await dlg
      .getByRole("radiogroup", { name: L.supplyMethod })
      .getByRole("radio", { name: kind === "KIT" ? L.kitRadio : L.assembledRadio })
      .click();
  }
  await page.waitForTimeout(200);

  // Category with a default unit → unit prefilled + "from category" hint.
  await pick(page, dlg.getByRole("combobox", { name: L.category }), CATEGORY.name, CATEGORY.name);
  const unitText = (await dlg.getByRole("combobox", { name: L.unit }).innerText()).trim();
  const hint = L.fromCategory.test(await dlg.innerText());
  check(
    `${key}: unit prefilled from the category + hint`,
    unitText.includes(CATEGORY.unitName) && hint,
    `unit="${unitText}" expected="${CATEGORY.unitName}" hint=${hint}`,
  );
  await choose(page, dlg.getByRole("combobox", { name: L.status }), L.active);

  // Attribute rules visible on the form.
  const sw = dlg.locator("#product-track-stock");
  const hasSwitch = (await sw.count()) > 0;
  const checked = hasSwitch && (await sw.getAttribute("aria-checked")) === "true";
  const locked = hasSwitch && (await sw.isDisabled());
  const txt = await dlg.innerText();
  if (kind === "SERVICE") {
    check(
      `${key}: stock fields hidden for a service`,
      !hasSwitch && L.serviceNoStock.test(txt),
      `switch=${hasSwitch} note=${L.serviceNoStock.test(txt)}`,
    );
  } else if (kind === "KIT") {
    check(
      `${key}: track stock forced OFF with the reason`,
      hasSwitch && !checked && locked && L.kitReason.test(txt),
      `checked=${checked} locked=${locked} reason=${L.kitReason.test(txt)}`,
    );
  } else if (kind === "ASSEMBLED") {
    check(
      `${key}: track stock forced ON with the reason`,
      hasSwitch && checked && locked && L.assembledReason.test(txt),
      `checked=${checked} locked=${locked}`,
    );
  } else {
    check(`${key}: track stock ON and editable`, checked && !locked, `checked=${checked}`);
  }
  if (shotName) await shot(page, shotName);

  const [resp] = await Promise.all([
    page.waitForResponse(isPost(/\/products$/), { timeout: 30000 }),
    dlg.getByRole("button", { name: L.save }).last().click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  check(`${key}: saved (POST /products ${resp.status()})`, resp.ok(), body.sku ?? body.message);
  const toastOk = await toastWith(page, L.created)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(`${key}: success toast`, toastOk, "تم إنشاء المنتج بنجاح.");
  // The post-create fork dialog — back to the list.
  const back = page.getByRole("button", { name: L.returnToList }).first();
  if (await back.isVisible({ timeout: 5000 }).catch(() => false)) {
    await shot(page, `${shotName}-success`).catch(() => {});
    await back.click();
  }
  await settle(page, 300);
  if (resp.ok()) ids[key] = body.id;
  return body;
}

/** Product → Recipe tab → Create recipe → add components (quantities) → Activate → confirm. */
async function createRecipe(page, productKey, lines, shotName) {
  await go(page, `/products/${ids[productKey]}`);
  await page.getByRole("tab", { name: L.recipeTab }).first().click();
  await settle(page, 800);
  const panel = page.getByRole("tabpanel").first();
  await panel.getByRole("button", { name: L.createRecipe }).click();
  await page.waitForTimeout(400);
  for (const [i, line] of lines.entries()) {
    const comp = await get(`/products/${ids[line.key]}`);
    await pick(page, panel.locator("#recipe-add-component"), comp.sku, comp.sku);
    await panel.getByRole("spinbutton", { name: L.quantity }).nth(i).fill(String(line.qty));
  }
  await shot(page, `${shotName}-draft`);
  await panel.getByRole("button", { name: L.activate }).click();
  const confirm = page.getByRole("alertdialog").last();
  await confirm.waitFor({ timeout: 10000 });
  await confirm.getByRole("button", { name: L.activate }).click();
  const toastOk = await toastWith(page, L.activated)
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await settle(page, 1200);
  const recipes = await get(`/products/${ids[productKey]}/recipes`);
  const active = recipes.find((r) => r.status === "ACTIVE");
  const got = (active?.lines ?? [])
    .map((l) => `${l.componentSku}×${Number(l.quantity)}`)
    .sort()
    .join(", ");
  const want = [];
  for (const line of lines)
    want.push(`${(await get(`/products/${ids[line.key]}`)).sku}×${line.qty}`);
  check(
    `${productKey}: recipe ACTIVE with the chosen components`,
    toastOk && active && got === want.sort().join(", "),
    `toast=${toastOk} status=${active?.status ?? "none"} lines=${got}`,
  );
  const badge = await panel.innerText();
  check(`${productKey}: panel shows status ACTIVE`, /نشط/.test(badge), "");
  await shot(page, shotName);
}

/** Inventory → Movements → New movement → Opening inventory. */
async function openingInventory(page, key, qty, cost, shotName) {
  await go(page, "/inventory/movements");
  await page.getByRole("button", { name: L.newMovement }).first().click();
  await page.getByRole("menuitem", { name: L.openingInventory }).first().click();
  const dlg = dialog(page);
  await dlg.waitFor({ timeout: 10000 });
  const p = await get(`/products/${ids[key]}`);
  await pick(page, dlg.getByRole("combobox", { name: L.product }), p.sku, p.sku);
  await pick(
    page,
    dlg.getByRole("combobox", { name: L.warehouse }),
    WAREHOUSE.code,
    WAREHOUSE.name,
  );
  await dlg.getByLabel(L.quantity).fill(String(qty));
  await dlg.getByLabel(L.unitCost).fill(String(cost));
  await shot(page, shotName);
  const [resp] = await Promise.all([
    page.waitForResponse(isPost(/\/inventory\/opening-balance$/), { timeout: 30000 }),
    dlg.getByRole("button", { name: L.save }).last().click(),
  ]);
  const toastOk = await toastWith(page, L.openingDone)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check(
    `${key}: opening inventory ${qty} @ ${cost} saved + toast`,
    resp.ok() && toastOk,
    resp.status(),
  );
  await settle(page, 500);
}

async function onHand(key) {
  const card = await get(`/inventory/stock-card/${ids[key]}`);
  const n =
    card.onHand ??
    card.quantityOnHand ??
    (card.warehouses ?? card.balances ?? []).reduce(
      (s, w) => s + Number(w.onHand ?? w.quantity ?? 0),
      0,
    );
  return Number(n);
}

/** Opens the New assembly dialog (from the list, or the product page's "Assemble"), runs it, returns {id, number}. */
async function runAssembly(page, { from, shotName, mobile }) {
  const asm = await get(`/products/${ids.assembled}`);
  if (from === "product") {
    await go(page, `/products/${ids.assembled}`);
    await headerAction(page, L.assemble);
  } else {
    await go(page, "/inventory/assembly");
    await headerAction(page, L.newAssembly);
  }
  const dlg = dialog(page);
  await dlg.waitFor({ timeout: 10000 });
  await settle(page, 600);
  if (from !== "product") {
    await pick(page, dlg.getByRole("combobox", { name: L.product }), asm.sku, asm.sku);
  }
  await dlg.getByLabel(L.quantity).fill("1");
  const x = await get(`/products/${ids.compX}`);
  const y = await get(`/products/${ids.compY}`);
  // Preview: component lines with needs / availability and the estimated cost.
  const ready = await dlg
    .getByText(/تكلفة الوحدة التقديرية/)
    .first()
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const txt = await dlg.innerText();
  check(
    "preview lists both components, needed/available and the estimated unit cost",
    ready &&
      txt.includes(x.name) &&
      txt.includes(y.name) &&
      /المطلوب/.test(txt) &&
      /المتاح/.test(txt) &&
      /35\.0000/.test(latin(txt)),
    `ready=${ready} components=${txt.includes(x.name)}/${txt.includes(y.name)} estimate 2×10+1×15=35.0000:${/35\.0000/.test(latin(txt))}`,
  );
  if (mobile) await noHorizontalScroll(page, "new-assembly dialog");
  await shot(page, `${shotName}-preview`);
  const submit = dlg.getByRole("button", { name: L.submitAssembly });
  const [resp] = await Promise.all([
    page.waitForResponse(isPost(/\/assembly$/), { timeout: 30000 }),
    submit.click(),
  ]);
  const body = await resp.json().catch(() => ({}));
  const toast = toastWith(page, L.assemblyPosted);
  const toastText = await toast
    .innerText({ timeout: 10000 })
    .then((t) => t)
    .catch(() => "");
  const num = (toastText.match(L.assemblyPosted) ?? [])[1] ?? "";
  check(
    "assembly posted: success toast with an ASM- number",
    resp.ok() && /^ASM-/.test(num) && num === body.assemblyNumber,
    `${resp.status()} toast=${num} api=${body.assemblyNumber}`,
  );
  await shot(page, `${shotName}-posted`);
  return { id: body.id, number: body.assemblyNumber, toast };
}

// ── main ─────────────────────────────────────────────────────────────────────
let CATEGORY = null;
let WAREHOUSE = null;

async function main() {
  await apiLogin();
  const cat = await get(`/product-categories/${J.categoryId}`);
  if (!cat.defaultUnitId) throw new Error("context category has no default unit");
  const unit = (await get(`/units/${cat.defaultUnitId}`)).name;
  const demoCategory = { id: cat.id, name: cat.name, unitName: unit };
  const wh = await get(`/warehouses/${J.warehouseId}`);
  WAREHOUSE = { name: wh.name, code: wh.code };
  console.log(
    `run ${RUN} — context category "${demoCategory.name}" (unit ${unit}), warehouse ${WAREHOUSE.code}`,
  );

  const browser = await chromium.launch({ headless: true });
  const desk = await newContext(browser, false);
  const page = await login(desk, ADMIN);

  // (0) setup: the existing category with a default unit must be selectable in the product form; a
  // category with a default unit is then created through Master data → Categories for the journey.
  await step(page, "0", "desktop/ar", async () => {
    await go(page, "/products");
    await page.getByRole("button", { name: L.addProduct }).first().click();
    const dlg = dialog(page);
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole("combobox", { name: L.category }).click();
    const input = page.locator("[cmdk-input]").last();
    await input.waitFor({ state: "visible", timeout: 10000 });
    await input.fill(demoCategory.name);
    const found = await page
      .getByRole("option")
      .filter({ hasText: demoCategory.name })
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    const totals = await get(`/product-categories?pageSize=1`);
    check(
      "existing category with a default unit is selectable in the product form (D1)",
      found,
      found
        ? demoCategory.name
        : `"${demoCategory.name}" not offered — selector loads only the first 200 of ${totals.total} categories (name order)`,
    );
    await shot(page, "00a-category-selector-cap");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await go(page, "/master-data/categories");
    await page.getByRole("button", { name: L.addNew }).first().click();
    const cdlg = dialog(page);
    await cdlg.waitFor({ timeout: 10000 });
    const name = `Acceptance ${TAG} Category ${RUN}`;
    await cdlg.locator('input[name="name"]').first().fill(name);
    await cdlg.getByRole("combobox", { name: L.defaultUnit }).click();
    const firstUnit = page.getByRole("option").first();
    await firstUnit.waitFor({ timeout: 10000 });
    const unitName = (await firstUnit.innerText()).trim().split("\n")[0];
    await firstUnit.click();
    await shot(page, "00b-category-create");
    const [resp] = await Promise.all([
      page.waitForResponse(isPost(/\/product-categories$/), { timeout: 30000 }),
      cdlg.getByRole("button", { name: L.save }).last().click(),
    ]);
    const body = await resp.json().catch(() => ({}));
    const toastOk = await toastWith(page, L.saved)
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check(
      "category with a default unit created through Master data → Categories",
      resp.ok() && toastOk && !!body.defaultUnitId,
      `${resp.status()} unit=${unitName}`,
    );
    CATEGORY = { id: body.id, name, unitName };
  });
  if (!CATEGORY) throw new Error("no category for the journey");

  // (1) products through the form
  await step(page, "1", "desktop/ar", async () => {
    await createProduct(page, {
      key: "compX",
      name: NAMES.compX,
      kind: "PURCHASED",
      shotName: "01a-product-component-x",
    });
    await createProduct(page, {
      key: "compY",
      name: NAMES.compY,
      kind: "PURCHASED",
      shotName: "01b-product-component-y",
    });
    await createProduct(page, {
      key: "service",
      name: NAMES.service,
      kind: "SERVICE",
      shotName: "01c-product-service",
    });
    await createProduct(page, {
      key: "kit",
      name: NAMES.kit,
      kind: "KIT",
      shotName: "01d-product-kit",
    });
    await createProduct(page, {
      key: "assembled",
      name: NAMES.assembled,
      kind: "ASSEMBLED",
      shotName: "01e-product-assembled",
    });
    for (const k of ["compX", "compY", "service", "kit", "assembled"]) {
      if (!ids[k]) continue;
      const p = await get(`/products/${k ? ids[k] : ""}`);
      check(
        `${k}: stored attributes`,
        p.status === "ACTIVE" &&
          p.categoryId === CATEGORY.id &&
          ({
            compX: p.itemType === "PRODUCT" && p.supplyMethod === "PURCHASED" && p.isInventoryItem,
            compY: p.itemType === "PRODUCT" && p.supplyMethod === "PURCHASED" && p.isInventoryItem,
            service: p.itemType === "SERVICE" && !p.isInventoryItem,
            kit: p.supplyMethod === "KIT" && !p.isInventoryItem,
            assembled: p.supplyMethod === "ASSEMBLED" && p.isInventoryItem,
          }[k] ??
            false),
        `${p.sku} ${p.itemType}/${p.supplyMethod} tracked=${p.isInventoryItem} ${p.status}`,
      );
    }
  });

  // (2) similar-name warning, save still allowed
  await step(page, "2", "desktop/ar", async () => {
    await createProduct(page, {
      key: "similar",
      name: NAMES.similar,
      kind: "PURCHASED",
      shotName: "02-product-similar-name-warning",
      afterName: async (dlg) => {
        const shown = await dlg
          .getByText(L.similar)
          .first()
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        const txt = await dlg.innerText();
        check(
          "similar-name warning visible and names the existing product",
          shown && txt.includes(NAMES.compX),
          shown ? "shown" : "absent",
        );
        const save = dlg.getByRole("button", { name: L.save }).last();
        check("save stays enabled (non-blocking)", await save.isEnabled(), "");
      },
    });
  });

  // (3) recipes
  await step(page, "3", "desktop/ar", async () => {
    await createRecipe(
      page,
      "assembled",
      [
        { key: "compX", qty: 2 },
        { key: "compY", qty: 1 },
      ],
      "03a-recipe-assembled",
    );
    await createRecipe(page, "kit", [{ key: "compY", qty: 1 }], "03b-recipe-kit");
  });

  // (4) stock for the components through the Inventory UI
  await step(page, "4", "desktop/ar", async () => {
    await openingInventory(page, "compX", 10, 10, "04a-opening-inventory-x");
    await openingInventory(page, "compY", 5, 15, "04b-opening-inventory-y");
    await go(page, "/inventory/stock");
    const search = page.getByRole("searchbox").first();
    await search.fill(RUN);
    await settle(page, 1500);
    const x = await get(`/products/${ids.compX}`);
    const y = await get(`/products/${ids.compY}`);
    const rowX = latin(
      await page
        .getByRole("row")
        .filter({ hasText: x.sku })
        .first()
        .innerText()
        .catch(() => ""),
    );
    const rowY = latin(
      await page
        .getByRole("row")
        .filter({ hasText: y.sku })
        .first()
        .innerText()
        .catch(() => ""),
    );
    check(
      "stock page shows X = 10 and Y = 5",
      /\b10\b/.test(rowX) && /\b5\b/.test(rowY),
      `X[${rowX.replace(/\s+/g, " ").slice(0, 120)}] Y[${rowY.replace(/\s+/g, " ").slice(0, 120)}]`,
    );
    check(
      "API stock cards agree (read-only)",
      (await onHand("compX")) === 10 && (await onHand("compY")) === 5,
      `${await onHand("compX")}/${await onHand("compY")}`,
    );
    await shot(page, "04c-stock-page");
  });

  // (5) assembly: new → detail → reverse → assemble again
  await step(page, "5", "desktop/ar", async () => {
    const first = await runAssembly(page, { from: "list", shotName: "05a-assembly-1" });
    // open the detail from the toast's own action
    const openBtn = first.toast.getByRole("button", { name: L.openAssembly });
    if (await openBtn.isVisible().catch(() => false)) await openBtn.click();
    else await go(page, `/inventory/assembly/${first.id}`);
    await page.waitForURL(/\/inventory\/assembly\/[\w-]+$/, { timeout: 15000 });
    await settle(page, 1200);
    const main = await page.locator("main").innerText();
    check(
      "detail page shows the number and POSTED",
      main.includes(first.number) && L.posted.test(main),
      first.number,
    );
    await shot(page, "05b-assembly-detail-posted");
    await headerAction(page, L.reverse);
    const confirm = page.getByRole("alertdialog").last();
    await confirm.waitFor({ timeout: 10000 });
    await confirm.locator("textarea").fill(`${TAG} reversal check ${RUN}`);
    await shot(page, "05c-assembly-reverse-dialog");
    await confirm.getByRole("button", { name: L.reverse }).click();
    const revToast = await toastWith(page, L.reversed)
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    await settle(page, 1500);
    const after = await page.locator("main").innerText();
    const api = await get(`/assembly/${first.id}`);
    check(
      "reversed: toast, badge REVERSED, API status REVERSED with the reason",
      revToast &&
        L.reversedBadge.test(after) &&
        api.status === "REVERSED" &&
        /reversal check/.test(api.reversalReason ?? ""),
      `api=${api.status}`,
    );
    await shot(page, "05d-assembly-detail-reversed");
    const second = await runAssembly(page, { from: "product", shotName: "05e-assembly-2" });
    const api2 = await get(`/assembly/${second.id}`);
    check("second assembly stays POSTED", api2.status === "POSTED", second.number);
    ids.assembly1 = first.id;
    ids.assembly2 = second.id;
    check(
      "component stock after assemble/reverse/assemble: X = 8, Y = 4",
      (await onHand("compX")) === 8 && (await onHand("compY")) === 4,
      `${await onHand("compX")}/${await onHand("compY")}`,
    );
  });

  // (6) tracking lock
  await step(
    page,
    "6",
    "desktop/ar",
    async () => {
      await go(page, `/products/${ids.compX}`);
      await headerAction(page, L.edit);
      const dlg = dialog(page);
      await dlg.waitFor({ timeout: 10000 });
      await settle(page, 600);
      const sw = dlg.locator("#product-track-stock");
      await sw.click();
      const off = (await sw.getAttribute("aria-checked")) === "false";
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.request().method() === "PATCH" &&
            /\/products\/[\w-]+$/.test(new URL(r.url()).pathname),
          { timeout: 30000 },
        ),
        dlg.getByRole("button", { name: L.save }).last().click(),
      ]);
      await page.waitForTimeout(1200);
      const txt = await dlg.innerText().catch(() => "");
      check(
        "save refused with the Arabic PRODUCT_TRACKING_LOCKED message in the form",
        off && !resp.ok() && L.trackingLocked.test(txt),
        `switchOff=${off} http=${resp.status()} msg=${L.trackingLocked.test(txt)}`,
      );
      await shot(page, "06-tracking-locked");
      const p = await get(`/products/${ids.compX}`);
      check("product is still stock-tracked (read-only GET)", p.isInventoryItem === true, "");
    },
    { allow: /\b(409|422|400)\b|Conflict|Unprocessable/i },
  );

  // (7) kit availability
  await step(page, "7", "desktop/ar", async () => {
    await go(page, `/products/${ids.kit}`);
    await page.getByRole("tab", { name: L.recipeTab }).first().click();
    await settle(page, 1500);
    const txt = latin(await page.getByRole("tabpanel").first().innerText());
    const m = txt.match(L.kitAvailability);
    const api = await get(`/products/${ids.kit}/kit-availability`);
    check(
      "kit availability shown and equals the API (min of component availability)",
      m && Number(m[1].replace(/,/g, "")) === api.available && api.available === 4,
      `ui=${m?.[1]} api=${api.available}`,
    );
    await shot(page, "07-kit-availability");
  });

  // (8) integrity
  await step(page, "8", "desktop/ar", async () => {
    await go(page, "/inventory/integrity");
    await page
      .waitForFunction(() => /I7/.test(document.querySelector("main")?.innerText ?? ""), null, {
        timeout: 180000,
      })
      .catch(() => {});
    await settle(page, 800);
    const txt = await page.locator("main").innerText();
    const all = ["I1", "I2", "I3", "I4", "I5", "I6", "I7"].every((k) => txt.includes(k));
    const statuses = [];
    for (const k of ["I1", "I2", "I3", "I4", "I5", "I6", "I7"]) {
      const card = await page.locator(`[data-testid="integrity-${k}"]`).innerText();
      const head = card.split("\n").slice(0, 3).join(" ");
      statuses.push(
        `${k}:${L.integrityFail.test(head) ? "FAIL" : /للمراجعة/.test(head) ? "WARN" : "PASS"}`,
      );
    }
    const failCount = latin(txt).match(/غير سليمة\s*(\d+)/)?.[1];
    check(
      "integrity report rendered (I1–I7) with no FAIL card",
      all && failCount === "0" && !statuses.some((s) => s.endsWith("FAIL")),
      `${statuses.join(" ")} failCard=${failCount}`,
    );
    await shot(page, "08-integrity");
  });

  // (1m / 5m) mobile 390×844
  const mob = await newContext(browser, true);
  const mpage = await login(mob, ADMIN);
  await step(mpage, "1", "mobile/ar", async () => {
    await createProduct(mpage, {
      key: "mobile",
      name: NAMES.mobile,
      kind: "PURCHASED",
      shotName: "01m-product-mobile",
      afterName: async () => noHorizontalScroll(mpage, "product form dialog"),
    });
    await noHorizontalScroll(mpage, "product list after create");
  });
  await step(mpage, "5", "mobile/ar", async () => {
    const r = await runAssembly(mpage, {
      from: "list",
      shotName: "05m-assembly-mobile",
      mobile: true,
    });
    await go(mpage, `/inventory/assembly/${r.id}`);
    await noHorizontalScroll(mpage, "assembly detail");
    await shot(mpage, "05m-assembly-mobile-detail");
    check(
      "component stock after the mobile assembly: X = 6, Y = 3",
      (await onHand("compX")) === 6 && (await onHand("compY")) === 3,
      `${await onHand("compX")}/${await onHand("compY")}`,
    );
  });
  await mob.close();

  // (9) agent portal
  const agentCtx = await newContext(browser, false);
  const apage = await login(agentCtx, AGENT);
  for (const [path, name] of [
    ["/agent/stock", "09a-agent-stock"],
    ["/agent/orders", "09b-agent-orders"],
  ]) {
    await step(apage, "9", `agent ${path}`, async () => {
      await go(apage, path);
      await settle(apage, 1200);
      const status = await apage.evaluate(() => location.pathname);
      const heads = (await apage.getByRole("columnheader").allInnerTexts()).join(" | ");
      const main = await apage.locator("main").innerText();
      check(
        `${path} renders`,
        status === path && main.trim().length > 20 && !/404|غير موجود/.test(main.slice(0, 200)),
        status,
      );
      check(`${path}: no cost columns`, !/تكلفة|التكلفة|Cost/i.test(heads), heads.slice(0, 200));
      await shot(apage, name);
    });
  }
  await agentCtx.close();

  // (10) English once
  await step(page, "10", "desktop/en", async () => {
    await go(page, "/products");
    await page.getByRole("button", { name: L.changeLanguage }).first().click();
    await page
      .getByRole("menuitem", { name: /English/ })
      .first()
      .click();
    await settle(page, 1200);
    const d1 = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    const addEn = await page.getByRole("button", { name: /^Add Product$/ }).count();
    check("product list in English: dir=ltr", d1 === "ltr" && addEn > 0, `dir=${d1}`);
    await shot(page, "10a-en-products");
    await go(page, "/inventory/assembly");
    const d2 = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    const main = await page.locator("main").innerText();
    check(
      "assembly list in English: dir=ltr, English title",
      d2 === "ltr" && /Assembl/i.test(main),
      `dir=${d2}`,
    );
    await shot(page, "10b-en-assembly-list");
  });

  await desk.close();
  await browser.close();
}

function writeReport(fatal) {
  const failed = results.filter((r) => !r.ok);
  const steps = [...new Set(results.map((r) => r.step))];
  const perStep = steps.map((s) => ({
    step: s,
    total: results.filter((r) => r.step === s).length,
    failed: results.filter((r) => r.step === s && !r.ok).length,
  }));
  const meta = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    run: RUN,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    fatal: fatal ?? null,
    screenshots: shots.length,
  };
  writeFileSync(
    `${OUT}/r13-browser-ui.json`,
    JSON.stringify({ ...meta, names: NAMES, ids, perStep, results, shots }, null, 2),
  );
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  writeFileSync(
    `${OUT}/r13-browser-ui.md`,
    [
      "# R13 UI-driven browser journeys",
      "",
      `Generated ${meta.generatedAt} against ${BASE} (run ${RUN}). **${meta.passed}/${meta.total} PASS**, ${meta.failed} FAIL, ${shots.length} screenshots.${fatal ? ` Fatal: ${fatal}` : ""}`,
      "",
      "All business records were created and acted on through the UI; the API was used only for read-only assertions.",
      "",
      "| Step | Checks | Result |",
      "| --- | --- | --- |",
      ...perStep.map(
        (p) => `| ${p.step} | ${p.total} | ${p.failed ? `**FAIL (${p.failed})**` : "PASS"} |`,
      ),
      "",
      "| Step | Scope | Check | Detail | Result |",
      "| --- | --- | --- | --- | --- |",
      ...results.map(
        (r) =>
          `| ${r.step} | ${r.scope} | ${esc(r.name)} | ${esc(r.detail)} | ${r.ok ? "PASS" : "**FAIL**"} |`,
      ),
      "",
      "Screenshots:",
      "",
      ...shots.map((s) => `- [${s}](./${s})`),
      "",
    ].join("\n"),
  );
  console.log(`\n${meta.passed}/${meta.total} passed (${meta.failed} failed) — ${OUT}`);
  return failed.length === 0 && !fatal;
}

main()
  .then(() => process.exit(writeReport() ? 0 : 1))
  .catch((e) => {
    console.error("ERROR:", e.message);
    writeReport(e.message.split("\n")[0]);
    process.exit(2);
  });
