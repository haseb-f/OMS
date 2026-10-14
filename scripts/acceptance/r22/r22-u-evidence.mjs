#!/usr/bin/env node
/**
 * R22 stream U — screenshot evidence of the voucher card, amount field, invoice
 * list / detail and RTL table alignment (local build only, never Production).
 *
 *   BASE=http://localhost:4931 API=http://localhost:4935 node scripts/acceptance/r22/r22-u-evidence.mjs
 *
 * Creates its own demo partners / invoices (DB oms_r22_ui). Password from
 * tmp/r15-manual/.env MANUAL_PW (never printed). Output: specs/round22-settlement/evidence/u/after/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4931").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4935").replace(/\/$/, "");
if (/haseb|vercel/i.test(BASE + API)) throw new Error("local builds only");
const OUT = process.env.OUT ?? "specs/round22-settlement/evidence/u/after";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";

const log = [];
const note = (name, ok, detail = "") => {
  log.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 200)}`);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    note(`${name} (step error)`, false, String(error?.message ?? error).slice(0, 300));
  }
};

// ------------------------------------------------------------------ API setup
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
const stamp = Date.now().toString(36).toUpperCase();
const customer = await call("POST", "/partners", { name: `عميل R22U ${stamp}`, roles: ["CUSTOMER"] });
const supplier = await call("POST", "/partners", { name: `مورد R22U ${stamp}`, roles: ["SUPPLIER"] });
const products = items(await call("GET", "/products?pageSize=100"));
const active = (p) => p.status === "ACTIVE" && !p.ownerAgentId && !p.isInventoryItem;
const sellable = products.find((p) => active(p) && p.isSellable);
const purchasable = products.find((p) => active(p) && p.isPurchasable) ?? sellable;
const warehouses = items(await call("GET", "/warehouses?pageSize=50"));
const warehouse = warehouses.find((w) => w.isDefault && w.isActive) ?? warehouses.find((w) => w.isActive);
const line = (product, total) => ({
  productId: product.id,
  unitId: product.unitId ?? product.unit?.id,
  quantity: 1,
  unitPrice: total,
  warehouseId: warehouse?.id,
});
const salesInvoice = await call("POST", "/sales/invoices", {
  partnerId: customer.id,
  referenceNumber: `R22U-S-${stamp}`,
  items: [line(sellable, 200000)],
}).then((i) => call("POST", `/sales/invoices/${i.id}/confirm`));
const salesInvoice2 = await call("POST", "/sales/invoices", {
  partnerId: customer.id,
  referenceNumber: `R22U-S2-${stamp}`,
  items: [line(sellable, 35000)],
}).then((i) => call("POST", `/sales/invoices/${i.id}/confirm`));
let purchaseInvoice = null;
await step("setup purchase invoice", async () => {
  const draft = await call("POST", "/purchasing/invoices", {
    partnerId: supplier.id,
    referenceNumber: `R22U-P-${stamp}`,
    items: [{ ...line(purchasable, 200000), unitCost: 200000 }],
  });
  purchaseInvoice = await call("POST", `/purchasing/invoices/${draft.id}/confirm`).catch(async () => {
    await call("POST", `/purchasing/invoices/${draft.id}/submit`).catch(() => null);
    await call("POST", `/purchasing/invoices/${draft.id}/approve`).catch(() => null);
    return call("POST", `/purchasing/invoices/${draft.id}/confirm`);
  });
});

// ------------------------------------------------------------------ browser
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
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = (page, name, fullPage = true) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage }).catch(() => {});
const amount = (page) => page.locator('[data-field-name="amount"] input').first();
const choosePurpose = async (page, label) => {
  await page.getByLabel(/نوع الحركة|Type/).first().click();
  await page.getByRole("option", { name: label }).click();
  await page.waitForTimeout(400);
};

let receiptId = null;
for (const locale of ["ar", "en"]) {
  const { ctx, page } = await session({ locale });
  const L = (ar, en) => (locale === "ar" ? ar : en);

  await step(`voucher card ${locale}`, async () => {
    await page.goto(`${BASE}/sales/payments/new`);
    await settle(page, 1300);
    await shot(page, `V1-receipt-new-settle-${locale}-1440`);
    // Amount field states.
    await amount(page).hover();
    await page.waitForTimeout(300);
    await shot(page, `A1-amount-hover-${locale}-1440`, false);
    await amount(page).click();
    await page.keyboard.type("١٢٣٤٫٥");
    await page.waitForTimeout(200);
    await shot(page, `A2-amount-typing-arabic-digits-${locale}-1440`, false);
    note(`${locale}: Arabic-Indic digits kept while typing`, (await amount(page).inputValue()) === "١٢٣٤٫٥");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    note(`${locale}: canonical figure after blur`, (await amount(page).inputValue()) === "1234.5");
    await page.getByRole("button", { name: L("تأكيد", "Confirm"), exact: true }).first().click();
    await page.waitForTimeout(600);
    await shot(page, `A3-amount-validation-${locale}-1440`, false);
    // Purposes.
    await choosePurpose(page, L("مقبوضات أخرى بحساب مقابل", "Other receipt (counter-account)"));
    await shot(page, `V2-receipt-other-${locale}-1440`);
    note(`${locale}: other receipt hides the party`, !(await page.locator('[data-field-name="party"]').count()));
    await choosePurpose(page, L("تحويل داخلي بين الحسابات", "Internal transfer between accounts"));
    await shot(page, `V3-transfer-${locale}-1440`);
    await page.goto(`${BASE}/purchasing/payments/new`);
    await settle(page, 1300);
    await shot(page, `V4-payment-new-${locale}-1440`);
    note(
      `${locale}: payment card has no «حساب الاستلام»`,
      !(await page.getByText("حساب الاستلام", { exact: true }).count()),
    );
  });

  await step(`receipt from invoice ${locale}`, async () => {
    await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${salesInvoice.id}`);
    await settle(page, 1800);
    const allocation = page.locator('[data-testid="allocation-line"] input').first();
    await allocation.fill("100000");
    await allocation.blur();
    await page.waitForTimeout(400);
    await shot(page, `V5-receipt-settle-allocation-${locale}-1440`);
    note(`${locale}: amount follows the allocation`, (await amount(page).inputValue()) === "100000");
    await page.getByRole("button", { name: L("تأكيد", "Confirm"), exact: true }).first().click();
    const dialog = page.getByRole("alertdialog");
    await dialog.waitFor({ timeout: 5000 });
    await shot(page, `V6-review-dialog-${locale}-1440`, false);
    note(`${locale}: review names the account and invoice`, /INV-/.test(await dialog.innerText()));
    if (locale === "ar") {
      await dialog.getByRole("button").last().click();
      await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 30000 });
      receiptId = new URL(page.url()).pathname.split("/").pop();
      await settle(page, 1500);
      await shot(page, `V7-receipt-confirmed-${locale}-1440`);
    } else {
      await dialog.getByRole("button").first().click();
    }
  });

  if (locale === "ar") {
    await step("other receipt + transfer through the card (stream T endpoints)", async () => {
      const counter = items(await call("GET", "/financial-transactions/counter-accounts?direction=IN"));
      note("counter-accounts allow-list (IN) returns accounts", counter.length > 0, counter.length);
      await page.goto(`${BASE}/sales/payments/new`);
      await settle(page, 1300);
      await choosePurpose(page, "مقبوضات أخرى بحساب مقابل");
      await page.getByLabel(/الحساب المقابل/).first().click();
      await page.getByRole("option").first().click();
      await amount(page).fill("2500");
      await page.getByRole("button", { name: "تأكيد", exact: true }).first().click();
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor({ timeout: 5000 });
      await shot(page, "V8-other-receipt-review-ar-1440", false);
      await dialog.getByRole("button").last().click();
      await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}/.test(u.pathname) && u.search.includes("purpose=other"), { timeout: 30000 });
      await settle(page, 1500);
      await shot(page, "V9-other-receipt-confirmed-ar-1440");
      note("other receipt confirmed through other-receipts", /OR-/.test(await page.evaluate(() => document.body.innerText)));

      const accounts = items(await call("GET", "/receiving-accounts?pageSize=100")).filter((a) => a.isActive !== false);
      const source = accounts[0];
      const target = accounts.find((a) => a.id !== source?.id && (a.currencyId ?? null) === (source?.currencyId ?? null) && a.chartOfAccountId !== source?.chartOfAccountId);
      if (source && target) {
        const transfer = await call("POST", "/financial-transactions/transfers/confirmed", {
          receivingAccountId: source.id,
          targetReceivingAccountId: target.id,
          amount: 1200,
          idempotencyKey: `r22u-tr-${stamp}`,
        });
        await page.goto(`${BASE}/purchasing/payments/${transfer.id}?purpose=transfer`);
        await settle(page, 1500);
        await shot(page, "V10-transfer-confirmed-ar-1440");
        note("transfer opens in the card", /TR-/.test(await page.evaluate(() => document.body.innerText)));
      } else {
        note("transfer: two same-currency accounts available", false, accounts.length);
      }
    });
  }

  if (receiptId && locale === "ar") {
    await step("refund advance from the receipt", async () => {
      const advance = await call("POST", "/financial-transactions/receipts/confirmed", {
        partnerId: customer.id,
        amount: 5000,
        receivingAccountId: (await call("GET", `/financial-transactions/receipts/${receiptId}`)).receivingAccountId,
        allocations: [],
        idempotencyKey: `r22u-adv-${stamp}`,
      });
      await page.goto(`${BASE}/sales/payments/${advance.id}`);
      await settle(page, 1500);
      const more = page.getByRole("button", { name: /رد دفعة مقدمة/ });
      if (!(await more.count())) await page.getByRole("button", { name: /المزيد/ }).first().click();
      await page.getByText("رد دفعة مقدمة", { exact: true }).first().click();
      await page.waitForTimeout(1200);
      await shot(page, "V11-refund-advance-dialog-ar-1440", false);
      note("refund-advance dialog shows the unapplied amount", /5,000\.00/.test(await page.getByRole("dialog").innerText()));
      await page.keyboard.press("Escape");
    });
  }

  if (receiptId) {
    await step(`confirmed receipt table ${locale}`, async () => {
      await page.goto(`${BASE}/sales/payments/${receiptId}`);
      await settle(page, 1500);
      await shot(page, `T1-receipt-confirmed-rtl-table-${locale}-1440`);
      const sides = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return null;
        const heads = [...table.querySelectorAll("thead th")];
        const cells = [...table.querySelectorAll("tbody tr:first-child td")];
        const side = (el) => {
          const r = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()].filter((x) => x.width > 0.5);
          if (!rects.length) return null;
          const left = Math.min(...rects.map((x) => x.left)) - r.left;
          const right = r.right - Math.max(...rects.map((x) => x.right));
          return Math.abs(left - right) < 6 ? "center" : left < right ? "left" : "right";
        };
        return heads.map((th, i) => ({ h: th.innerText.trim(), head: side(th), body: cells[i] ? side(cells[i]) : null }));
      });
      const bad = (sides ?? []).filter((c) => c.h && c.body && c.head && c.body !== c.head && c.body !== "center" && !c.body.includes("input"));
      note(`${locale}: confirmed receipt table headers over their figures`, bad.length === 0, bad);
    });
  }

  await step(`invoice lists ${locale}`, async () => {
    await page.goto(`${BASE}/sales/invoices`);
    await settle(page, 1500);
    await shot(page, `L1-sales-invoices-${locale}-1440`, false);
    await page.goto(`${BASE}/purchasing/purchase-invoices`);
    await settle(page, 1500);
    await shot(page, `L2-purchase-invoices-${locale}-1440`, false);
  });

  await step(`invoice detail ${locale}`, async () => {
    await page.goto(`${BASE}/sales/invoices/${salesInvoice.id}`);
    await settle(page, 1800);
    await shot(page, `D1-sales-invoice-detail-${locale}-1440`);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    note(`${locale}: settlement history lists the receipt with its amount`, /CR-[\d-]+[^]{0,140}100,000/.test(text));
    if (purchaseInvoice) {
      await page.goto(`${BASE}/purchasing/purchase-invoices/${purchaseInvoice.id}`);
      await settle(page, 1800);
      await shot(page, `D2-purchase-invoice-detail-${locale}-1440`);
    }
    await page.goto(`${BASE}/reports/finance?report=arAging`);
    await settle(page, 1800);
    await shot(page, `R1-ar-aging-${locale}-1440`, false);
  });
  await ctx.close();

  // ---------------------------------------------------------------- 375
  await step(`mobile ${locale}`, async () => {
    const m = await session({ locale, device: devices["iPhone 13"] });
    for (const [key, path] of [
      ["receipt-new", "/sales/payments/new"],
      ["receipt-from-invoice", `/sales/payments/new?partnerId=${customer.id}&invoiceId=${salesInvoice2.id}`],
      ["sales-invoices", "/sales/invoices"],
      ["invoice-detail", `/sales/invoices/${salesInvoice.id}`],
    ]) {
      await m.page.goto(`${BASE}${path}`);
      await settle(m.page, 1500);
      await shot(m.page, `M-${key}-${locale}-375`);
      const noScroll = await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      note(`${locale} 375 ${key}: no horizontal scroll`, noScroll);
      if (key === "receipt-new") {
        const box = await amount(m.page).boundingBox();
        const font = await amount(m.page).evaluate((el) => getComputedStyle(el).fontSize);
        note(`${locale} 375: amount ≥ 44px / ≥ 16px`, box && box.height >= 44 && parseFloat(font) >= 16, `${box?.height} ${font}`);
      }
    }
    await m.ctx.close();
  });
}

await browser.close();
writeFileSync(`${OUT}/evidence.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), log }, null, 2));
const failed = log.filter((r) => !r.ok).length;
console.log(`\n${log.length - failed}/${log.length} pass → ${OUT}`);
