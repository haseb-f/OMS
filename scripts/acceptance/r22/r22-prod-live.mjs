#!/usr/bin/env node
/**
 * R22 — read-only live check of the deployed settlement UI + API (never saves, never confirms).
 *   node scripts/acceptance/r22/r22-prod-live.mjs
 * QA admin, password from tmp/.qa.env QA_PASSWORD (never printed). Screens: specs/round22-settlement/evidence/prod/live/.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
const BASE = "https://oms.haseb.org";
const API = `${BASE}/api`;
const OUT = "specs/round22-settlement/evidence/prod/live";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
let pass = 0, fail = 0;
const note = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${String(JSON.stringify(detail)).slice(0, 220)}`); };
const { accessToken } = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: PW }) })).json();
const get = async (p) => { const r = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${accessToken}` } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);

// API contract
const inv = await get("/sales/invoices?search=INV-2026-000093&pageSize=5");
const i93 = items(inv.body).find((x) => x.invoiceNumber === "INV-2026-000093");
note("API: sales invoice list carries paid / credited / remaining / status", i93 && "paidTotal" in i93 && "creditedTotal" in i93 && "remainingBalance" in i93, i93 && { paid: i93.paidTotal, credited: i93.creditedTotal, remaining: i93.remainingBalance, status: i93.paymentStatus });
if (i93) { const s = await get(`/sales/invoices/${i93.id}/settlement`); note("API: settlement history endpoint 200", s.status === 200 && Array.isArray(s.body?.entries), { entries: s.body?.entries?.length, summary: s.body?.summary }); }
const sort = await get("/sales/invoices?sortBy=partnerName&pageSize=1"); note("API: unknown/party sort never 500", sort.status !== 500, sort.status);
const bad = await get("/sales/invoices?sortBy=__nope&pageSize=1"); note("API: unknown sort → 400", bad.status === 400, bad.status);
const ca = await get("/financial-transactions/counter-accounts?direction=IN"); note("API: counter-account allow-list 200", ca.status === 200, { n: items(ca.body).length });
for (const p of ["other-receipts", "other-payments", "transfers"]) { const r = await get(`/financial-transactions/${p}?pageSize=1`); note(`API: ${p} list 200`, r.status === 200, r.status); }
const aging = await get("/accounting/reports/aging?side=AR").catch(() => null);
if (aging?.status === 200) note("API: aging totals per currency", Array.isArray(aging.body?.totalsByCurrency), aging.body?.totalsByCurrency?.map((t) => t.currencyCode ?? t.currency));

// UI
const browser = await chromium.launch();
for (const [w, h, tag] of [[1440, 900, "1440"], [375, 812, "375"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, locale: "ar" });
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
  await page.locator('input[name="password"]').fill(PW);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // new receipt card — never saved
  await page.goto(`${BASE}/sales/payments/new`); await page.waitForLoadState("networkidle");
  const amount = page.getByLabel(/المبلغ المقبوض/).first();
  note(`${tag}: receipt card amount field «المبلغ المقبوض»`, await amount.count() > 0);
  if (await amount.count()) {
    const attrs = await amount.evaluate((el) => ({ type: el.getAttribute("type"), mode: el.getAttribute("inputmode"), value: el.value, ph: el.getAttribute("placeholder"), h: el.getBoundingClientRect().height }));
    note(`${tag}: amount text/decimal, empty, placeholder «أدخل المبلغ»`, attrs.type === "text" && attrs.mode === "decimal" && attrs.value === "" && /أدخل المبلغ/.test(attrs.ph ?? ""), attrs);
    await amount.fill("٠٫٥"); await amount.blur();
    note(`${tag}: Arabic digits «٠٫٥» accepted`, /0\.5|٠٫٥/.test(await amount.inputValue()), await amount.inputValue());
  }
  note(`${tag}: receipt card no horizontal scroll`, await noScroll());
  await page.screenshot({ path: `${OUT}/receipt-new-${tag}.png` });
  // invoice list + detail
  await page.goto(`${BASE}/sales/invoices`); await page.waitForLoadState("networkidle");
  const headers = (await page.locator("table thead th").allInnerTexts()).join("|");
  if (tag === "1440") note("1440: invoice list shows paid + remaining columns", /المدفوع/.test(headers) && /المتبقي/.test(headers), headers.slice(0, 200));
  note(`${tag}: invoice list no horizontal scroll`, await noScroll());
  await page.screenshot({ path: `${OUT}/invoices-${tag}.png` });
  if (i93) {
    await page.goto(`${BASE}/sales/invoices/${i93.id}`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(1000);
    const text = await page.locator("main").innerText();
    note(`${tag}: invoice detail «حالة السداد» summary`, /حالة السداد/.test(text));
    note(`${tag}: invoice detail no horizontal scroll`, await noScroll());
    await page.screenshot({ path: `${OUT}/invoice-93-${tag}.png`, fullPage: true });
  }
  await page.goto(`${BASE}/purchasing/payments`); await page.waitForLoadState("networkidle");
  note(`${tag}: supplier payments tabs (other payments, transfers)`, (await page.getByRole("tab", { name: "تحويلات بين الحسابات" }).count()) > 0);
  await page.close();
}
await browser.close();
console.log(`\n${pass}/${pass + fail} passed`);
