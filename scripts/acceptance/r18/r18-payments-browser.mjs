#!/usr/bin/env node
/**
 * R18 — browser journey for the partial-payment fix (local integrated build only).
 *
 *   BASE=http://localhost:3001 API=http://localhost:3005 node scripts/acceptance/r18/r18-payments-browser.mjs
 *
 * Creates a 200,000 sales invoice through the API (business operations), then in the browser:
 *  1. "Receive Payment" from the invoice, lower the allocation to 100,000 → the amount follows to 100,000,
 *     Confirm posts 100,000 (no warning) → invoice 100,000 outstanding, PARTIALLY_PAID.
 *  2. A new receipt typed at 200,000 with 100,000 allocated → Confirm shows the unapplied warning
 *     (Arabic) → Back leaves nothing posted.
 *  3. English + 375 px mobile: the same warning in English; the editor has no horizontal scroll.
 * Demo personas of the R15 manual DB clone; password read from tmp/r15-manual/.env (never printed).
 * Evidence: specs/round18-corrections/evidence/a/ (screenshots + results.json).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
const OUT = "specs/round18-corrections/evidence/a";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync("tmp/r15-manual/.env", "utf8").match(/MANUAL_PW=(.*)/)[1].trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
};

const { accessToken } = await (
  await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  })
).json();
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);

// A customer and a sellable service product of the demo data.
const customers = items(await call("GET", "/partners/catalog?role=CUSTOMER&pageSize=20"));
const customer = customers[0];
const products = items(await call("GET", "/products?pageSize=100"));
const product =
  products.find((p) => p.type === "SERVICE" && p.isSellable && !p.ownerAgentId && p.status === "ACTIVE") ??
  products.find((p) => p.isSellable && !p.ownerAgentId && p.status === "ACTIVE" && !p.isInventoryItem);
if (!customer || !product) throw new Error("demo data: no customer or sellable non-stock product");
const warehouses = items(await call("GET", "/warehouses?pageSize=50"));
const warehouse = warehouses.find((w) => w.isDefault && w.isActive) ?? warehouses.find((w) => w.isActive);
const invoice = await call("POST", "/sales/invoices", {
  partnerId: customer.id,
  referenceNumber: `R18-${Date.now()}`,
  items: [{ productId: product.id, unitId: product.unitId ?? product.unit?.id, quantity: 1, unitPrice: 200000, warehouseId: warehouse?.id }],
});
const confirmedInvoice = await call("POST", `/sales/invoices/${invoice.id}/confirm`);
check("invoice 200,000 confirmed", Number(confirmedInvoice.grandTotal) === 200000, `${confirmedInvoice.invoiceNumber} ${confirmedInvoice.grandTotal}`);

const browser = await chromium.launch();
async function session({ locale = "ar", device = null } = {}) {
  const ctx = await browser.newContext({ ...(device ?? { viewport: { width: 1440, height: 900 } }) });
  await ctx.addInitScript((value) => {
    try {
      localStorage.setItem("oms.locale", JSON.stringify(value));
    } catch {
      // private mode
    }
  }, locale);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { ctx, page };
}
const settle = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
};
const amountInput = (page) => page.locator('input[id$="-amount"]').first();
async function pickReceivingAccount(page) {
  await page.locator('[data-field-name="receivingAccount"] button, [data-field-name="receivingAccount"] [role="combobox"]').first().click();
  await page.getByRole("option").first().click();
}
const confirmButton = (page, locale) =>
  page.getByRole("button", { name: locale === "ar" ? "تأكيد" : "Confirm", exact: true }).first();

// 1 — Receive Payment from the invoice; lower the allocation → amount follows.
{
  const { ctx, page } = await session();
  await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${invoice.id}`);
  await settle(page);
  await page.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  check("prefill proposes the invoice balance", Number(await amountInput(page).inputValue()) === 200000, await amountInput(page).inputValue());
  const line = page.locator('[data-testid="allocation-line"] input[type="number"]').first();
  await line.fill("100000");
  await line.blur();
  await page.waitForTimeout(300);
  check("lowering the allocation lowers the amount (100,000)", Number(await amountInput(page).inputValue()) === 100000, await amountInput(page).inputValue());
  await pickReceivingAccount(page);
  await page.screenshot({ path: `${OUT}/1-receive-payment-ar.png` });
  await confirmButton(page, "ar").click();
  const dialogShown = await page.getByRole("alertdialog").isVisible().catch(() => false);
  check("fully applied: no unapplied warning", !dialogShown);
  await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 });
  const receiptId = new URL(page.url()).pathname.split("/").pop();
  const receipt = await call("GET", `/financial-transactions/receipts/${receiptId}`);
  check("receipt posted 100,000, allocated 100,000", Number(receipt.amount) === 100000 && receipt.status === "CONFIRMED" && Number(receipt.allocations[0]?.allocatedAmount) === 100000, `${receipt.transactionNumber} ${receipt.amount}`);
  await page.reload();
  await settle(page);
  await page.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  const lineText = (await page.locator('[data-testid="allocation-line"]').first().innerText()).replace(/\s+/g, " ");
  check(
    "saved partial receipt: line not marked fully paid, remaining before = 200,000",
    !lineText.includes("مدفوعة بالكامل") && /200,000/.test(lineText),
    lineText,
  );
  await page.screenshot({ path: `${OUT}/1b-saved-receipt-ar.png` });
  const after = await call("GET", `/sales/invoices/${invoice.id}`);
  check("invoice 200,000 / allocated 100,000 / outstanding 100,000 / PARTIALLY_PAID", Number(after.allocatedTotal) === 100000 && Number(after.remainingBalance) === 100000 && after.paymentStatus === "PARTIALLY_PAID", `${after.allocatedTotal} / ${after.remainingBalance} / ${after.paymentStatus}`);
  await ctx.close();
}

// 2 — typed 200,000 with 100,000 applied → warning; Back posts nothing.
async function unappliedWarning({ locale, device, shotName }) {
  const before = items(await call("GET", `/financial-transactions/receipts?partnerId=${customer.id}&pageSize=100`)).length;
  const { ctx, page } = await session({ locale, device });
  await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}`);
  await settle(page);
  await amountInput(page).fill("200000");
  const row = page.getByRole("row").filter({ hasText: confirmedInvoice.invoiceNumber }).first();
  await row.getByRole("button").last().click();
  await page.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  await pickReceivingAccount(page);
  await confirmButton(page, locale).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10000 }).catch(() => {});
  const text = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ");
  const title = locale === "ar" ? "جزء من المبلغ غير مخصص لفاتورة" : "Part of the amount is not applied to an invoice";
  check(`${locale}${device ? " mobile" : ""}: unapplied warning before posting`, text.includes(title) && /100,000/.test(text), text.slice(0, 160));
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`${locale}${device ? " mobile" : ""}: no horizontal scroll`, noScroll);
  await page.screenshot({ path: `${OUT}/${shotName}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const afterCount = items(await call("GET", `/financial-transactions/receipts?partnerId=${customer.id}&pageSize=100`)).length;
  check(`${locale}${device ? " mobile" : ""}: going back posts nothing`, afterCount === before, `${before} → ${afterCount}`);
  await ctx.close();
}
await unappliedWarning({ locale: "ar", device: null, shotName: "2-unapplied-warning-ar" });
await unappliedWarning({ locale: "en", device: devices["iPhone 13"], shotName: "3-unapplied-warning-en-mobile" });

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, invoice: confirmedInvoice.invoiceNumber, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
