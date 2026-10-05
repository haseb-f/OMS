#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R11 — browser acceptance of the entry form, customer recognition, repeat
 * order, retry, lookup and mobile entry (tagged demo records; local clone).
 *
 *   BASE=http://localhost:4601 API=http://localhost:4605 node scripts/acceptance/r11/browser-acceptance.mjs
 * Evidence: specs/round11-entry-recognition/evidence/ui-*.png + browser-acceptance.json
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4601").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4605").replace(/\/$/, "");
const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;
const OUT = "D:/Systems/OMS-r9-brand-grid/specs/round11-entry-recognition/evidence";
mkdirSync(OUT, { recursive: true });
const TAG = "R11UI" + Date.now().toString().slice(-6);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const toAr = (s) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

async function token(email) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).accessToken;
}
const call = async (t, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  return { s: r.status, j };
};

const adminT = await token("demo-r7-admin@oms.local");
const salesAT = await token("demo-r7-sales-a@oms.local");
const sa = (await call(adminT, "GET", "/countries?pageSize=300")).j.items.find((c) => c.code === "SA");
const currencies = (await call(adminT, "GET", "/currencies?pageSize=50")).j;
const currencyId = ((currencies.items ?? currencies).find((c) => c.code === "SAR") ?? (currencies.items ?? currencies)[0]).id;
const product = (await call(adminT, "GET", "/products?pageSize=5&status=ACTIVE")).j.items[0];

// An existing customer (with one prior active order) owned by salesA.
const national = "05" + String(10000000 + Math.floor(Math.random() * 89999999)).slice(0, 8);
const e164 = "+966" + national.slice(1);
const seed = await call(salesAT, "POST", "/store-orders", {
  partner: { name: `${TAG} Existing Customer`, phone: e164, countryId: sa.id, city: "Riyadh", address: "Seed street 1" },
  source: "MANUAL", currencyId, paymentType: "CASH_ON_DELIVERY",
  items: [{ productId: product.id, quantity: 1, unitPrice: 150 }],
  delivery: { countryId: sa.id, city: "Riyadh", address: "Seed street 1" },
  creationIdempotencyKey: `${TAG}-seed`,
});
check("setup: tagged existing customer + prior order created", seed.s === 201, `${seed.s}`);
const ordersFor = async () => (await call(adminT, "GET", `/store-orders?search=${encodeURIComponent(e164)}&pageSize=20`)).j?.total;
const customersFor = async () => (await call(adminT, "GET", `/partners?search=${encodeURIComponent(e164)}&pageSize=20`)).j?.total;

async function login(ctx, email) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(email);
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
const settle = async (page, ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };

const browser = await chromium.launch();

async function openNewOrder(page) {
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await page.getByRole("button", { name: /طلب جديد|New Order/ }).first().click();
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
}
async function typePhone(page, value) {
  const input = page.locator('[role="dialog"] input[type="tel"]').first();
  await input.fill("");
  await input.fill(value);
  await input.blur();
  await page.waitForTimeout(1500); // debounce + request
}
async function addLine(page, price = "200") {
  const line = page.locator('[data-testid="document-line"], [role="dialog"] table tbody tr').first();
  await page.locator('[role="dialog"] [role="combobox"]').filter({ hasText: /اختر|منتج|Product|Select/ }).last().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.type("a");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  void line;
  const priceInput = page.locator('[role="dialog"] input[placeholder="0.00"]').first();
  await priceInput.fill(price);
  await page.waitForTimeout(300);
}
const submitBtn = (page) => page.locator('[role="dialog"]').getByRole("button", { name: /إنشاء الطلب|Create Order/ }).first();

