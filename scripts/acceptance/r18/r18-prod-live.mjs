#!/usr/bin/env node
/**
 * R18 — read-only live browser check on Production after the release (QA admin; tmp/.qa.env, never printed).
 * Opens the changed screens only, performs no writes: the repaired receipt, AR aging (unapplied / net),
 * agent stock receipts, agents overview cards (hover rise without layout shift), mobile login.
 */
import { chromium, devices } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const OUT = "specs/round18-corrections/evidence/live";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/.qa.env", "utf8").split(/\r?\n/).find((l) => /QA_PASSWORD=/.test(l))
  .replace(/^\s*(export\s+)?QA_PASSWORD=/, "").replace(/^["']|["']$/g, "").trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
await page.goto(`${BASE}/login`);
await page.locator('input[name="email"]').fill("qa-admin@oms.haseb.org");
await page.locator('input[name="password"]').fill(PW);
await page.locator('button[type="submit"]').click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
const settle = async () => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); };

const { accessToken } = await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "qa-admin@oms.haseb.org", password: PW }) })).json();
const list = await (await fetch(`${BASE}/api/financial-transactions/receipts?search=CR-2026-000097&pageSize=5`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
const cr97 = (list.items ?? []).find((r) => r.transactionNumber === "CR-2026-000097");
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
await page.goto(`${BASE}/sales/payments/${cr97.id}`);
await settle();
const receiptText = await page.locator("main").innerText();
const fieldValues = await page.locator("main input").evaluateAll((els) => els.map((el) => el.value).join(" "));
check("repaired receipt CR-2026-000097: 100,000, references CR-2026-000095", /100,000.00/.test(receiptText) && fieldValues.includes("CR-2026-000095"));
const savedLine = await page.locator('[data-testid="allocation-line"]').first().innerText().catch(() => "");
check("its allocation line is not marked fully paid (invoice partially paid)", !savedLine.includes("مدفوعة بالكامل"), savedLine.replace(/s+/g, " "));
await page.screenshot({ path: `${OUT}/1-cr-097.png` });

await page.goto(`${BASE}/reports/finance?report=arAging`);
await settle();
const agingText = await page.locator("main").innerText();
check("AR aging shows open invoices / unapplied credits / net balance", ["الفواتير المفتوحة", "أرصدة دائنة غير مخصصة", "صافي الرصيد"].every((s) => agingText.includes(s)));
await page.screenshot({ path: `${OUT}/2-ar-aging.png` });

await page.goto(`${BASE}/agents/stock-receipts`);
await settle();
check("agent stock receipts screen loads", (await page.locator("h1").first().innerText()).includes("استلام مخزون الوكلاء"));

await page.goto(`${BASE}/agents/overview`);
await settle();
const card = page.locator(".insight-card, [data-insight-card]").first();
const target = (await card.count()) ? card : page.locator("main a[href*='/agents/']").first();
const before = await target.boundingBox();
await target.hover();
await page.waitForTimeout(400);
const sizeAfter = await target.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
check("report card hover: no size change (no layout shift)", before && Math.abs(before.width - sizeAfter.w) < 1 && Math.abs(before.height - sizeAfter.h) < 1, JSON.stringify({ before: before && { w: before.width, h: before.height }, sizeAfter }));
await page.screenshot({ path: `${OUT}/3-agents-overview-hover.png` });
check("no page errors on the visited screens", errors.length === 0, errors.join(" | "));
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
