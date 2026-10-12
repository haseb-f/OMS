#!/usr/bin/env node
/**
 * R18 B — browser journey for agent stock receipts (local integrated build only).
 *
 *   BASE=http://localhost:3001 API=http://localhost:3005 node scripts/acceptance/r18/r18-agent-stock-browser.mjs
 *
 * Admin records a custody receipt of 10 units of an agent-owned product at /agents/stock-receipts (no cost
 * field); the agent's on-hand rises by 10, no journal entry is created, the agent portal shows the
 * movement, and another agent sees neither the receipt nor the stock. The full lifecycle (reserve 3,
 * dispatch, deliver, return 1) is proven by agent-stock.integration.serial.spec.ts.
 * Demo personas of the R15 manual DB clone; password read from tmp/r15-manual/.env (never printed).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
const OUT = "specs/round18-corrections/evidence/b";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);

async function apiSession(email) {
  const { accessToken } = await (
    await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PW }),
    })
  ).json();
  return async (path) => {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
const admin = await apiSession("admin@oms-demo.local");
const agentApi = await apiSession("agent@oms-demo.local");
const agent2Api = await apiSession("agent2@oms-demo.local");

const me = (await agentApi("/agent-portal/me")).json;
const agentId = me?.agent?.id;
const agentRow = (await admin(`/agents/${agentId}`)).json;
const stockBefore = (await admin(`/agents/${agentId}/stock`)).json;
const stockRows = items(stockBefore?.items ?? stockBefore?.products ?? stockBefore);
const jeBefore = (await admin("/journal-entries?pageSize=1")).json?.total;
check("agent and its stock readable", !!agentRow && stockRows.length > 0, `${agentRow?.agentNumber} · ${stockRows.length} products`);
const target = stockRows[0];
const productId = target.productId ?? target.product?.id;
const onHandBefore = Number(target.onHand ?? 0);

const browser = await chromium.launch();
async function page(email, { locale = "ar", device = null } = {}) {
  const ctx = await browser.newContext({ ...(device ?? { viewport: { width: 1440, height: 900 } }) });
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {
      // private mode
    }
  }, locale);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.locator('input[name="email"]').fill(email);
  await p.locator('input[name="password"]').fill(PW);
  await p.locator('button[type="submit"]').click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { ctx, p };
}
const settle = async (p) => {
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.waitForTimeout(700);
};
const pick = async (p, trigger, text) => {
  await trigger.click();
  const option = text ? p.getByRole("option").filter({ hasText: text }).first() : p.getByRole("option").first();
  await option.click();
};

const reference = `R18-JOURNEY-${Date.now()}`;
{
  const { ctx, p } = await page("admin@oms-demo.local");
  await p.goto(`${BASE}/agents/stock-receipts`);
  await settle(p);
  await p.getByRole("button", { name: "استلام مخزون وكيل" }).first().click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor();
  check("receipt form has no cost / price input", (await dialog.getByLabel(/تكلفة|سعر/).count()) === 0);
  await pick(p, dialog.locator('[id$="-agent"]').first(), agentRow.agentNumber);
  await pick(p, dialog.locator('[id$="-kind"]').first(), "استلام");
  await pick(p, dialog.locator('[id$="-warehouse"]').first(), target.warehouse?.name ?? null);
  await dialog.locator('[id$="-reference"]').fill(reference);
  await pick(p, dialog.locator('[aria-label="المنتج"]').first(), target.product?.sku ?? target.sku ?? null);
  await dialog.getByLabel("الكمية").first().fill("10");
  await p.screenshot({ path: `${OUT}/1-receipt-form-ar.png` });
  await dialog.getByRole("button", { name: "تسجيل الاستلام" }).click();
  await p.getByText(/تم تسجيل السند ASR-/).first().waitFor({ timeout: 20000 });
  check("success confirmation names the receipt number", true, await p.getByText(/تم تسجيل السند ASR-/).first().innerText());
  await settle(p);
  await p.screenshot({ path: `${OUT}/2-receipts-list-ar.png` });
  await ctx.close();
}

const receipts = items((await admin(`/agent-stock-receipts?agentId=${agentId}&search=${reference}`)).json);
const receipt = receipts[0];
check("receipt stored: 10 units, agent-owned, no cost", receipt && receipt.totalQuantity === 10 && !("unitCost" in (receipt.lines?.[0] ?? {})), `${receipt?.receiptNumber} ${receipt?.lines?.[0]?.movement?.type}`);
const after = items(((await admin(`/agents/${agentId}/stock`)).json));
const row = items(after?.items ?? after?.products ?? after).find((r) => (r.productId ?? r.product?.id) === productId);
check("on-hand rises by exactly 10", Number(row?.onHand) === onHandBefore + 10, `${onHandBefore} → ${row?.onHand}`);
const jeAfter = (await admin("/journal-entries?pageSize=1")).json?.total;
check("no journal entry created (non-valued)", jeAfter === jeBefore, `${jeBefore} → ${jeAfter}`);

const own = items((await agentApi("/agent-portal/stock/movements?pageSize=50")).json);
check("agent portal shows the receipt movement", own.some((m) => JSON.stringify(m).includes(receipt?.receiptNumber ?? "∅")), `${own.length} movements`);
const other = await agent2Api("/agent-portal/stock/movements?pageSize=200");
check("another agent never sees it", !JSON.stringify(other.json ?? "").includes(receipt?.receiptNumber ?? "∅"), `status ${other.status}`);
const otherStock = await agent2Api("/agent-portal/stock");
check("another agent's stock excludes the product", !JSON.stringify(otherStock.json ?? "").includes(productId), `status ${otherStock.status}`);
const crossAdmin = await agent2Api(`/agents/${agentId}/stock-movements`);
check("agent cannot call the internal agent endpoint", [403, 404].includes(crossAdmin.status), `status ${crossAdmin.status}`);

{
  const { ctx, p } = await page("agent@oms-demo.local", { locale: "en", device: devices["iPhone 13"] });
  await p.goto(`${BASE}/agent/stock`);
  await settle(p);
  const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check("agent portal stock (en, 375 px): renders without horizontal scroll", noScroll);
  await p.screenshot({ path: `${OUT}/3-agent-portal-stock-en-mobile.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, receipt: receipt?.receiptNumber, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