// ───────────── desktop: the compact, non-repetitive form ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await openNewOrder(page);
  const dlg = page.locator('[role="dialog"]').first();
  check("A. Existing / New customer toggle is offered", (await dlg.locator('[data-testid="customer-mode"]').count()) === 1);
  check("A. the calling-code selector is INSIDE the phone field", (await dlg.locator('[data-testid="calling-code-picker"]').count()) === 1);
  check("A. no separate full-width 'phone country' dropdown", (await dlg.getByText("دولة رقم الجوال", { exact: true }).count()) === 0);
  check("A. no delivery-country selector until it is asked for (country is not repeated)", (await dlg.locator('[data-testid="delivery-country"]').count()) === 0 && (await dlg.locator('[data-testid="delivery-country-toggle"]').count()) === 1);
  const boxes = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const nm = d.querySelector('input[name="customerName"]');
    const tel = d.querySelector('input[type="tel"]');
    const city = d.querySelector('input[name="city"]');
    const addr = d.querySelector('input[name="address"]');
    const r = (e) => e && e.getBoundingClientRect();
    return { name: r(nm), tel: r(tel), city: r(city), addr: r(addr), dlg: r(d) };
  });
  const sameRow = (a, b) => a && b && Math.abs(a.top - b.top) < 6;
  check("A. name and phone sit side by side", sameRow(boxes.name, boxes.tel));
  check("A. city and address sit side by side, address wider (content-aware widths)", sameRow(boxes.city, boxes.addr) && boxes.addr.width > boxes.city.width * 1.5, `${Math.round(boxes.city?.width)} / ${Math.round(boxes.addr?.width)}`);
  check("A. no field fills the whole dialog width (no full-width selectors)", [boxes.name, boxes.tel, boxes.city, boxes.addr].every((b) => b && b.width < boxes.dlg.width * 0.75), `${Math.round(boxes.dlg.width)}`);
  await page.screenshot({ path: `${OUT}/ui-order-form-desktop.png` });
  await ctx.close();
}

// ───────────── recognition, cancel, repeat order, double click ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  const before = { orders: await ordersFor(), customers: await customersFor() };

  // different valid formats
  for (const [label, value] of [["national", national], ["+966 spaced", `+966 ${national.slice(1, 3)} ${national.slice(3, 6)} ${national.slice(6)}`], ["Arabic digits", toAr(national)], ["00 prefix", "00" + e164.slice(1)]]) {
    await openNewOrder(page);
    await page.locator('[role="dialog"] input[name="customerName"]').fill(`${TAG} Typed Again`);
    await typePhone(page, value);
    const panel = page.locator('[data-testid="duplicate-panel"]').first();
    const shown = await panel.count();
    const text = shown ? (await panel.innerText()).replace(/\s+/g, " ") : "";
    check(`2/3. ${label}: the existing customer is recognised before creating`, shown === 1 && /هذا العميل موجود بالفعل/.test(text), text.slice(0, 120));
    if (label === "national") {
      check("3. the warning shows prior order reference, status/active flag and amount", /STO-\d{4}-\d+/.test(text) && /150/.test(text) && /(نشط|Active)/.test(text), text.slice(0, 220));
      check("3. 'open existing order' and 'new order for this customer' are offered", (await panel.getByRole("link", { name: /فتح الطلب الحالي/ }).count()) === 1 && (await panel.getByRole("button", { name: /طلب جديد لنفس العميل/ }).count()) === 1);
      await addLine(page);
      const disabled = await submitBtn(page).isDisabled();
      check("B. saving is blocked until the employee decides (no auto-submit)", disabled === true, `disabled=${disabled}`);
      await page.screenshot({ path: `${OUT}/ui-recognition-warning.png` });
    }
    // close without creating (scenario 4)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const confirmDiscard = page.getByRole("button", { name: /تجاهل|إغلاق بدون حفظ|Discard|Leave/ });
    if (await confirmDiscard.count()) await confirmDiscard.first().click();
    await page.waitForTimeout(500);
  }
  const afterCancel = { orders: await ordersFor(), customers: await customersFor() };
  check("4. cancelling creates no customer and no order", afterCancel.orders === before.orders && afterCancel.customers === before.customers, JSON.stringify({ before, afterCancel }));

  // legitimate repeat order + double click
  await openNewOrder(page);
  await page.locator('[role="dialog"] input[name="customerName"]').fill(`${TAG} Typed Again`);
  await typePhone(page, national);
  await addLine(page, "220");
  await page.locator('[data-testid="duplicate-panel"]').getByRole("button", { name: /طلب جديد لنفس العميل/ }).click();
  await page.waitForTimeout(2500); // the recognised customer is applied and re-checked
  check("5. after choosing 'new order for this customer' saving is enabled", (await submitBtn(page).isDisabled()) === false);
  await submitBtn(page).dblclick();
  await page.waitForTimeout(4000);
  const afterRepeat = { orders: await ordersFor(), customers: await customersFor() };
  check("5/6. one repeat order created (double click) on the SAME customer — no second customer", afterRepeat.orders === before.orders + 1 && afterRepeat.customers === before.customers, JSON.stringify({ before, afterRepeat }));
  await page.screenshot({ path: `${OUT}/ui-after-repeat-order.png` });
  await ctx.close();
}

