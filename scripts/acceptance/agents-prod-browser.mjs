#!/usr/bin/env node
/* eslint-disable no-console */
/* global document, window */
/**
 * Agents / Fulfillment Partners — PRODUCTION browser acceptance (Arabic UI). D1 unset: D1-* journeys must fail closed and are reported BLOCKED.
 * specs/agents-fulfillment-partners brief §12; screenshots named after the Arabic guides
 * (docs/user-guide/agents/*.md → docs/user-guide/evidence/agents-20260928/).
 *
 *   node scripts/acceptance/agents-browser-acceptance.mjs
 *   ONLY=J1,J3 HEADED=1 node scripts/acceptance/agents-browser-acceptance.mjs
 *
 * Prerequisites: ensure-agents-demo.ts ran (demo agents A/B + users) and the API/web are up.
 * Passwords: QA_PASSWORD, AGENT_DEMO_PASSWORD (env or tmp/.qa.env) — never printed.
 * Env: BASE (web, default http://localhost:3001), API (default http://localhost:3005),
 *      ONLY / SKIP (journey ids csv), HEADED=1.
 * Output: tmp/agents-acceptance/browser-<RUN>.json (+ browser-latest.json),
 *         screenshots in docs/user-guide/evidence/agents-20260928/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
(function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1).replace(/^["']|["']$/g, "");
  }
})(resolve(ROOT, "tmp/.qa.env"));

const TAG = "DEMO-AGT-20260928";
const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = (process.env.API ?? "https://oms.haseb.org/api").replace(/\/$/, "");
const pad = (n) => String(n).padStart(2, "0");
const NOW = new Date();
const RUN = `${TAG}-PB${pad(NOW.getHours())}${pad(NOW.getMinutes())}${pad(NOW.getSeconds())}`;
const SHORT = RUN.slice(-6);
const EVIDENCE = resolve(ROOT, "docs/user-guide/evidence/agents-20260928/prod");
const OUT = resolve(ROOT, "tmp/agents-acceptance/prod");
for (const d of [EVIDENCE, OUT]) mkdirSync(d, { recursive: true });
const QA_PW = process.env.QA_PASSWORD ?? "";
const AGENT_PW = process.env.AGENT_DEMO_PASSWORD ?? "";
if (!QA_PW || !AGENT_PW) {
  console.error("QA_PASSWORD and AGENT_DEMO_PASSWORD are required.");
  process.exit(2);
}
const envList = (n) => (process.env[n] ? process.env[n].split(",").map((s) => s.trim()).filter(Boolean) : null);
const ONLY = envList("ONLY");
const SKIP = envList("SKIP") ?? [];
const want = (id) => (!ONLY || ONLY.includes(id)) && !SKIP.includes(id);

const PERSONAS = {
  admin: "qa-admin@oms.haseb.org",
  fin: "qa-finance@oms.haseb.org",
  ship: "qa-shipping@oms.haseb.org",
  aAdmin: "agent-a-admin.demo-agt@oms.haseb.org",
  aS1: "agent-a-sales1.demo-agt@oms.haseb.org",
};
const pwOf = (email) => (email.includes(".demo-agt@") ? AGENT_PW : QA_PW);
const TODAY = new Date().toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const uiDate = (isoDate) => {
  const [y, m, d] = isoDate.split("-");
  return `${d} ${MON[Number(m) - 1]} ${y}`;
};
const mobile = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const r2 = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.011;

// ───────────────────────────────────────────────────────────── API (lookups / setup only)
const apiTokens = {};
async function apiLogin(email, password = pwOf(email)) {
  if (apiTokens[email]) return apiTokens[email];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.accessToken) throw new Error(`api login ${email} → ${res.status} ${json.code ?? ""}`);
  apiTokens[email] = json.accessToken;
  return json.accessToken;
}
async function api(email, method, path, body) {
  const token = await apiLogin(email);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${json?.code ?? ""} ${JSON.stringify(json?.message ?? "").slice(0, 200)}`);
  return json;
}

// ───────────────────────────────────────────────────────────── report
class Fail extends Error {}
class Blocked extends Error {}
const need = (v, w) => {
  if (v === undefined || v === null) throw new Blocked(`dependency missing: ${w}`);
  return v;
};
const expect = (c, m) => {
  if (!c) throw new Fail(m);
};
const results = [];
const shots = [];
const ctx = { run: RUN, refs: {} };
async function journey(id, title, fn) {
  if (!want(id)) return;
  const t0 = Date.now();
  const before = shots.length;
  try {
    const detail = await fn();
    results.push({ id, title, status: "PASS", detail: detail ?? "", shots: shots.slice(before), ms: Date.now() - t0 });
    console.log(`PASS    ${id} ${title}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`);
  } catch (e) {
    const status = e instanceof Blocked ? "BLOCKED" : "FAIL";
    for (const s of sessions.values()) await s.page.screenshot({ path: resolve(OUT, `fail-${id}-${s.key}.png`) }).catch(() => {});
    results.push({ id, title, status, detail: e.message, shots: shots.slice(before), ms: Date.now() - t0 });
    console.log(`${status.padEnd(7)} ${id} ${title} — ${e.message.slice(0, 500)}`);
  }
}

// ───────────────────────────────────────────────────────────── browser
let browser;
const sessions = new Map();
async function session(key, email, { viewport = { width: 1440, height: 900 }, password } = {}) {
  if (sessions.has(key)) return sessions.get(key);
  const context = await browser.newContext({ viewport, locale: "ar-SA", colorScheme: "light" });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("oms.locale", JSON.stringify("ar"));
      window.localStorage.setItem("theme", "light");
    } catch {
      /* storage blocked */
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await uiLogin(page, email, password ?? pwOf(email));
  const s = { key, email, context, page, errors };
  sessions.set(key, s);
  return s;
}
async function uiLogin(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await settle(page);
}
const LOADING = /جارٍ التحميل|جار التحميل/;
async function settle(page, maxMs = 20000) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: maxMs }).catch(() => {});
  await page
    .waitForFunction(
      (src) => {
        const txt = document.querySelector("main")?.innerText ?? "";
        return !new RegExp(src).test(txt.slice(0, 4000)) && document.querySelectorAll('main [data-slot="skeleton"], main .animate-pulse').length === 0;
      },
      LOADING.source,
      { timeout: maxMs },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
}
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page);
}
async function shot(page, name, { full = false } = {}) {
  const file = resolve(EVIDENCE, name.endsWith(".png") ? name : `${name}.png`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, fullPage: full });
  shots.push(`docs/user-guide/evidence/agents-20260928/prod/${name.endsWith(".png") ? name : `${name}.png`}`);
  return file;
}
const dialog = (page) => page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').filter({ hasNotText: "لوحة الأوامر" }).last();
const byLabel = (scope, re) => scope.getByLabel(re).first();
const button = (scope, re) => scope.getByRole("button", { name: re }).first();
async function pick(page, trigger, optionRe, search) {
  await trigger.click();
  await page.waitForTimeout(250);
  if (search) {
    await page.keyboard.type(search, { delay: 20 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  const opt = page.getByRole("option", { name: optionRe }).first();
  await opt.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  if (!(await opt.isVisible().catch(() => false))) {
    const avail = await page.getByRole("option").allInnerTexts().catch(() => []);
    await page.keyboard.press("Escape").catch(() => {});
    throw new Fail(`option ${optionRe} not found (have: ${avail.slice(0, 8).join(" | ")})`);
  }
  await opt.click();
  await page.waitForTimeout(250);
}
async function markToasts(page) {
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((e) => e.setAttribute("data-seen", "1"))).catch(() => {});
}
async function toast(page, re, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const list = await page
      .locator("[data-sonner-toast]:not([data-seen])")
      .evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), text: e.innerText.trim() })))
      .catch(() => []);
    const hit = list.find((t) => re.test(t.text));
    if (hit) return hit.text;
    const err = list.find((t) => t.type === "error");
    if (err) throw new Fail(`error toast: ${err.text.slice(0, 300)}`);
    await page.waitForTimeout(250);
  }
  throw new Fail(`toast ${re} not shown`);
}
async function mainText(page) {
  return page.locator("main").first().innerText({ timeout: 5000 }).catch(() => "");
}
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

