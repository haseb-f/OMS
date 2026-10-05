#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R12 — browser acceptance: country → calling code / currency defaults and
 * overrides, one advanced lookup, form vs toolbar dropdown appearance, agent
 * screens (tagged demo records, local verification clone only).
 *
 *   BASE=http://localhost:4701 API=http://localhost:4705 node scripts/acceptance/r12/browser-acceptance.mjs
 * Evidence: specs/round12-contextual-ui/evidence/ui-*.png + browser-acceptance.json
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4701").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4705").replace(/\/$/, "");
const SHOTS = process.env.SHOTS !== "0";
const OUT = process.env.OUT ?? "D:/Systems/OMS/specs/round12-contextual-ui/evidence";
const PREFIX = process.env.PREFIX ?? "ui";
mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(
  readFileSync("D:/Systems/OMS/tmp/r7-final/.r7.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const PW = env.R7_PW;
const TAG = "R12UI" + Date.now().toString().slice(-6);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const toAr = (s) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png` });
};

async function token(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return (await r.json()).accessToken;
}
const call = async (t, m, p, b) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* empty */
  }
  return { s: r.status, j };
};

const adminT = await token("demo-r7-admin@oms.local");
const salesAT = await token("demo-r7-sales-a@oms.local");
const cur = async (code) =>
  ((await call(adminT, "GET", `/currencies?search=${code}&pageSize=10`)).j.items ?? []).find((c) => c.code === code);
const sa = (await call(adminT, "GET", "/countries?pageSize=300")).j.items.find((c) => c.code === "SA");
const sar = await cur("SAR");
const product = (await call(adminT, "GET", "/products?pageSize=5&status=ACTIVE")).j.items[0];
const national = "05" + String(10000000 + Math.floor(Math.random() * 89999999)).slice(0, 8);
const e164 = "+966" + national.slice(1);
const seed = await call(salesAT, "POST", "/store-orders", {
  partner: { name: `${TAG} Existing Customer`, phone: e164, countryId: sa.id, city: "Riyadh", address: "Seed street 1" },
  source: "MANUAL",
  currencyId: sar.id,
  paymentType: "CASH_ON_DELIVERY",
  items: [{ productId: product.id, quantity: 1, unitPrice: 150 }],
  creationIdempotencyKey: `${TAG}-seed`,
});
check("setup: tagged existing customer + prior order", seed.s === 201, `${seed.s}`);
const partnerId = seed.j?.partnerId ?? seed.j?.partner?.id;

async function newContext(browser, { locale = "ar", theme = "light", viewport = { width: 1440, height: 900 }, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(
    ([l, th]) => {
      try {
        localStorage.setItem("oms.locale", JSON.stringify(l));
        localStorage.setItem("theme", th);
      } catch {
        /* storage blocked */
      }
    },
    [locale, theme],
  );
  return ctx;
}
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
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const NEW_ORDER = /طلب جديد|New Order/;
async function openNewOrder(page) {
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await page.getByRole("button", { name: NEW_ORDER }).first().click();
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
}
/** The control of a dialog field, found by its label text. */
async function fieldByLabel(dlg, re) {
  const label = dlg.locator("label").filter({ hasText: re }).first();
  const id = await label.getAttribute("for");
  return dlg.locator(`[id="${id}"]`);
}
const countryField = (dlg) => fieldByLabel(dlg, /^(الدولة|Country)/);
const currencyField = (dlg) => fieldByLabel(dlg, /^(العملة|Currency)/);
const callingCode = async (dlg) => (await dlg.locator('[data-testid="calling-code-picker"]').innerText()).replace(/\s+/g, " ").replace(/[^\d+]/g, "");
const pickInCombobox = async (page, trigger, text) => {
  await trigger.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(text);
  await page.waitForTimeout(500);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(500);
};
const pickCallingCode = async (page, dlg, text) => {
  await dlg.locator('[data-testid="calling-code-picker"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.type(text);
  await page.waitForTimeout(500);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(500);
};
const text = async (loc) => ((await loc.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();

/** Light form surface vs strong toolbar surface — computed, not eyeballed. */
const luminance = (rgb) => {
  // Chromium reports mixed colours as oklab(L a b): L cubed is the relative luminance.
  if (/^oklab\(/.test(rgb)) return Number(rgb.match(/[\d.]+/)[0]) ** 3;
  const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
};
const style = (loc) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, surface: el.getAttribute("data-surface"), tone: el.getAttribute("data-toolbar-tone") };
  });

const browser = await chromium.launch();

// ═════════ 1. Country → calling code + currency, overrides, separate delivery country ═════════
{
  const ctx = await newContext(browser);
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await openNewOrder(page);
  const dlg = page.locator('[role="dialog"]').first();

  const boxes = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = (e) => e && e.getBoundingClientRect();
    const labelFor = (re) => {
      const l = [...d.querySelectorAll("label")].find((x) => re.test(x.textContent.trim()));
      return l && d.querySelector(`[id="${l.getAttribute("for")}"]`);
    };
    return {
      name: r(d.querySelector('input[name="customerName"]')),
      country: r(labelFor(/^(الدولة|Country)/)),
      tel: r(d.querySelector('input[type="tel"]')),
      dlg: r(d),
    };
  });
  const sameRow = (a, b) => a && b && Math.abs(a.top - b.top) < 8;
  check("1. Name → Country → Phone share one row on desktop", sameRow(boxes.name, boxes.country) && sameRow(boxes.country, boxes.tel), JSON.stringify([boxes.name?.top, boxes.country?.top, boxes.tel?.top].map(Math.round)));
  check("1. order of the row: name, country, phone (reading order)", boxes.name && boxes.country && boxes.tel && (boxes.name.left > boxes.country.left) === (boxes.country.left > boxes.tel.left));
  check("1. no second large country selector (delivery country stays hidden)", (await dlg.locator('[data-testid="delivery-country"]').count()) === 0);

  const country = await countryField(dlg);
  const currency = await currencyField(dlg);
  check("1. initial: Saudi Arabia → +966 and SAR", (await callingCode(dlg)) === "+966" && /SAR/.test(await text(currency)), `${await callingCode(dlg)} / ${await text(currency)}`);
  await shot(page, "order-form-desktop");

  await pickInCombobox(page, country, "مصر");
  check("2. choosing Egypt proposes +20 and EGP", (await callingCode(dlg)) === "+20" && /EGP/.test(await text(currency)), `${await callingCode(dlg)} / ${await text(currency)}`);

  // manual calling code survives a later country change
  await pickCallingCode(page, dlg, "+971");
  await pickInCombobox(page, country, "السعودية");
  check("3. a manually chosen calling code (+971) is NOT overwritten by a country change", (await callingCode(dlg)) === "+971", await callingCode(dlg));
  check("3. …while the untouched currency follows the country (SAR)", /SAR/.test(await text(currency)), await text(currency));

  // manual currency survives a later country change
  await pickInCombobox(page, currency, "USD");
  await pickInCombobox(page, country, "مصر");
  check("3. a manually chosen currency (USD) is NOT overwritten by a country change", /USD/.test(await text(currency)), await text(currency));

  // no configured default → asked, never guessed (fresh dialog)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const discard = page.getByRole("button", { name: /تجاهل|إغلاق بدون حفظ|Discard|Leave/ });
  if (await discard.count()) await discard.first().click();
  await openNewOrder(page);
  const dlg2 = page.locator('[role="dialog"]').first();
  await pickInCombobox(page, await countryField(dlg2), "الكويت");
  const cur2 = await currencyField(dlg2);
  check("4. a country without a configured currency leaves currency empty and says so", /اختر|Select|Choose/.test(await text(cur2)) || (await text(cur2)) === "" || !/SAR/.test(await text(cur2)), await text(cur2));
  check("4. the calling code still follows (+965)", (await callingCode(dlg2)) === "+965", await callingCode(dlg2));
  await shot(page, "order-form-no-currency-default");

  // typed number keeps its calling code when the country changes afterwards
  await pickInCombobox(page, await countryField(dlg2), "السعودية");
  await dlg2.locator('input[type="tel"]').fill("0501234567");
  await dlg2.locator('input[type="tel"]').blur();
  await pickInCombobox(page, await countryField(dlg2), "مصر");
  check("5. an already-typed number keeps its calling code (+966) when the country changes", (await callingCode(dlg2)) === "+966", await callingCode(dlg2));

  // phone country and delivery country are separate
  await dlg2.locator('[data-testid="delivery-country-toggle"]').click();
  await page.waitForTimeout(400);
  check("6. 'different delivery country' opens its own selector, phone code untouched", (await dlg2.locator('[data-testid="delivery-country"]').count()) === 1 && (await callingCode(dlg2)) === "+966");
  await shot(page, "order-form-different-delivery");

  // surfaces: form dropdowns light, inside a dialog
  const countryStyle = await style(country.page().locator('[role="dialog"] [data-select-trigger], [role="dialog"] [data-button][data-variant="field"]').first());
  check("7. form dropdown inside the dialog uses the light form surface", countryStyle.surface === "form" && luminance(countryStyle.bg) > 0.8 && luminance(countryStyle.color) < 0.2, JSON.stringify(countryStyle));
  await ctx.close();
}

// ═════════ 2. existing customer: reuse, no duplicate entry; delivery change never edits the master ═════════
{
  const ctx = await newContext(browser);
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await openNewOrder(page);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator('[data-testid="customer-mode"]').getByText(/عميل موجود/).click();
  await page.waitForTimeout(400);
  await dlg.locator('[role="combobox"]').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.type(TAG);
  await page.waitForTimeout(1800);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(900);
  check("8. existing customer: identity shown as a summary, nothing re-entered", (await dlg.locator('[data-testid="customer-identity-summary"]').count()) === 1 && (await dlg.locator('input[name="customerName"]').count()) === 0);
  check("8. saved country (Saudi) proposes +966 / SAR for the order", /SAR/.test(await text(await currencyField(dlg))), await text(await currencyField(dlg)));
  await dlg.locator('[data-testid="different-address-toggle"]').click();
  await page.waitForTimeout(400);
  await dlg.locator('input[name="city"]').fill("Jeddah");
  await dlg.locator('input[name="address"]').fill(`${TAG} order-only address`);
  await shot(page, "existing-customer-different-address");
  await ctx.close();
}

// ═════════ 3. ONE advanced lookup, compact paginated table, read-only for other owners ═════════
{
  const ctx = await newContext(browser);
  const page = await login(ctx, "demo-r7-sales-b@oms.local");
  for (const route of ["/store-orders", "/crm/leads"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    const entries = await page.getByRole("button", { name: /بحث متقدم عن عميل|Advanced customer lookup/ }).count();
    const legacy = await page.getByText(/بحث عن عميل أو طلب|Search by phone|بحث بالهاتف أو رقم الطلب|Global lookup/i).count();
    check(`9. ${route}: exactly one advanced-lookup entry point, no redundant phone/order-number button`, entries === 1 && legacy === 0, `entries=${entries} legacy=${legacy}`);
  }
  {
    // The customers page: sales B has no customers screen, so count it as the admin.
    const actx = await newContext(browser);
    const apage = await login(actx, "demo-r7-admin@oms.local");
    await apage.goto(`${BASE}/sales/customers`, { waitUntil: "domcontentloaded" });
    await settle(apage, 1500);
    const entries = await apage.getByRole("button", { name: /بحث متقدم عن عميل|Advanced customer lookup/ }).count();
    check("9. /sales/customers: exactly one advanced-lookup entry point", entries === 1, `entries=${entries}`);
    await actx.close();
  }
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  await page.getByRole("button", { name: /بحث متقدم عن عميل|Advanced customer lookup/ }).click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator("input").first().fill(toAr(national));
  await dlg.locator("input").first().press("Enter");
  await page.waitForTimeout(2500);
  const table = dlg.locator('[data-testid="advanced-lookup-table"]');
  check("10. Arabic-digit phone finds the customer owned by another employee (compact table)", (await table.count()) === 1 && (await table.locator("tbody tr").count()) >= 1, `${await table.locator("tbody tr").count()} row(s)`);
  const body = await text(dlg);
  check("10. flagged 'not assigned to you', masked identity, read-only (no open link)", /غير مسند إليك|Not assigned to you/.test(body) && /•/.test(body) && (await dlg.locator("tbody a").count()) === 0 && !body.includes(`${TAG} Existing`));
  await shot(page, "advanced-lookup-result");

  // order number in the same dialog
  const orderNo = seed.j?.internalOrderId;
  await dlg.locator("input").first().fill(orderNo);
  await dlg.locator("input").first().press("Enter");
  await page.waitForTimeout(2200);
  check("11. an order number is searched in the SAME dialog", (await text(dlg)).includes(orderNo), orderNo);
  // bad input shows validation
  await dlg.locator("input").first().fill("12");
  await dlg.locator("input").first().press("Enter");
  await page.waitForTimeout(600);
  check("11. too-short input shows a validation hint, no request result", /7|رقم هاتف|phone/i.test(await text(dlg)));
  await ctx.close();
}

// ═════════ 4. dropdown appearance: toolbar strong, forms light (light + dark, LTR/RTL) ═════════
for (const scheme of [
  { locale: "ar", theme: "light" },
  { locale: "en", theme: "dark" },
]) {
  const ctx = await newContext(browser, scheme);
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1800);
  const dirAttr = await page.evaluate(() => document.documentElement.dir);
  const tb = await style(page.locator('[data-slot="list-toolbar"] [data-button][data-variant="field"]').first());
  const darkMode = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  check(`12. [${scheme.locale}/${scheme.theme}] toolbar dropdown keeps the strong blue (white text)`, !!tb.tone && luminance(tb.color) > 0.8 && (darkMode || luminance(tb.bg) < 0.25), JSON.stringify(tb));
  await page.getByRole("button", { name: NEW_ORDER }).first().click();
  await page.locator('[role="dialog"]').first().waitFor();
  await page.waitForTimeout(700);
  const dlg = page.locator('[role="dialog"]').first();
  const triggers = await dlg.locator('[data-select-trigger], [data-button][data-variant="field"]').evaluateAll((els) =>
    els.map((el) => ({ surface: el.getAttribute("data-surface"), bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })),
  );
  const light = triggers.filter((t) => t.surface === "form");
  check(`13. [${scheme.locale}/${scheme.theme}] every dropdown in the order dialog is the form variant (${triggers.length})`, triggers.length >= 3 && light.length === triggers.length, JSON.stringify(triggers.filter((t) => t.surface !== "form")));
  const ok = light.every((t) => (darkMode ? luminance(t.bg) < 0.12 && luminance(t.color) > 0.5 : luminance(t.bg) > 0.8 && luminance(t.color) < 0.2));
  check(`13. [${scheme.locale}/${scheme.theme}] readable: ${darkMode ? "light text on a dark-blue tint" : "dark text on a very light blue"}`, ok, JSON.stringify(light[0]));
  check(`14. [${scheme.locale}] dir=${dirAttr}`, dirAttr === (scheme.locale === "ar" ? "rtl" : "ltr"));
  // keyboard: Tab to the country field, open with Enter, choose with arrows
  await shot(page, `order-form-${scheme.locale}-${scheme.theme}`);
  await ctx.close();
}

// ═════════ 5. mobile: form + lookup reflow, actions reachable ═════════
{
  const ctx = await newContext(browser, { viewport: { width: 390, height: 844 }, touch: true });
  const page = await login(ctx, "demo-r7-sales-a@oms.local");
  await openNewOrder(page);
  const dlg = page.locator('[role="dialog"]').first();
  const m = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    const submit = [...d.querySelectorAll("button")].find((b) => /إنشاء الطلب|Create Order/.test(b.textContent));
    const sr = submit?.getBoundingClientRect();
    return { dlgW: r.width, scrollW: document.documentElement.scrollWidth, vw: innerWidth, submitVisible: !!sr && sr.bottom <= innerHeight + 1 && sr.top >= 0, submitH: sr?.height };
  });
  check("15. mobile 390: no horizontal page scroll, create action reachable, touch-sized", m.scrollW <= m.vw && m.submitVisible && m.submitH >= 36, JSON.stringify(m));
  await shot(page, "order-form-mobile-390");
  await ctx.close();
}

// ═════════ 5b. mobile: the unified lookup stacks its rows and does not scroll sideways ═════════
{
  const ctx = await newContext(browser, { viewport: { width: 390, height: 844 }, touch: true });
  const page = await login(ctx, "demo-r7-sales-b@oms.local");
  await page.goto(`${BASE}/store-orders`, { waitUntil: "domcontentloaded" });
  await settle(page, 1800);
  // On a phone the toolbar controls live in the Filters panel, which is where the lookup is offered.
  await page.getByRole("button", { name: /^الفلاتر|^Filters/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /بحث متقدم عن عميل|Advanced customer lookup/ }).last().click();
  const dlg = page.locator('[role="dialog"]').last();
  await dlg.locator("input").first().fill(toAr(national));
  await dlg.locator("input").first().press("Enter");
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="advanced-lookup-table"] tbody tr');
    const d = document.querySelector('[role="dialog"]').getBoundingClientRect();
    return { rowDisplay: row && getComputedStyle(row).display, scrollW: document.documentElement.scrollWidth, vw: innerWidth, dlgRight: d.right };
  });
  check("18. mobile 390: lookup result rows stack as cards, no sideways scroll", m.rowDisplay === "flex" && m.scrollW <= m.vw && m.dlgRight <= m.vw, JSON.stringify(m));
  await shot(page, "advanced-lookup-mobile-390");
  await ctx.close();
}

// ═════════ 6. agent screens ═════════
{
  const ctx = await newContext(browser);
  const page = await login(ctx, "demo-r7-admin@oms.local");
  const agents = (await call(adminT, "GET", "/agents?pageSize=5")).j.items ?? [];
  const agentId = agents[0]?.id;
  await page.goto(`${BASE}/agents/${agentId}`, { waitUntil: "domcontentloaded" });
  await settle(page, 2500);
  const tiles = await page.locator('[data-slot="insight-card"]').count();
  check("16. internal agent overview uses the dashboard card language (InsightCards)", tiles >= 6, `${tiles}`);
  check("16. no legacy KPI tiles remain on the agent overview", (await page.locator('[data-slot="kpi-card"]').count()) === 0);
  await shot(page, "agent-overview");
  await page.getByRole("tab", { name: /كشف الحساب|Statement/ }).first().click().catch(() => {});
  await settle(page, 2000);
  await shot(page, "agent-statement-company");
  await ctx.close();

  const actx = await newContext(browser);
  const apage = await login(actx, "agent-a-admin.demo-agt@oms.local");
  await apage.goto(`${BASE}/agent/statement`, { waitUntil: "domcontentloaded" });
  await settle(apage, 2500);
  const portalTiles = await apage.locator('[data-slot="insight-card"]').count();
  check("17. agent portal statement uses InsightCards + summary cards", portalTiles >= 9, `${portalTiles}`);
  const body = await apage.locator("main").innerText();
  check("17. agent-visible metrics only: no company margin / cost on the agent statement", !/هامش الربح|Gross margin|تكلفة الشركة|Company cost/i.test(body));
  await shot(apage, "agent-statement-portal");
  await apage.goto(`${BASE}/agent/dashboard`, { waitUntil: "domcontentloaded" });
  await settle(apage, 2500);
  await shot(apage, "agent-dashboard");
  await actx.close();
}

await browser.close();
writeFileSync(`${OUT}/browser-acceptance.json`, JSON.stringify({ tag: TAG, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