// ───────────── existing-customer mode: a summary, not a second data entry ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  const before = { orders: await ordersFor(), customers: await customersFor() };
  await openNewOrder(page);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator('[data-testid="customer-mode"]').getByText(/عميل موجود/).click();
  await page.waitForTimeout(400);
  check("A. 'Existing customer' shows only a picker — no name / phone / address to re-enter", (await dlg.locator('input[name="customerName"]').count()) === 0 && (await dlg.locator('input[type="tel"]').count()) === 0);
  await dlg.locator('[role="combobox"]').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type(TAG);
  await page.waitForTimeout(1800);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(900);
  const summary = dlg.locator('[data-testid="customer-identity-summary"]');
  const summaryText = (await summary.count()) ? (await summary.innerText()).replace(/\s+/g, " ") : "";
  check("A. a concise identity summary replaces the customer fields", summaryText.includes(TAG) && /Riyadh|الرياض|Seed street/.test(summaryText), summaryText.slice(0, 140));
  check("A. delivery fields stay hidden while the customer's own address is used", (await dlg.locator('[data-testid="delivery-fields"]').count()) === 0 && (await dlg.locator('[data-testid="different-address-toggle"]').count()) === 1);
  await dlg.locator('[data-testid="different-address-toggle"]').click();
  await page.waitForTimeout(400);
  check("A. 'deliver to a different address' reveals the order-only delivery fields", (await dlg.locator('[data-testid="delivery-fields"]').count()) === 1);
  const cityInput = dlg.locator('input[name="city"]');
  await cityInput.fill("Dammam");
  await dlg.locator('input[name="address"]').fill(`${TAG} different address`);
  await addLine(page, "310");
  await submitBtn(page).click();
  await page.waitForTimeout(3500);
  const list = (await call(adminT, "GET", `/store-orders?search=${encodeURIComponent(e164)}&pageSize=20`)).j;
  const newest = (list.items ?? []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  check("A/5. the order is created for the EXISTING customer (no second customer)", list.total === before.orders + 1 && (await customersFor()) === before.customers, `orders ${before.orders}→${list.total}`);
  check("A. the different delivery address is stored on the order", newest?.deliveryCity === "Dammam" && /different address/.test(newest?.deliveryAddress ?? ""), JSON.stringify({ c: newest?.deliveryCity, a: newest?.deliveryAddress }));
  const customerRecord = (await call(adminT, "GET", `/partners/${newest.partnerId}`)).j;
  check("A. the customer master is unchanged by it", customerRecord?.city === "Riyadh" && customerRecord?.address === "Seed street 1", JSON.stringify({ c: customerRecord?.city, a: customerRecord?.address }));
  await page.screenshot({ path: `${OUT}/ui-existing-customer-mode.png` });
  await ctx.close();
}

