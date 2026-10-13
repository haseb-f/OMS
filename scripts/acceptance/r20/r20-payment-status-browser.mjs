#!/usr/bin/env node
/**
 * R20 C — browser journey: invoice payment status + receipt allocation (local preview only).
 *
 *   PHASE=after BASE=http://localhost:4821 API=http://localhost:4825 node scripts/acceptance/r20/r20-payment-status-browser.mjs
 *
 * Business operations through the API set up the invoices (create + confirm); the receipts are entered in
 * the browser as a user would:
 *  1. Invoice 200,000 → "Receive Payment" from its screen (invoice preselected) → allocation lowered to
 *     100,000 → Confirm. Invoice list (table + grid card) and detail read Partially paid / 100,000 outstanding.
 *  2. Second receipt 100,000 from the invoice → Fully paid.
 *  3. One receipt over two invoices (50,000 + 30,000, amount 60,000) → paid + partially paid.
 *  4. Receipt with no invoice while invoices are open → explicit "unapplied advance" confirmation; no
 *     invoice changes; the customer profile shows it apart (applied / unapplied).
 *  5. Cancel the second receipt → the invoice is Partially paid again.
 *  6. English + 375 px: invoice grid, receipt editor open invoices; no horizontal scroll.
 * Demo personas of the R20 C clone (oms_r20_c); password from tmp/r15-manual/.env (never printed).
 * Evidence: specs/round20-corrections/evidence/c/<PHASE>/ (screenshots + results.json).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PHASE = process.env.PHASE ?? "after";
const BASE = (process.env.BASE ?? "http://localhost:4821").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4825").replace(/\/$/, "");
const OUT = `specs/round20-corrections/evidence/c/${PHASE}`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${String(detail).slice(0, 200)}`);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    check(`${name} (step error)`, false, error?.message ?? error);
  }
};

const { accessToken } = await (
  await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  })
).json();
if (!accessToken) throw new Error("API login failed");
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

// A fresh demo customer per run (so earlier runs' advances never mix in) and a sellable non-stock product.
const stamp = Date.now().toString(36).toUpperCase();
const customer = await call("POST", "/partners", {
  name: `عميل R20 ${stamp}`,
  roles: ["CUSTOMER"],
}).catch(async () => items(await call("GET", "/partners/catalog?role=CUSTOMER&pageSize=20"))[0]);
const products = items(await call("GET", "/products?pageSize=100"));
const product =
  products.find((p) => p.type === "SERVICE" && p.isSellable && !p.ownerAgentId && p.status === "ACTIVE") ??
  products.find((p) => p.isSellable && !p.ownerAgentId && p.status === "ACTIVE" && !p.isInventoryItem);
if (!customer || !product) throw new Error("demo data: no customer or sellable non-stock product");
const warehouses = items(await call("GET", "/warehouses?pageSize=50"));
const warehouse = warehouses.find((w) => w.isDefault && w.isActive) ?? warehouses.find((w) => w.isActive);
async function confirmedInvoice(total, ref) {
  const invoice = await call("POST", "/sales/invoices", {
    partnerId: customer.id,
    referenceNumber: `R20C-${ref}-${stamp}`,
    items: [
      {
        productId: product.id,
        unitId: product.unitId ?? product.unit?.id,
        quantity: 1,
        unitPrice: total,
        warehouseId: warehouse?.id,
      },
    ],
  });
  return call("POST", `/sales/invoices/${invoice.id}/confirm`);
}
const invoiceA = await confirmedInvoice(200000, "A");
const invoiceB = await confirmedInvoice(50000, "B");
const invoiceC = await confirmedInvoice(30000, "C");
check(
  "setup: invoices 200,000 / 50,000 / 30,000 confirmed",
  [invoiceA, invoiceB, invoiceC].every((i) => i.status === "CONFIRMED"),
  [invoiceA, invoiceB, invoiceC].map((i) => `${i.invoiceNumber} ${i.grandTotal}`).join(", "),
);
const invoiceState = async (invoice) => {
  const row = await call("GET", `/sales/invoices/${invoice.id}`);
  return { paid: Number(row.allocatedTotal), remaining: Number(row.remainingBalance), status: row.paymentStatus };
};

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
  await page.waitForTimeout(800);
};
const amountInput = (page) => page.locator('input[id$="-amount"]').first();
async function ensureReceivingAccount(page) {
  const field = page.locator('[data-field-name="receivingAccount"]').first();
  const text = (await field.innerText().catch(() => "")).trim();
  if (text && !/اختر|Select/.test(text)) return;
  await field.locator('button, [role="combobox"]').first().click();
  await page.getByRole("option").first().click();
}
const confirmButton = (page, locale) =>
  page.getByRole("button", { name: locale === "ar" ? "تأكيد" : "Confirm", exact: true }).first();
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function confirmAndWait(page, locale) {
  await confirmButton(page, locale).click();
  const dialog = page.getByRole("alertdialog");
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog.getByRole("button").last().click();
  }
  await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 });
  return new URL(page.url()).pathname.split("/").pop();
}
async function receiveFromInvoice(page, invoice, lineAmount, shot) {
  await page.goto(`${BASE}/sales/invoices/${invoice.id}`);
  await settle(page);
  const receive = page.getByRole("button", { name: "استلام دفعة" }).first();
  if (await receive.isVisible().catch(() => false)) {
    await receive.click();
  } else {
    await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${invoice.id}`);
  }
  await page.waitForURL((u) => u.pathname.startsWith("/sales/payments/new"), { timeout: 20000 });
  await settle(page);
  await page.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  if (lineAmount !== null) {
    const line = page.locator('[data-testid="allocation-line"] input[type="number"]').first();
    await line.fill(String(lineAmount));
    await line.blur();
    await page.waitForTimeout(400);
  }
  await ensureReceivingAccount(page);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  return confirmAndWait(page, "ar");
}

let secondReceiptId = null;
const { ctx, page } = await session();

await step("1 receive 100,000 from the invoice screen", async () => {
  const receiptId = await receiveFromInvoice(page, invoiceA, 100000, "1-receive-from-invoice-ar");
  const receipt = await call("GET", `/financial-transactions/receipts/${receiptId}`);
  check(
    "1 receipt posted 100,000 → invoice A preselected and allocated 100,000",
    Number(receipt.amount) === 100000 && receipt.allocations[0]?.salesInvoiceId === invoiceA.id,
    `${receipt.transactionNumber} ${receipt.amount}`,
  );
  const state = await invoiceState(invoiceA);
  check(
    "1 API: 200,000 / paid 100,000 / outstanding 100,000 / PARTIALLY_PAID",
    state.paid === 100000 && state.remaining === 100000 && state.status === "PARTIALLY_PAID",
    JSON.stringify(state),
  );
});

await step("1 invoice list, grid and detail", async () => {
  await page.goto(`${BASE}/sales/invoices`);
  await settle(page);
  await page.getByRole("searchbox").first().fill(invoiceA.invoiceNumber);
  await page.waitForTimeout(1200);
  await settle(page);
  const row = page.getByRole("row").filter({ hasText: invoiceA.invoiceNumber }).first();
  const rowText = (await row.innerText()).replace(/\s+/g, " ");
  check("1 list row: مدفوعة جزئياً", /مدفوعة جزئي/.test(rowText), rowText);
  check("1 list row shows the 100,000 outstanding", /100,000/.test(rowText.replace(/200,000/, "")), rowText);
  await page.screenshot({ path: `${OUT}/1-invoice-list-table-ar.png` });
  await page.locator('[data-view-toggle] [data-view="grid"]').first().click();
  await settle(page);
  const card = page.locator("[data-record-card]").filter({ hasText: invoiceA.invoiceNumber }).first();
  const tone = await card.getAttribute("data-tone");
  const cardText = (await card.innerText()).replace(/\s+/g, " ");
  check("1 grid card: partially paid badge + 100,000 remaining", /مدفوعة جزئي/.test(cardText) && /100,000/.test(cardText), cardText);
  check("1 grid card surface = payment status (warning), not 'confirmed' green", tone === "warning", tone);
  await page.screenshot({ path: `${OUT}/1-invoice-list-grid-ar.png` });
  await page.locator('[data-view-toggle] [data-view="table"]').first().click();
  await page.goto(`${BASE}/sales/invoices/${invoiceA.id}`);
  await settle(page);
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("1 detail: partially paid, paid 100,000, remaining 100,000", /مدفوعة جزئي/.test(body) && /100,000/.test(body), "");
  await page.screenshot({ path: `${OUT}/1-invoice-detail-ar.png`, fullPage: true });
});

await step("2 second receipt 100,000 → fully paid", async () => {
  secondReceiptId = await receiveFromInvoice(page, invoiceA, null, "2-second-receipt-ar");
  const state = await invoiceState(invoiceA);
  check("2 API: paid 200,000 / outstanding 0 / PAID", state.paid === 200000 && state.remaining === 0 && state.status === "PAID", JSON.stringify(state));
  await page.goto(`${BASE}/sales/invoices/${invoiceA.id}`);
  await settle(page);
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("2 detail: مدفوعة بالكامل", /مدفوعة بالكامل/.test(body), "");
  await page.screenshot({ path: `${OUT}/2-invoice-paid-ar.png`, fullPage: true });
});

await step("3 one receipt over two invoices", async () => {
  await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}`);
  await settle(page);
  await amountInput(page).fill("60000");
  for (const invoice of [invoiceB, invoiceC]) {
    const row = page.locator('[data-testid="open-invoice"]').filter({ hasText: invoice.invoiceNumber }).first();
    const target = (await row.count()) ? row : page.getByRole("row").filter({ hasText: invoice.invoiceNumber }).first();
    await target.getByRole("button").last().click();
    await page.waitForTimeout(400);
  }
  await ensureReceivingAccount(page);
  const openText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("3 open invoices show paid before + this voucher columns", /المدفوع سابق/.test(openText) && /تخصيص هذا السند/.test(openText), "");
  await page.screenshot({ path: `${OUT}/3-one-receipt-two-invoices-ar.png`, fullPage: true });
  await confirmAndWait(page, "ar");
  const b = await invoiceState(invoiceB);
  const c = await invoiceState(invoiceC);
  check("3 B paid 50,000 (PAID), C paid 10,000 (PARTIALLY_PAID, 20,000 left)", b.status === "PAID" && c.paid === 10000 && c.remaining === 20000 && c.status === "PARTIALLY_PAID", `${JSON.stringify(b)} ${JSON.stringify(c)}`);
});

await step("4 receipt with no invoice → explicit unapplied advance", async () => {
  const before = await invoiceState(invoiceC);
  await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}`);
  await settle(page);
  await amountInput(page).fill("5000");
  await ensureReceivingAccount(page);
  await confirmButton(page, "ar").click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10000 });
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  check("4 dialog names the amount an unapplied advance, no invoice selected", /لم تُحدَّد أي فاتورة/.test(text) && /دفعة مقدمة/.test(text) && /5,000/.test(text), text.slice(0, 220));
  await page.screenshot({ path: `${OUT}/4-no-invoice-advance-dialog-ar.png` });
  await dialog.getByRole("button").last().click();
  await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 });
  const after = await invoiceState(invoiceC);
  check("4 no invoice changed by the advance", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
  const position = await call("GET", `/financial-transactions/receipts/position?partnerId=${customer.id}`).catch(() => null);
  check(
    "4 API position: received 265,000 = applied 260,000 + unapplied 5,000; owed 20,000",
    position?.[0]?.received === 265000 && position?.[0]?.applied === 260000 && position?.[0]?.unapplied === 5000 && position?.[0]?.outstanding === 20000,
    JSON.stringify(position),
  );
  await page.goto(`${BASE}/sales/customers/${customer.id}`);
  await settle(page);
  const paymentsTab = page.getByRole("tab", { name: /المدفوعات|الدفعات/ }).first();
  if (await paymentsTab.isVisible().catch(() => false)) await paymentsTab.click();
  await settle(page);
  const profile = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("4 profile shows unapplied advance 5,000 apart from applied", /دفعة مقدمة غير مخصصة/.test(profile) && /5,000/.test(profile), "");
  await page.screenshot({ path: `${OUT}/4-customer-profile-position-ar.png`, fullPage: true });
});

await step("5 cancel the second receipt → status reverts", async () => {
  if (!secondReceiptId) throw new Error("no second receipt");
  await page.goto(`${BASE}/sales/payments/${secondReceiptId}`);
  await settle(page);
  const direct = page.getByRole("button", { name: "إلغاء", exact: true }).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    await page.locator('[data-testid="header-actions-more"]').first().click();
    await page.getByRole("menuitem", { name: "إلغاء", exact: true }).first().click();
  }
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole("button").last().click();
  await page.waitForTimeout(2000);
  await settle(page);
  const state = await invoiceState(invoiceA);
  check("5 API: after cancel → paid 100,000 / PARTIALLY_PAID", state.paid === 100000 && state.status === "PARTIALLY_PAID", JSON.stringify(state));
  await page.goto(`${BASE}/sales/invoices/${invoiceA.id}`);
  await settle(page);
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check("5 detail: مدفوعة جزئياً again", /مدفوعة جزئي/.test(body), "");
  await page.screenshot({ path: `${OUT}/5-after-cancel-ar.png`, fullPage: true });
});
await ctx.close();

await step("6 English + 375 px", async () => {
  const mobile = await session({ locale: "en", device: devices["iPhone 13"] });
  const p = mobile.page;
  await p.goto(`${BASE}/sales/invoices`);
  await settle(p);
  await p.getByRole("searchbox").first().fill(invoiceA.invoiceNumber);
  await p.waitForTimeout(1200);
  await settle(p);
  const grid = p.locator('[data-view-toggle] [data-view="grid"]').first();
  if (await grid.isVisible().catch(() => false)) await grid.click();
  await settle(p);
  const card = p.locator("[data-record-card]").filter({ hasText: invoiceA.invoiceNumber }).first();
  const text = (await card.innerText().catch(() => "")).replace(/\s+/g, " ");
  check("6 en mobile card: Partially Paid + 100,000", /Partially Paid/.test(text) && /100,000/.test(text), text);
  check("6 en mobile invoice list: no horizontal scroll", await noHorizontalScroll(p));
  await p.screenshot({ path: `${OUT}/6-invoice-grid-en-375.png`, fullPage: true });
  await p.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${invoiceC.id}`);
  await settle(p);
  await p.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  const editor = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  check("6 en mobile receipt editor: paid before / this voucher on the open invoice", /Paid before/.test(editor) && /This voucher/.test(editor), "");
  check("6 en mobile receipt editor: no horizontal scroll", await noHorizontalScroll(p));
  await p.screenshot({ path: `${OUT}/6-receipt-editor-en-375.png`, fullPage: true });
  await mobile.ctx.close();
  const wide = await session({ locale: "en" });
  await wide.page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${invoiceC.id}`);
  await settle(wide.page);
  await wide.page.locator('[data-testid="allocation-line"]').first().waitFor({ timeout: 20000 });
  check("6 en 1440 receipt editor: no horizontal scroll", await noHorizontalScroll(wide.page));
  await wide.page.screenshot({ path: `${OUT}/6-receipt-editor-en-1440.png`, fullPage: true });
  await wide.ctx.close();
});

await browser.close();
writeFileSync(
  `${OUT}/results.json`,
  JSON.stringify(
    {
      phase: PHASE,
      base: BASE,
      customer: customer.name,
      invoices: [invoiceA, invoiceB, invoiceC].map((i) => i.invoiceNumber),
      results,
    },
    null,
    2,
  ),
);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