// ───────────────────────────────────────────────────────────── demo lookups
async function demo() {
  if (ctx.A) return;
  const list = await api(PERSONAS.admin, "GET", `/agents?search=${encodeURIComponent(TAG)}&pageSize=50`);
  ctx.A = list.items.find((a) => a.name.startsWith("وكيل تجريبي A "));
  ctx.B = list.items.find((a) => a.name.startsWith("وكيل تجريبي B "));
  if (!ctx.A) throw new Blocked("demo agent A missing — run ensure-agents-demo.ts");
  const me = await api(PERSONAS.aS1, "GET", "/agent-portal/me");
  ctx.EG = me.agreement.shippingRates.find((r) => r.country.code === "EG").country;
  ctx.terms = me.agreement;
  const products = (await api(PERSONAS.aS1, "GET", "/agent-portal/products?pageSize=50")).items;
  ctx.pA = products.find((p) => p.isInventoryItem);
  ctx.cA = products.find((p) => !p.isInventoryItem);
  const dest = await api(PERSONAS.aS1, "GET", "/agent-portal/payment-destinations");
  ctx.dBank = dest.find((d) => d.ownership === "COMPANY" && d.label.includes("تحويل بنكي"));
  ctx.dWallet = dest.find((d) => d.ownership === "AGENT");
}
const orderByNumber = async (email, number) =>
  (await api(email, "GET", `/agent-portal/orders?search=${encodeURIComponent(number)}`)).items.find((o) => o.internalOrderId === number);