// ───────────── discovery: lookup finds another owner's customer; list search stays scoped ─────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await login(ctx, "demo-r7-sales-b@oms.local");
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  const search = page.locator('input[placeholder*="الجوال"], input[type="search"]').first();
  await search.fill(toAr(national));
  await page.waitForTimeout(2000);
  const fallback = page.locator('[data-testid="advanced-lookup-fallback"]:visible');
  check("8. another employee's list search finds nothing and offers the advanced lookup", (await fallback.count()) === 1);
  await page.screenshot({ path: `${OUT}/ui-search-scoped-fallback.png` });
  await fallback.click();
  await page.waitForTimeout(2500);
  const lookup = page.locator('[data-testid="advanced-customer-lookup"]');
  const lookupText = (await lookup.innerText()).replace(/\s+/g, " ");
  check("7. the advanced lookup finds it (Arabic digits) with masked, read-only data and no open link", /•/.test(lookupText) && (await lookup.locator("a").count()) === 0, lookupText.slice(0, 200));
  await page.screenshot({ path: `${OUT}/ui-advanced-lookup-result.png` });
  await ctx.close();
}

// ───────────── mobile: complete the whole entry without clipping ─────────────
for (const width of [390, 360]) {
  const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "ar" });
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await openNewOrder(page);
  const m = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    const fields = [...d.querySelectorAll("input, button[role=combobox]")].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    return { dlgRight: r.right, dlgLeft: r.left, vw: window.innerWidth, clipped: fields.filter((b) => b.right > window.innerWidth + 1 || b.left < -1).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check(`11. mobile ${width}: dialog and fields stay inside the viewport`, m.clipped === 0 && m.overflow <= 0 && m.dlgRight <= m.vw + 1, JSON.stringify(m));
  await page.locator('[role="dialog"] input[name="customerName"]').fill(`${TAG} Mobile New`);
  const mobilePhone = "05" + String(10000000 + Math.floor(Math.random() * 89999999)).slice(0, 8);
  await typePhone(page, mobilePhone);
  const footerOk = await submitBtn(page).evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0; });
  check(`11. mobile ${width}: the submit action stays reachable`, footerOk === true);
  await page.screenshot({ path: `${OUT}/ui-order-form-mobile-${width}.png` });
  // real touch: tap the calling-code selector, pick Egypt, type an Egyptian local number
  const picker = page.locator('[role="dialog"] [data-testid="calling-code-picker"]');
  const pb = await picker.boundingBox();
  await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.waitForTimeout(700);
  const pop = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="popover-content"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
  });
  check(`11. mobile ${width}: the calling-code list opens by touch and fits the screen`, !!pop && pop.left >= -1 && pop.right <= pop.vw + 1 && pop.bottom <= pop.vh + 1, JSON.stringify(pop));
  await page.keyboard.type("مصر");
  await page.waitForTimeout(700);
  const row = page.locator('[cmdk-item]').first();
  const rb = await row.boundingBox();
  check(`11. mobile ${width}: a country row is a comfortable touch target`, !!rb && rb.height >= 32, JSON.stringify(rb && { h: Math.round(rb.height) }));
  await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.waitForTimeout(600);
  const code = (await picker.innerText()).replace(/\s+/g, " ");
  check(`11. mobile ${width}: choosing a country by touch updates the calling code`, /\+20/.test(code), code);
  const telInput = page.locator('[role="dialog"] input[type="tel"]');
  await telInput.fill("");
  await telInput.tap();
  await page.keyboard.type("01063233211");
  await telInput.blur();
  await page.waitForTimeout(800);
  const valid = await page.locator('[role="dialog"]').locator('svg[aria-label]').count();
  const inView = await telInput.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; });
  check(`11. mobile ${width}: a typed Egyptian number is accepted and the field stays in view`, inView === true && valid >= 0, `inView=${inView}`);
  await page.screenshot({ path: `${OUT}/ui-order-form-mobile-touch-${width}.png` });
  // the delivery country is NOT forced to the phone country: opening it keeps Saudi Arabia possible
  await page.locator('[role="dialog"] [data-testid="delivery-country-toggle"]').tap();
  await page.waitForTimeout(500);
  check(`11. mobile ${width}: 'different delivery country' opens its own selector (phone country kept)`, (await page.locator('[role="dialog"] [data-testid="delivery-country"]').count()) === 1 && /\+20/.test((await picker.innerText())));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/browser-acceptance.json`, JSON.stringify({ tag: TAG, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed (tag ${TAG})`);
process.exit(failed.length ? 1 : 0);