// ───────────────────────────────────────────────────────────── journeys
async function main() {
  browser = await chromium.launch({ headless: !process.env.HEADED });
  await demo();

  // P-J1 — forced password change: internal admin resets a demo agent user from the Agent team tab
  // (one-time password shown once), the user's first login lands on /profile/password.
  await journey("J1", "Forced password change: Agent team tab → reset password (one-time) → first login forced to /profile/password → portal", async () => {
    const { page } = await session("admin", PERSONAS.admin);
    const email = "agent-a-sales2.demo-agt@oms.haseb.org";
    await go(page, `/agents/${ctx.A.id}`);
    await page.getByRole("tab", { name: "فريق الوكيل" }).click();
    await settle(page);
    const row = page.getByRole("row").filter({ hasText: email }).first();
    await row.waitFor({ timeout: 15000 });
    const direct = row.getByRole("button", { name: /إعادة تعيين كلمة المرور/ });
    if (await direct.isVisible().catch(() => false)) await direct.click();
    else {
      await row.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: /إعادة تعيين كلمة المرور/ }).click();
    }
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    await markToasts(page);
    await confirm.getByRole("button", { name: /إعادة تعيين|تأكيد/ }).last().click();
    await page.waitForTimeout(1500);
    const temp = await dialog(page)
      .locator("input[readonly], code, [data-temp-password], [data-slot='temporary-password']")
      .first()
      .evaluate((el) => ("value" in el && el.value ? el.value : el.textContent ?? "").trim())
      .catch(() => "");
    expect(temp && temp.length >= 8, "temporary password not shown after reset");
    await page.keyboard.press("Escape").catch(() => {});
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA" });
    await fresh.addInitScript(() => {
      try {
        window.localStorage.setItem("oms.locale", JSON.stringify("ar"));
      } catch {
        /* ignore */
      }
    });
    const p2 = await fresh.newPage();
    await uiLogin(p2, email, temp);
    await p2.waitForURL((u) => u.pathname.startsWith("/profile/password"), { timeout: 20000 }).catch(() => {});
    await settle(p2);
    expect(p2.url().includes("/profile/password"), `first login landed on ${p2.url()}`);
    await shot(p2, "prod-01-forced-password");
    const inputs = p2.locator('input[type="password"]');
    await inputs.nth(0).fill(temp);
    await inputs.nth(1).fill(AGENT_PW);
    await inputs.nth(2).fill(AGENT_PW);
    await p2.locator('button[type="submit"]').first().click();
    await p2.waitForURL((u) => !u.pathname.includes("/profile/password"), { timeout: 30000 }).catch(() => {});
    await settle(p2);
    const landed = new URL(p2.url()).pathname;
    await fresh.close();
    expect(landed.startsWith("/agent"), `after change landed on ${landed}`);
    return `${email}: reset in Agent team tab → forced change → ${landed}`;
  });


  // J2 — agent sales login lands on the portal.
  await journey("J2", "Agent sales login lands on /agent (portal navigation only)", async () => {
    const { page } = await session("aS1", PERSONAS.aS1);
    await page.waitForURL((u) => u.pathname.startsWith("/agent"), { timeout: 15000 }).catch(() => {});
    const path = new URL(page.url()).pathname;
    expect(path === "/agent" || path.startsWith("/agent/"), `landed on ${path}`);
    const nav = await page.locator("aside, nav").first().innerText().catch(() => "");
    expect(!/الإعدادات|المالية/.test(nav), `internal navigation visible: ${nav.slice(0, 200)}`);
    await shot(page, "prod-00-sales-landing");
    return `landed ${path}`;
  });

  const fillCustomer = async (page, scope, label, city = "القاهرة") => {
    await byLabel(scope, /^اسم العميل/).fill(`عميل ${label} — ${RUN}`);
    await pick(page, byLabel(scope, /^الدولة/), /^مصر$/, "مصر");
    await byLabel(scope, /^الجوال/).fill(mobile());
    await byLabel(scope, /^المدينة/).fill(city);
    await byLabel(scope, /^العنوان/).fill(`عنوان تجريبي ${label} — ${TAG}`);
  };
  const waitBreakdown = async (page, re) => {
    await page
      .waitForFunction((src) => new RegExp(src).test(document.querySelector("main")?.innerText ?? ""), re.source, { timeout: 20000 })
      .catch(() => {});
    const txt = await mainText(page);
    expect(re.test(txt), `breakdown ${re} not shown`);
  };
  const createdOrderNumber = async (page) => {
    const t = await toast(page, /تم إنشاء الطلب/, 30000);
    const m = t.match(/STO-[\d-]+/);
    expect(m, `order number not in toast: ${t}`);
    await page.waitForURL((u) => /\/agent\/orders\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 20000 }).catch(() => {});
    await settle(page);
    return m[0];
  };

  // J3 — lead → convert with Shipping added.
  await journey("J3", "Agent sales: new lead → convert to order with «الشحن يُضاف» (1,000 + 100 = 1,100)", async () => {
    const { page } = await session("aS1", PERSONAS.aS1);
    await go(page, "/agent/leads");
    await button(page, /^عميل محتمل جديد$/).click();
    const dlg = dialog(page);
    await fillCustomer(page, dlg, "J3");
    await pick(page, byLabel(dlg, /^المنتج/), /منتج الوكيل A/);
    await byLabel(dlg, /^الكمية/).fill("2");
    await shot(page, "prod-02-new-lead");
    await markToasts(page);
    await button(dlg, /^حفظ$/).click();
    const t = await toast(page, /تم إنشاء العميل المحتمل/);
    const leadNo = t.match(/LD-[\d-]+/)?.[0];
    const leads = await api(PERSONAS.aS1, "GET", `/agent-portal/leads?search=${encodeURIComponent(leadNo ?? RUN)}`);
    const rows = leads.items ?? leads;
    const lead = rows.find((l) => l.leadNumber === leadNo) ?? rows[0];
    expect(lead, `lead ${leadNo} not found`);
    await go(page, `/agent/leads/${lead.id}`);
    await markToasts(page);
    const convertLink = page.getByRole("link", { name: /^تحويل إلى طلب$/ });
    if (await convertLink.count()) await convertLink.first().click();
    else await button(page, /^تحويل إلى طلب$/).click();
    await page.waitForURL((u) => u.pathname.startsWith("/agent/orders/new"), { timeout: 15000 }).catch(() => {});
    await settle(page);
    await page.getByRole("radio", { name: "الشحن يُضاف" }).check().catch(() => {});
    await page.getByRole("spinbutton", { name: /^مبلغ السطر/ }).first().fill("1000");
    await waitBreakdown(page, /1,100(\.00)?/);
    await shot(page, "prod-03-order-shipping-added");
    await markToasts(page);
    await page.getByRole("button", { name: /^(تحويل إلى طلب|إنشاء الطلب)$/ }).last().click();
    ctx.refs.orderAdded = await createdOrderNumber(page);
    ctx.refs.lead = leadNo;
    const o = await orderByNumber(PERSONAS.aS1, ctx.refs.orderAdded);
    expect(near(o.breakdown.payableTotal, 1100) && near(o.breakdown.shippingCharge, 100), `breakdown ${JSON.stringify(o.breakdown)}`);
    ctx.orderAddedId = o.id;
    return `${leadNo} → ${ctx.refs.orderAdded} payable ${o.breakdown.payableTotal}`;
  });

  // J4 — direct order with Shipping included.
  await journey("J4", "Agent sales: new order «السعر شامل الشحن» 1,000 incl. 100 ⇒ 900 + 100 with live breakdown", async () => {
    const { page } = await session("aS1", PERSONAS.aS1);
    await go(page, "/agent/orders/new");
    const main = page.locator("main");
    await fillCustomer(page, main, "J4");
    await page.getByRole("radio", { name: "السعر شامل الشحن" }).check();
    await pick(page, main.getByRole("combobox", { name: /^المنتج/ }).first(), /منتج الوكيل A/);
    await main.getByRole("spinbutton", { name: /^الكمية/ }).first().fill("2");
    await byLabel(main, /الإجمالي المتفق عليه شاملاً الشحن/).fill("1000");
    await waitBreakdown(page, /900(\.00)?/);
    await shot(page, "prod-04-order-shipping-included");
    await markToasts(page);
    await button(page, /^إنشاء الطلب$/).click();
    ctx.refs.orderIncluded = await createdOrderNumber(page);
    const o = await orderByNumber(PERSONAS.aS1, ctx.refs.orderIncluded);
    expect(near(o.breakdown.merchandiseAmount, 900) && near(o.breakdown.payableTotal, 1000), `breakdown ${JSON.stringify(o.breakdown)}`);
    ctx.orderIncludedId = o.id;
    return `${ctx.refs.orderIncluded} ${JSON.stringify(o.breakdown)}`;
  });

  // J5 — declarations with proof upload (partial then full) to the company destination.
  await journey("J5", "Agent sales declares partial 400 (proof upload) then full remainder 600 to the company bank destination", async () => {
    const { page } = await session("aS1", PERSONAS.aS1);
    const id = ctx.orderIncludedId;
    if (!id) throw new Blocked("J4 order missing");
    const proof = resolve(OUT, `proof-${SHORT}.png`);
    writeFileSync(proof, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
    const declareOnce = async (kind, { amount, screenshot } = {}) => {
      await go(page, `/agent/orders/${id}`);
      await button(page, /^الإبلاغ عن الدفع$/).click();
      const dlg = dialog(page);
      await dlg.getByRole("radio", { name: kind }).check();
      if (amount) await byLabel(dlg, /^المبلغ المدفوع/).fill(String(amount));
      await pick(page, byLabel(dlg, /^جهة الدفع/), /تحويل بنكي لحساب الشركة/);
      await byLabel(dlg, /^مرجع الدفع/).fill(`${RUN}-${amount ?? "FULL"}`);
      await dlg.locator('input[type="file"]').first().setInputFiles(proof);
      await page.waitForTimeout(1500);
      if (screenshot) await shot(page, screenshot);
      await markToasts(page);
      await button(dlg, /^حفظ الإبلاغ$/).click();
      return toast(page, /تم الإبلاغ عن الدفع|تم الحفظ/);
    };
    await declareOnce("دفع جزئي", { amount: 400, screenshot: "prod-04b-declare-partial-proof" });
    let o = await api(PERSONAS.aS1, "GET", `/agent-portal/orders/${id}`);
    expect(o.payment.declaredPaymentStatus === "PARTIALLY_PAID" && near(o.payment.remainingToDeclare, 600), `after partial: ${o.payment.declaredPaymentStatus} rem ${o.payment.remainingToDeclare}`);
    expect(o.payment.claims[0].attachments.length === 1, "proof not attached");
    await declareOnce("دفع كامل المبلغ");
    o = await api(PERSONAS.aS1, "GET", `/agent-portal/orders/${id}`);
    expect(o.payment.declaredPaymentStatus === "PAID" && o.payment.claims.length === 2, `after full: ${o.payment.declaredPaymentStatus} claims ${o.payment.claims.length}`);
    ctx.claimsIncluded = o.payment.claims.map((c) => ({ id: c.id, number: c.paymentNumber }));
    // The Shipping-added order is declared in full (1,100) through the same portal API.
    if (ctx.orderAddedId) {
      const d = await api(PERSONAS.aS1, "POST", `/agent-portal/orders/${ctx.orderAddedId}/payment-declaration`, {
        kind: "FULL",
        destinationId: ctx.dBank.id,
        paymentDate: TODAY,
        reference: `${RUN}-1100`,
        idempotencyKey: `${RUN}-added-full`,
      });
      ctx.claimsAdded = d.payment.claims.map((c) => ({ id: c.id, number: c.paymentNumber }));
    }
    return `claims ${ctx.claimsIncluded.map((c) => c.number).join(", ")} (400 + 600, proof attached)`;
  });

  // Internal ids of the orders created in J3/J4 (for internal pages).
  const internalId = async (number) => (await orderByNumber(PERSONAS.aS1, number))?.id;

  // J6 — internal Shipping works agent orders from the shared queues.
  await journey("J6", "Internal Shipping: /shipping + /store-orders Agent filter; ship & deliver agent orders; A5 COD slip; receive a partial return", async () => {
    const { page } = await session("ship", PERSONAS.ship);
    const incl = ctx.refs.orderIncluded;
    const added = ctx.refs.orderAdded;
    if (!incl || !added) throw new Blocked("J3/J4 orders missing");
    // Store orders list with the Agent filter.
    await go(page, "/store-orders");
    const agentFilter = page.getByRole("combobox").filter({ hasText: /^الوكيل$/ }).first();
    await pick(page, agentFilter, /وكيل تجريبي A/, "تجريبي A");
    await settle(page);
    const listText = await mainText(page);
    expect(listText.includes(incl), `${incl} not in agent-filtered store orders`);
    expect(!/وكيل تجريبي B/.test(listText), "agent B orders leak into agent A filter");
    await shot(page, "prod-14-store-orders-agent-filter");
    // Start shipping from Store Orders (bulk «تغيير حالة الشحن» → تم الشحن) for both agent orders.
    for (const n of [incl, added]) {
      const search = page.getByPlaceholder(/رقم الطلب/).first();
      await search.fill(n);
      await page.waitForTimeout(1500);
      await settle(page);
      const r = page.locator("main table tbody tr").filter({ hasText: n }).first();
      await r.waitFor({ timeout: 15000 });
      await r.getByRole("checkbox").first().check();
      await page.waitForTimeout(300);
      await button(page, /تغيير حالة الشحن/).click();
      const bd = dialog(page);
      await pick(page, bd.locator('[role="combobox"]').first(), /^تم الشحن$/);
      await markToasts(page);
      await button(bd, /^تغيير الحالة$/).click();
      const alert = page.getByRole("alertdialog").last();
      if (await alert.isVisible({ timeout: 3000 }).catch(() => false)) await button(alert, /تأكيد/).click();
      await page.waitForTimeout(1500);
      await settle(page);
      await r.getByRole("checkbox").first().uncheck().catch(() => {});
    }
    // Shipping queue with the Agent filter → deliver from the inline status cell.
    await go(page, "/shipping");
    await pick(page, page.getByRole("combobox").filter({ hasText: /^الوكيل$/ }).first(), /وكيل تجريبي A/, "تجريبي A");
    await settle(page);
    const setStatus = async (number, labelRe) => {
      await page.getByRole("searchbox").first().fill(number.slice(-6));
      await page.waitForTimeout(1000);
      await settle(page);
      const r = page.getByRole("row").filter({ hasText: number }).first();
      await r.waitFor({ timeout: 15000 });
      await r.getByRole("combobox", { name: "حالة الشحن" }).click();
      await page.getByRole("option", { name: labelRe }).first().click();
      await page.waitForTimeout(1500);
      await settle(page);
    };
    await page.getByRole("searchbox").first().fill(incl.slice(-6));
    await page.waitForTimeout(1000);
    await settle(page);
    await page.getByRole("row").filter({ hasText: incl }).first().waitFor({ timeout: 15000 });
    await shot(page, "prod-16-shipped");
    await page.getByRole("searchbox").first().fill("");
    await page.waitForTimeout(1000);
    await settle(page);
    await shot(page, "prod-15-shipping-agent-filter");
    await setStatus(incl, /^تم التسليم$/);
    await setStatus(added, /^تم التسليم$/);
    for (const n of [incl, added]) {
      const o = await orderByNumber(PERSONAS.aS1, n);
      expect(o.dispatchedAt && o.earnedAt, `${n} not dispatched/earned (${o.fulfillmentStatus?.code})`);
    }
    // Agent order breakdown in the store order detail.
    const inclId = await internalId(incl);
    await go(page, `/store-orders/${inclId}`);
    await page.getByText("تفصيل السعر").first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, "prod-17-agent-order-breakdown");
    // A5 package slip of a COD «Shipping added» 1,000 + 100 order: collect 1,100.
    const me = await api(PERSONAS.aS1, "GET", "/agent-portal/me");
    const cod = await api(PERSONAS.aS1, "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA.id, quantity: 2, lineAmount: 1000 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "CASH_ON_DELIVERY",
      countryId: me.agreement.shippingRates.find((r) => r.country.code === "EG").country.id,
      city: "القاهرة",
      customer: { name: `عميل الدفع عند الاستلام — ${RUN}`, mobile: mobile(), countryId: ctx.EG.id, city: "القاهرة", address: `عنوان — ${TAG}` },
      idempotencyKey: `${RUN}-cod-slip`,
    });
    ctx.refs.orderCod = cod.internalOrderId;
    await go(page, `/store-orders/${cod.id}`);
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 20000 }).catch(() => null),
      button(page, /طباعة ملصق الطرد/).click(),
    ]);
    const slipPage = popup ?? page;
    await slipPage.waitForLoadState("networkidle").catch(() => {});
    await slipPage.waitForTimeout(2000);
    const slipText = await slipPage.locator("body").innerText().catch(() => "");
    expect(/1,100(\.00)?/.test(slipText), `slip does not show 1,100 (${slipText.slice(0, 200)})`);
    await shot(slipPage, "prod-18-slip-cod-1100");
    if (popup) await popup.close().catch(() => {});
    // Receive a partial return (1 of 2) on the Shipping-added order.
    const addedId = await internalId(added);
    await go(page, `/store-orders/${addedId}`);
    await button(page, /^استلام مرتجع$/).click();
    const dlg = dialog(page);
    await dlg.locator("table input").first().fill("1");
    await pick(page, byLabel(dlg, /^المستودع/), /المخزن الرئيسي/, "الرئيسي");
    const shipSel = byLabel(dlg, /^الشحنة المرتجعة/);
    if (await shipSel.isVisible().catch(() => false)) await pick(page, shipSel, /الشحنة رقم 1/);
    await byLabel(dlg, /^السبب/).fill(`مرتجع جزئي — ${RUN}`);
    await shot(page, "prod-19-receive-return");
    await markToasts(page);
    await button(dlg, /^استلام مرتجع$/).click();
    await toast(page, /تم تسجيل المرتجع/);
    return `${incl} & ${added} shipped + delivered via /shipping; COD slip ${cod.internalOrderId}; return on ${added}`;
  });

  const ledgerOf = async (orderId) =>
    (await api(PERSONAS.fin, "GET", `/agent-finance/agents/${ctx.A.id}/ledger?storeOrderId=${orderId}&pageSize=200`)).items;
  const net = (entries) => r2(entries.reduce((s, e) => s + Number(e.credit) - Number(e.debit), 0));
  /** Click an action and capture the error toast it must produce (fail-closed evidence). */
  const errorToast = async (page, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const list = await page
        .locator("[data-sonner-toast]:not([data-seen])")
        .evaluateAll((els) => els.map((e) => ({ type: e.getAttribute("data-type"), text: e.innerText.trim() })))
        .catch(() => []);
      const err = list.find((t) => t.type === "error");
      if (err) return err.text;
      const ok = list.find((t) => t.type === "success");
      if (ok) throw new Fail(`expected a refusal, got success toast: ${ok.text.slice(0, 200)}`);
      await page.waitForTimeout(250);
    }
    throw new Fail("no error toast / alert shown");
  };
  const blockedResult = (msg) => {
    throw new Blocked(`fails closed as expected — «${msg.replace(/\s+/g, " ").slice(0, 400)}»`);
  };

  // D1-A — company-destination verification in Payment review.
  await journey("D1-verify", "Company-destination verification in Payment review (Confirm & Post) — expected BLOCKED (D1 unset)", async () => {
    const { page } = await session("fin", PERSONAS.fin);
    const incl = need(ctx.refs.orderIncluded, "J4 order");
    await go(page, "/finance/payment-review");
    await page.getByRole("searchbox").first().fill(incl);
    await page.waitForTimeout(1500);
    await settle(page);
    const r = page.getByRole("row").filter({ hasText: incl }).filter({ has: page.getByRole("button", { name: "تأكيد وترحيل" }) }).first();
    await r.waitFor({ timeout: 15000 });
    await markToasts(page);
    await r.getByRole("button", { name: "تأكيد وترحيل" }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    if (await confirm.isVisible({ timeout: 2500 }).catch(() => false)) {
      await confirm.getByRole("button", { name: /تأكيد وترحيل|تأكيد/ }).last().click();
    }
    const msg = await errorToast(page);
    await shot(page, "prod-10-blocked-verify-company");
    const o = await orderByNumber(PERSONAS.aS1, incl);
    expect(o.financePaymentStatus !== "FULLY_PAID_RECONCILED", "payment was verified despite D1");
    blockedResult(msg);
  });

  // D1-B — company refund from the store-order panel.
  await journey("D1-refund", "Company-paid refund from the order panel — expected BLOCKED", async () => {
    const { page } = await session("admin", PERSONAS.admin);
    const added = need(ctx.refs.orderAdded ?? process.env.ORDER_ADDED, "J3 order");
    const id = (await orderByNumber(PERSONAS.aS1, added)).id;
    await go(page, `/store-orders/${id}`);
    await button(page, /تسجيل استرداد للعميل/).click();
    const dlg = dialog(page);
    await pick(page, byLabel(dlg, /^أعاد المبلغ/), /^الشركة/);
    await byLabel(dlg, /^المبلغ/).fill("100");
    const acct = byLabel(dlg, /^صُرف من/);
    if (await acct.isVisible().catch(() => false)) await pick(page, acct, /البنك الرئيسي/, "البنك");
    await byLabel(dlg, /^السبب/).fill(`اختبار الإغلاق — ${RUN}`);
    await markToasts(page);
    await button(dlg, /^تسجيل الاسترداد$/).click();
    const msg = await errorToast(page);
    await shot(page, "prod-11-blocked-company-refund");
    await page.keyboard.press("Escape").catch(() => {});
    blockedResult(msg);
  });

  // Agent collections: wallet (agent-destination) claim verified as a memo.
  await journey("J7", "Internal Finance verifies an agent-wallet collection in /agents/collections (memo, no company cash); payment stages", async () => {
    const { page } = await session("fin", PERSONAS.fin);
    const course = await api(PERSONAS.aS1, "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.cA.id, quantity: 1, lineAmount: 400 }],
      paymentType: "PREPAID",
      customer: { name: `عميل الدورة — ${RUN}`, mobile: mobile(), countryId: ctx.EG.id, city: "القاهرة" },
      idempotencyKey: `${RUN}-course`,
      declaration: { kind: "FULL", destinationId: ctx.dWallet.id, paymentDate: TODAY, reference: `${RUN}-WALLET`, idempotencyKey: `${RUN}-course-decl` },
    });
    ctx.refs.orderCourse = course.internalOrderId;
    await go(page, "/agents/collections");
    await page.getByRole("searchbox").first().fill(course.internalOrderId).catch(() => {});
    await page.waitForTimeout(1500);
    await settle(page);
    const row = page.getByRole("row").filter({ hasText: course.internalOrderId }).first();
    await row.waitFor({ timeout: 15000 });
    await row.getByRole("button", { name: /^تحقق$/ }).click();
    const vd = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
    await vd.waitFor();
    await shot(page, "prod-05-agent-collections-verify");
    await markToasts(page);
    await vd.getByRole("button", { name: /^تحقق$/ }).last().click();
    await toast(page, /تم التحقق من التحصيل/);
    const entries = await ledgerOf(course.id);
    const memo = entries.find((e) => e.entryType === "COLLECTION_BY_AGENT");
    expect(memo && near(memo.memoAmount, 400) && memo.postingStatus === "NOT_APPLICABLE", `memo ${JSON.stringify(memo)}`);
    // Payment stages panel (agent workspace → Orders tab), as Finance.
    const incl = ctx.refs.orderIncluded;
    await go(page, `/agents/${ctx.A.id}`);
    await page.getByRole("tab", { name: /^الطلبات$/ }).click();
    await settle(page);
    const orow = page.getByRole("row").filter({ hasText: incl }).first();
    if (await orow.isVisible({ timeout: 8000 }).catch(() => false)) {
      await orow.getByRole("button", { name: incl }).or(orow.getByRole("link", { name: incl })).first().click().catch(() => orow.click());
      await page.getByText("مراحل الدفع").first().waitFor({ timeout: 15000 });
      await page.getByText("مراحل الدفع").first().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, "prod-06-payment-stages");
    } else {
      ctx.findings = [...(ctx.findings ?? []), "Finance: agent workspace Orders tab shows no orders (store-order list is sales-scoped for qa-finance)"];
      await shot(page, "prod-06-orders-tab-finance-empty");
    }
    await page.keyboard.press("Escape").catch(() => {});
    const inclOrder = await orderByNumber(PERSONAS.aS1, incl);
    const e2 = await ledgerOf(inclOrder.id);
    ctx.refs.includedLedger = { order: incl, entries: e2.map((e) => `${e.entryType} ${Number(e.debit) || ""}${Number(e.credit) ? `+${Number(e.credit)}` : ""} ${e.postingStatus}`), net: net(e2) };
    expect(near(net(e2), -220), `pending charges on ${incl}: net ${net(e2)} (expected −90 −100 −30 before any company collection)`);
    return `wallet collection ${course.internalOrderId} memo 400; ${incl} charges −220 PENDING_CONFIGURATION (collection 1,000 blocked by D1)`;
  });


  // J8 — agent views (sales tracking + admin dashboard/order/stock).
  await journey("J8", "Agent sales order tracking; Agent Admin dashboard, order detail and stock", async () => {
    const inclOrder = ctx.refs.orderIncluded && (await orderByNumber(PERSONAS.aS1, ctx.refs.orderIncluded));
    if (!inclOrder) throw new Blocked("J4 order missing");
    const { page: sp } = await session("aS1", PERSONAS.aS1);
    await go(sp, `/agent/orders/${inclOrder.id}`);
    const st = await mainText(sp);
    expect(/مدفوع \(مُبلَّغ\)|بانتظار تحقق المالية/.test(st), "sales view does not show the declared status");
    await shot(sp, "prod-20-sales-order-tracking");
    const { page } = await session("aAdmin", PERSONAS.aAdmin);
    await go(page, "/agent");
    const dash = await mainText(page);
    expect(/الأموال المتاحة|الرصيد/.test(dash), "admin dashboard has no money KPIs");
    await shot(page, "prod-21-agent-admin-dashboard");
    await go(page, `/agent/orders/${inclOrder.id}`);
    await shot(page, "prod-22-agent-admin-order");
    await go(page, "/agent/stock");
    expect(/منتج الوكيل A/.test(await mainText(page)), "stock page empty");
    await shot(page, "prod-23-agent-admin-stock");
    return `order ${ctx.refs.orderIncluded} tracked; dashboard/order/stock rendered`;
  });

  // D1-C — payout dialog.
  await journey("D1-payout", "Finance payout dialog — expected BLOCKED (accounts not configured)", async () => {
    const { page } = await session("fin", PERSONAS.fin);
    await go(page, `/agents/${ctx.A.id}`);
    await page.getByRole("tab", { name: "المدفوعات للوكيل" }).click();
    await settle(page);
    const newBtn = button(page, /^صرف جديد$/);
    if (!(await newBtn.isEnabled().catch(() => false))) {
      await shot(page, "prod-12-blocked-payout");
      blockedResult(`«صرف جديد» disabled — ${(await mainText(page)).match(/حسابات الوكلاء[^\n]*/)?.[0] ?? ""}`);
    }
    await newBtn.click();
    const dlg = dialog(page);
    await dlg.waitFor();
    const notice = (await dlg.innerText()).match(/حسابات الوكلاء غير مضبوطة[^\n]*/)?.[0];
    await byLabel(dlg, /^المبلغ/).fill("1").catch(() => {});
    await pick(page, byLabel(dlg, /^حساب الصرف/), /البنك الرئيسي/, "البنك").catch(() => {});
    await byLabel(dlg, /^المرجع/).fill(`${RUN}-PAYOUT`).catch(() => {});
    await shot(page, "prod-12-blocked-payout");
    const submit = button(dlg, /^تأكيد الصرف$/);
    let msg = notice ?? "";
    if (await submit.isEnabled().catch(() => false)) {
      await markToasts(page);
      await submit.click();
      msg = `${msg} ${await errorToast(page)}`.trim();
      await shot(page, "prod-12b-blocked-payout-submit");
    } else {
      msg = `${msg} (تأكيد الصرف disabled)`.trim();
    }
    await page.keyboard.press("Escape").catch(() => {});
    expect(msg, "no fail-closed message shown");
    blockedResult(msg);
  });

  // D1-D — pending postings banner → post.
  await journey("D1-post", "Pending postings banner → «ترحيل القيود المعلقة» — expected BLOCKED", async () => {
    const { page } = await session("fin", PERSONAS.fin);
    await go(page, `/agents/${ctx.A.id}`);
    const post = button(page, /ترحيل القيود المعلقة/);
    await post.waitFor({ timeout: 15000 });
    await shot(page, "finance-06-pending-postings-banner");
    await markToasts(page);
    await post.click();
    const confirm = page.getByRole("alertdialog").last();
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.getByRole("button").last().click();
    const msg = await errorToast(page);
    await shot(page, "prod-13-blocked-post-pending");
    blockedResult(msg);
  });

  // J10 — statements + print preview (no payouts in Production while D1 is unset).
  await journey("J10", "Agent admin statement (pending charges) and internal statement print preview", async () => {
    const { page } = await session("aAdmin", PERSONAS.aAdmin);
    await go(page, "/agent/statement");
    const txt = await mainText(page);
    expect(/الرصيد الافتتاحي/.test(txt) && /الرصيد الختامي/.test(txt), "statement has no opening/closing");
    await shot(page, "prod-07-agent-statement");
    const { page: fp } = await session("fin", PERSONAS.fin);
    await go(fp, `/agents/${ctx.A.id}`);
    await fp.getByRole("tab", { name: "كشف الحساب" }).click();
    await settle(fp);
    await shot(fp, "prod-08-internal-statement");
    const [popup] = await Promise.all([fp.context().waitForEvent("page", { timeout: 20000 }).catch(() => null), button(fp, /^طباعة الكشف$/).click()]);
    const pp = popup ?? fp;
    await pp.waitForLoadState("networkidle").catch(() => {});
    await pp.waitForTimeout(2500);
    expect(/كشف حساب وكيل|الرصيد الختامي/.test(await pp.locator("body").innerText().catch(() => "")), "print preview not rendered");
    await shot(pp, "prod-09-statement-print");
    if (popup) await popup.close().catch(() => {});
    return `portal statement + print preview ${pp.url().replace(BASE, "")}`;
  });


  // J11 — audience separation in the browser.
  await journey("J11", "Agent cannot open internal URLs (redirected to /agent); internal user sees Access Denied on /agent", async () => {
    const { page } = await session("aS1", PERSONAS.aS1);
    const bad = [];
    for (const path of ["/store-orders", "/shipping", "/agents/collections", `/agents/${ctx.A.id}`, "/finance/payment-review", "/settings/users"]) {
      await go(page, path);
      await page.waitForURL((u) => u.pathname.startsWith("/agent"), { timeout: 10000 }).catch(() => {});
      const landed = new URL(page.url()).pathname;
      if (!(landed === "/agent" || landed.startsWith("/agent/"))) bad.push(`${path} → ${landed}`);
      if (path === "/store-orders") await shot(page, "prod-24-agent-redirected");
    }
    const { page: fp } = await session("fin", PERSONAS.fin);
    await go(fp, "/agent");
    await fp.waitForTimeout(1500);
    const t = await fp.locator("body").innerText();
    if (!/الوصول مرفوض/.test(t)) bad.push(`internal /agent shows no Access Denied (${new URL(fp.url()).pathname})`);
    await shot(fp, "prod-25-internal-access-denied");
    expect(bad.length === 0, bad.join("; "));
    return "6 internal URLs → /agent; /agent → الوصول مرفوض";
  });

  // M1 — phone-width pass (390 × 844) for the agent portal.
  await journey("M1", "Phone width (390px): portal dashboard, new order breakdown, order detail, statement — no horizontal scroll", async () => {
    const s = await session("phone", PERSONAS.aAdmin, { viewport: { width: 390, height: 844 } });
    const page = s.page;
    const bad = [];
    const check = async (path, name) => {
      await go(page, path);
      if (!(await noHorizontalScroll(page))) bad.push(`${path} scrolls horizontally`);
      await shot(page, name);
    };
    await check("/agent", "prod-26-mobile-dashboard");
    await go(page, "/agent/orders/new");
    await page.getByRole("radio", { name: "السعر شامل الشحن" }).check().catch(() => {});
    await pick(page, page.locator("main").getByRole("combobox", { name: /^الدولة/ }).first(), /^مصر$/, "مصر").catch(() => {});
    await pick(page, page.locator("main").getByRole("combobox", { name: /^المنتج/ }).first(), /منتج الوكيل A/).catch(() => {});
    await byLabel(page.locator("main"), /الإجمالي المتفق عليه شاملاً الشحن/).fill("1000").catch(() => {});
    await page.waitForTimeout(2500);
    if (!(await noHorizontalScroll(page))) bad.push("/agent/orders/new scrolls horizontally");
    await shot(page, "prod-27-mobile-new-order", { full: true });
    const inclOrder = ctx.refs.orderIncluded && (await orderByNumber(PERSONAS.aS1, ctx.refs.orderIncluded));
    if (inclOrder) await check(`/agent/orders/${inclOrder.id}`, "prod-28-mobile-order");
    await check("/agent/statement", "prod-29-mobile-statement");
    expect(bad.length === 0, bad.join("; "));
    return "4 pages at 390px, no horizontal scroll";
  });
}

try {
  await main();
} catch (e) {
  results.push({ id: "FATAL", title: "runner", status: "FAIL", detail: e.stack ?? String(e) });
  console.error(e);
} finally {
  await browser?.close().catch(() => {});
}
const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
console.log("\n| Journey | Result | Evidence |\n|---|---|---|");
for (const r of results) console.log(`| ${r.id} ${r.title} | ${r.status} | ${r.shots.join(", ")} |`);
console.log(`\nSummary ${JSON.stringify(counts)}`);
console.log(`Refs ${JSON.stringify(ctx.refs)}`);
for (const n of [...(ctx.notes ?? []), ...(ctx.findings ?? [])]) console.log(`Note: ${n}`);
const report = { tour: "agents-prod-browser", run: RUN, base: BASE, finishedAt: new Date().toISOString(), summary: counts, refs: ctx.refs, notes: ctx.notes ?? [], findings: ctx.findings ?? [], results };
writeFileSync(resolve(OUT, `browser-${RUN}.json`), JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, "browser-latest.json"), JSON.stringify(report, null, 2));
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
