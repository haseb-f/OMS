#!/usr/bin/env node
/**
 * R22 I-B — UI measurement + failing checks (local build only, never Production).
 *
 *   BASE=http://localhost:4911 API=http://localhost:4915 node scripts/acceptance/r22/r22-ib-ui-measure.mjs
 *
 * Measures, on the real build against a demo clone (default oms_r22_ui), what the owner brief §2–§5 asks about:
 *  A. Receipt / payment / expense editors: fields shown, amount field (label, placeholder, initial value,
 *     currency, border + hover/focus, inputmode), real-Chrome typing of decimals / paste «1,234.50» /
 *     Arabic-Indic digits, validation preserving values, double-click Confirm, the pre-confirm summary.
 *  B. Baseline 200,000 invoice → receipt from the invoice lowered to 100,000 → list / detail / statement.
 *  C. Stale data: an invoice detail left open while a receipt is confirmed in another tab.
 *  D. Table alignment per list (ar + en, 1440): header vs body alignment per column, numeric edge,
 *     clipped amounts (scrollWidth > clientWidth), truncated labels, server sort on each sortable column.
 *  E. 375 px: horizontal scroll and amount-field size.
 * Every requirement is a PASS / FAIL line; FAIL = a defect phase 2 must fix (expected today).
 * Evidence: specs/round22-settlement/evidence/ib/ (screenshots + measure.json).
 * Demo personas; password from tmp/r15-manual/.env MANUAL_PW (never printed).
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:4911").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:4915").replace(/\/$/, "");
if (/haseb|vercel/i.test(BASE + API)) throw new Error("local builds only");
const OUT = process.env.OUT ?? "specs/round22-settlement/evidence/ib";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";

const results = [];
const data = {};
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: typeof detail === "string" ? detail.slice(0, 600) : detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail).slice(0, 220)}`);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    check(`${name} (step error)`, false, String(error?.message ?? error).slice(0, 400));
  }
};

// ---------------------------------------------------------------- API helpers
const { accessToken } = await (
  await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  })
).json();
if (!accessToken) throw new Error("API login failed");
const raw = (method, path, body) =>
  fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const call = async (method, path, body) => {
  const r = await raw(method, path, body);
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);

const stamp = Date.now().toString(36).toUpperCase();
const customer = await call("POST", "/partners", { name: `عميل R22 ${stamp}`, roles: ["CUSTOMER"] });
const supplier = await call("POST", "/partners", { name: `مورد R22 ${stamp}`, roles: ["SUPPLIER"] });
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
  referenceNumber: `R22IB-S-${stamp}`,
  items: [line(sellable, 200000)],
}).then((i) => call("POST", `/sales/invoices/${i.id}/confirm`));
let purchaseInvoice = null;
await step("setup purchase invoice", async () => {
  const draft = await call("POST", "/purchasing/invoices", {
    partnerId: supplier.id,
    referenceNumber: `R22IB-P-${stamp}`,
    items: [{ ...line(purchasable, 200000), unitCost: 200000 }],
  });
  purchaseInvoice = await call("POST", `/purchasing/invoices/${draft.id}/confirm`).catch(async () => {
    await call("POST", `/purchasing/invoices/${draft.id}/submit`).catch(() => null);
    await call("POST", `/purchasing/invoices/${draft.id}/approve`).catch(() => null);
    return call("POST", `/purchasing/invoices/${draft.id}/confirm`);
  });
});
check(
  "setup: sales invoice 200,000 confirmed (+ purchase invoice 200,000)",
  salesInvoice.status === "CONFIRMED",
  `${salesInvoice.invoiceNumber} ${salesInvoice.grandTotal} · ${purchaseInvoice?.invoiceNumber ?? "no PI"} ${purchaseInvoice?.status ?? ""}`,
);
const invoiceState = async (path) => {
  const row = await call("GET", path);
  return { total: Number(row.grandTotal), paid: Number(row.allocatedTotal), remaining: Number(row.remainingBalance), status: row.paymentStatus };
};

// ---------------------------------------------------------------- browser helpers
const browser = await chromium.launch();
async function session({ locale = "ar", device = null } = {}) {
  const ctx = await browser.newContext({
    ...(device ?? { viewport: { width: 1440, height: 900 } }),
    permissions: ["clipboard-read", "clipboard-write"],
  });
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
const settle = async (page, ms = 800) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = (page, name, fullPage = true) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage }).catch(() => {});
const amountInput = (page) => page.locator('[data-field-name="amount"] input').first();

/** Every visible label + control of the voucher's main form (what the user is asked for). */
const formInventory = (page) =>
  page.evaluate(() => {
    const scope = document.querySelector("[data-form-scope]") ?? document.body;
    return [...scope.querySelectorAll("label")]
      .filter((label) => label.offsetParent !== null)
      .map((label) => {
        const control = label.htmlFor ? document.getElementById(label.htmlFor) : null;
        return {
          label: label.textContent.trim(),
          required: /\*/.test(label.textContent),
          disabled: control ? control.disabled || control.getAttribute("aria-disabled") === "true" || control.hasAttribute("data-disabled") : null,
          value: control ? (control.value ?? control.textContent ?? "").trim().slice(0, 60) : null,
        };
      });
  });

const amountStyle = (page) =>
  page.evaluate(() => {
    const input = document.querySelector('[data-field-name="amount"] input');
    if (!input) return null;
    const s = getComputedStyle(input);
    const group = input.closest('[data-field-name="amount"]');
    const rect = input.getBoundingClientRect();
    return {
      type: input.type,
      inputMode: input.inputMode,
      placeholder: input.placeholder,
      value: input.value,
      label: document.querySelector(`label[for="${input.id}"]`)?.textContent.trim() ?? null,
      groupText: group?.textContent.trim(),
      borderWidth: s.borderTopWidth,
      borderColor: s.borderTopColor,
      outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      boxShadow: s.boxShadow,
      fontSize: s.fontSize,
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      textAlign: s.textAlign,
    };
  });

async function typeInto(page, text) {
  const input = amountInput(page);
  await input.click();
  await input.press("Control+A");
  await input.press("Backspace");
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(150);
  return input.inputValue();
}
async function pasteInto(page, text) {
  const input = amountInput(page);
  await input.click();
  await input.press("Control+A");
  await input.press("Backspace");
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await input.press("Control+V");
  await page.waitForTimeout(150);
  return input.inputValue();
}
/** Amount the editor actually holds — the header meta ("date · amount") mirrors the state. */
const headerMeta = (page) =>
  page.evaluate(() => document.querySelector("[data-form-scope]")?.querySelector("header, [data-slot='editor-header']")?.textContent ?? "");

// ---------------------------------------------------------------- A. editors
const { ctx, page } = await session({ locale: "ar" });

for (const editor of [
  { key: "receipt", path: "/sales/payments/new", label: /المبلغ المقبوض/ },
  { key: "payment", path: "/purchasing/payments/new", label: /المبلغ المدفوع/ },
  { key: "expense", path: "/finance/expenses/new", label: /المبلغ المدفوع/ },
]) {
  await step(`A ${editor.key} editor`, async () => {
    await page.goto(`${BASE}${editor.path}`);
    await settle(page, 1200);
    await amountInput(page).waitFor({ timeout: 20000 });
    await shot(page, `A-${editor.key}-new-ar-1440`);
    const inventory = await formInventory(page);
    data[`${editor.key}Fields`] = inventory;
    const style = await amountStyle(page);
    data[`${editor.key}Amount`] = style;
    check(`A ${editor.key}: amount starts empty`, style.value === "", style.value);
    check(`A ${editor.key}: amount label is purpose-specific (${editor.label})`, editor.label.test(style.label ?? ""), style.label);
    check(`A ${editor.key}: placeholder «أدخل المبلغ» (not 0.00)`, style.placeholder === "أدخل المبلغ", style.placeholder);
    check(`A ${editor.key}: currency visible at the amount`, /[A-Z]{3}|ج\.م|ر\.س/.test(style.groupText ?? ""), style.groupText);
    check(`A ${editor.key}: amount border ≥ 1.5px (substantial)`, parseFloat(style.borderWidth) >= 1.5, `${style.borderWidth} ${style.borderColor} h=${style.height}`);
    // hover / focus treatment
    await amountInput(page).hover();
    await page.waitForTimeout(500);
    const hover = await amountStyle(page);
    await amountInput(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    const focus = await amountStyle(page);
    data[`${editor.key}AmountStates`] = { rest: style, hover, focus };
    check(`A ${editor.key}: hover changes the border`, hover.borderColor !== style.borderColor, `${style.borderColor} → ${hover.borderColor}`);
    check(`A ${editor.key}: focus ring visible`, (focus.boxShadow !== "none" && !/\/ 0\)|rgba\(0, 0, 0, 0\)/.test(focus.boxShadow)) || focus.borderColor !== style.borderColor, `${focus.boxShadow} | ${focus.outline}`);
    check(`A ${editor.key}: mobile keyboard inputmode=decimal`, style.inputMode === "decimal", style.inputMode);
    // real Chrome entry
    const typed05 = await typeInto(page, "0.5");
    check(`A ${editor.key}: typing «0.5» keeps «0.5»`, typed05 === "0.5", typed05);
    const typedDec = await typeInto(page, "100.05");
    check(`A ${editor.key}: typing «100.05» keeps the decimals`, typedDec === "100.05", typedDec);
    const pasted = await pasteInto(page, "1,234.50");
    data[`${editor.key}Paste`] = pasted;
    check(`A ${editor.key}: paste «1,234.50» → 1234.50`, /^1,?234\.50?$/.test(pasted), pasted);
    const arabic = await typeInto(page, "١٢٣٤٫٥");
    check(`A ${editor.key}: Arabic-Indic digits «١٢٣٤٫٥» accepted`, /1,?234\.5|١٢٣٤٫٥/.test(arabic), arabic);
    if (editor.key === "receipt") await shot(page, `A-receipt-after-entry-ar-1440`, false);
  });
}

await step("A receipt: validation keeps entered values", async () => {
  await page.goto(`${BASE}/sales/payments/new`);
  await settle(page, 1200);
  await typeInto(page, "750");
  await page.locator('[data-field-name="amount"]').first().click(); // blur target
  await page.getByRole("button", { name: "تأكيد", exact: true }).first().click();
  await page.waitForTimeout(800);
  const after = await amountInput(page).inputValue();
  const messages = await page.evaluate(() =>
    [...document.querySelectorAll('[data-invalid="true"], [role="alert"]')].map((el) => el.textContent.trim()).filter(Boolean),
  );
  data.receiptValidation = { after, messages };
  await shot(page, "A-receipt-validation-ar-1440", false);
  check("A receipt: amount kept after a failed Confirm (no customer)", after === "750", after);
  check("A receipt: party error shown inline", messages.some((m) => /العميل|عميل/.test(m)), messages);
});

// ---------------------------------------------------------------- B. baseline 200,000 → 100,000 + double click
let receiptId = null;
await step("B receipt 100,000 from the invoice (double-click Confirm)", async () => {
  await page.goto(`${BASE}/sales/invoices/${salesInvoice.id}`);
  await settle(page, 1200);
  await shot(page, "B-invoice-detail-before-ar-1440");
  const receive = page.getByRole("button", { name: /استلام دفعة/ }).first();
  const clicksBefore = [];
  if (await receive.isVisible().catch(() => false)) {
    await receive.click();
    clicksBefore.push("استلام دفعة");
  } else {
    await page.goto(`${BASE}/sales/payments/new?partnerId=${customer.id}&invoiceId=${salesInvoice.id}`);
  }
  await page.waitForURL((u) => u.pathname.startsWith("/sales/payments/new"), { timeout: 20000 });
  await settle(page, 1500);
  const prefilled = await amountInput(page).inputValue();
  check("B receipt opened from the invoice proposes the open balance", /200000/.test(prefilled), prefilled);
  const allocationInput = page.locator('[data-testid="allocation-line"] input').first();
  await allocationInput.waitFor({ timeout: 20000 });
  await allocationInput.fill("100000");
  await allocationInput.blur();
  await page.waitForTimeout(500);
  const followed = await amountInput(page).inputValue();
  check("B amount follows the lowered allocation (R18 guard)", followed === "100000", followed);
  await shot(page, "B-receipt-before-confirm-ar-1440");
  const posts = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /financial-transactions\/receipts/.test(req.url())) posts.push(req.url());
  });
  const confirm = page.getByRole("button", { name: "تأكيد", exact: true }).first();
  await confirm.dblclick();
  const dialog = page.getByRole("alertdialog");
  const hadDialog = await dialog.isVisible({ timeout: 1500 }).catch(() => false);
  data.preConfirmSummary = hadDialog ? (await dialog.innerText()).replace(/\s+/g, " ") : null;
  check("B a review / summary (where the money goes, which invoices) is shown before Confirm", hadDialog, data.preConfirmSummary ?? "posted directly, no summary");
  if (hadDialog) await dialog.getByRole("button").last().click();
  await page.waitForURL((u) => /\/sales\/payments\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 });
  receiptId = new URL(page.url()).pathname.split("/").pop();
  await settle(page, 1200);
  await shot(page, "B-receipt-confirmed-ar-1440");
  const receipts = items(await call("GET", `/financial-transactions/receipts?partnerId=${customer.id}&pageSize=50`));
  data.doubleClick = { posts, vouchers: receipts.map((r) => `${r.transactionNumber} ${r.status} ${r.amount}`) };
  check("B double-click Confirm creates one voucher", receipts.length === 1, data.doubleClick);
  const state = await invoiceState(`/sales/invoices/${salesInvoice.id}`);
  check("B API: 200,000 / paid 100,000 / remaining 100,000 / PARTIALLY_PAID", state.paid === 100000 && state.remaining === 100000 && state.status === "PARTIALLY_PAID", state);
});

// ---------------------------------------------------------------- C. stale data across tabs + settlement history
await step("C stale invoice detail in a second tab", async () => {
  const pageA = await ctx.newPage();
  await pageA.goto(`${BASE}/sales/invoices/${salesInvoice.id}`);
  await settle(pageA, 1200);
  const readPaid = () =>
    pageA.evaluate(() => document.body.innerText.match(/المتبقي[\s\S]{0,40}?([\d,]+\.\d{2})/)?.[1] ?? null);
  const before = await readPaid();
  // second receipt of 40,000 in this tab, allocated to the same invoice
  const r2 = await call("POST", "/financial-transactions/receipts/confirmed", {
    partnerId: customer.id,
    amount: 40000,
    receivingAccountId: (await call("GET", `/financial-transactions/receipts/${receiptId}`)).receivingAccountId,
    allocations: [{ invoiceId: salesInvoice.id, allocatedAmount: 40000 }],
    idempotencyKey: `r22-ib-${stamp}-2`,
  });
  await pageA.bringToFront();
  await pageA.waitForTimeout(1500);
  const afterFocus = await readPaid();
  data.staleTab = { before, afterFocus, receipt2: r2.transactionNumber };
  check("C invoice open in another tab refreshes remaining on return (focus)", before !== afterFocus, data.staleTab);
  await pageA.reload();
  await settle(pageA, 1200);
  data.staleTab.afterReload = await readPaid();
  // settlement history: does the invoice show each voucher with date + allocated amount + status?
  const traceText = await pageA.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const voucherNo = (await call("GET", `/financial-transactions/receipts/${receiptId}`)).transactionNumber;
  const hasVoucher = traceText.includes(voucherNo);
  const hasAllocatedAmount = new RegExp(`${voucherNo}[^]{0,120}100,000`).test(traceText);
  data.settlementHistory = { voucherNo, hasVoucher, hasAllocatedAmount };
  await shot(pageA, "C-invoice-detail-after-ar-1440");
  check("C invoice detail lists the linked receipt", hasVoucher, voucherNo);
  check("C invoice settlement history shows the allocated amount per voucher", hasAllocatedAmount, data.settlementHistory);
  check("C invoice shows credit notes / adjustments apart from cash paid", /إشعار|مرتجع|تسويات|Credit/.test(traceText.match(/حالة السداد[^]{0,300}/)?.[0] ?? ""), "payment summary block");
  await pageA.close();
});

// ---------------------------------------------------------------- D. table alignment / clipping / sort
const LISTS = [
  { key: "sales-invoices", path: "/sales/invoices", api: "/sales/invoices" },
  { key: "purchase-invoices", path: "/purchasing/purchase-invoices", api: "/purchasing/invoices" },
  { key: "receipts", path: "/sales/payments", api: "/financial-transactions/receipts" },
  { key: "supplier-payments", path: "/purchasing/payments", api: "/financial-transactions/payments" },
  { key: "expenses", path: "/finance/expenses", api: "/financial-transactions/expense-payments" },
];

async function showAllColumns(p) {
  const button = p.getByRole("button", { name: /الأعمدة|Columns/ }).first();
  if (!(await button.isVisible().catch(() => false))) return false;
  await button.click();
  await p.waitForTimeout(300);
  const boxes = p.getByRole("menuitemcheckbox");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    if ((await box.getAttribute("aria-checked")) === "false") {
      await box.click();
      await p.waitForTimeout(80);
    }
  }
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  return true;
}

/** Per column: the physical side the header text and the body content sit on, numeric edge, clipping. */
const measureTable = (p, tableIndex = 0) =>
  p.evaluate((index) => {
    const table = document.querySelectorAll("table")[index];
    if (!table) return null;
    const dir = getComputedStyle(table).direction;
    /** Physical side of the cell's visible TEXT (text nodes only — icons, full-width buttons and blocks ignored). */
    const side = (cell) => {
      const r = cell.getBoundingClientRect();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        if (node.parentElement.closest(".sr-only, [aria-hidden='true']")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((x) => x.width > 0.5));
      }
      if (rects.length === 0) return null;
      const left = Math.max(0, Math.min(...rects.map((x) => x.left)) - r.left);
      const right = Math.max(0, r.right - Math.max(...rects.map((x) => x.right)));
      if (Math.abs(left - right) < 6) return { side: "center", left: Math.round(left), right: Math.round(right) };
      return { side: left < right ? "left" : "right", left: Math.round(left), right: Math.round(right) };
    };
    const headers = [...table.querySelectorAll("thead th")];
    const rows = [...table.querySelectorAll("tbody tr")].filter((tr) => tr.children.length === headers.length);
    return {
      dir,
      tableScroll: { scrollWidth: table.parentElement.scrollWidth, clientWidth: table.parentElement.clientWidth },
      columns: headers.map((th, index) => {
        const head = side(th);
        const cells = rows.slice(0, 12).map((tr) => tr.children[index]);
        const bodySides = cells.map(side).filter(Boolean);
        const sides = [...new Set(bodySides.map((s) => s.side))];
        const clipped = cells.flatMap((td) =>
          [td, ...td.querySelectorAll("*")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
            .map((el) => el.textContent.trim().slice(0, 40)),
        );
        const text = cells.map((td) => td.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
        const numeric = text.length > 0 && text.every((t) => /\d[\d,]*\.\d{2}/.test(t));
        const hasMoney = text.some((t) => /\d[\d,]*\.\d{2}/.test(t));
        return {
          header: th.innerText.replace(/\s+/g, " ").trim(),
          headerAlign: getComputedStyle(th).textAlign,
          headerSide: head?.side ?? null,
          bodySides: sides,
          numeric,
          hasMoney,
          sortable: !!th.querySelector("button"),
          clipped: [...new Set(clipped)].slice(0, 3),
          headerGap: head ? { left: head.left, right: head.right } : null,
          bodyGap: bodySides.length ? bodySides.slice(0, 3).map((b) => ({ left: b.left, right: b.right })) : null,
          widthPx: Math.round(th.getBoundingClientRect().width),
          sample: text.slice(0, 2),
        };
      }),
    };
  }, tableIndex);

function assessTable(label, m) {
  for (const col of m.columns) {
    if (!col.header || col.bodySides.length === 0) continue;
    const mismatch = col.headerSide && col.bodySides.some((side) => side !== col.headerSide && side !== "center");
    check(`${label}: «${col.header}» header aligned with body`, !mismatch, `${col.headerSide} vs ${col.bodySides.join("/")} ${JSON.stringify({ h: col.headerGap, b: col.bodyGap })}`);
    if (col.hasMoney) {
      const endSide = m.dir === "rtl" ? "left" : "right";
      check(`${label}: «${col.header}» amounts on the numeric end edge`, col.bodySides.every((side) => side === endSide), `${col.bodySides.join("/")} (end=${endSide})`);
    }
    if (col.clipped.length) check(`${label}: «${col.header}» not clipped`, false, col.clipped);
  }
}

for (const locale of ["ar", "en"]) {
  const s = locale === "ar" ? { ctx, page } : await session({ locale: "en" });
  for (const list of LISTS) {
    await step(`D ${list.key} ${locale}`, async () => {
      await s.page.goto(`${BASE}${list.path}`);
      await settle(s.page, 1500);
      await s.page.locator("table tbody tr").first().waitFor({ timeout: 15000 }).catch(() => {});
      await shot(s.page, `D-${list.key}-${locale}-1440-default`, false);
      const defaults = await measureTable(s.page);
      await showAllColumns(s.page);
      await settle(s.page, 400);
      const all = await measureTable(s.page);
      await shot(s.page, `D-${list.key}-${locale}-1440-all-columns`, false);
      data[`table:${list.key}:${locale}`] = { defaults, all };
      if (!all) return check(`D ${list.key} ${locale}: table rendered`, false, "no table");
      if (defaults) assessTable(`D ${list.key} ${locale} default`, defaults);
      assessTable(`D ${list.key} ${locale} all-columns`, all);
      const visibleDefault = (defaults?.columns ?? []).map((c) => c.header);
      data[`table:${list.key}:${locale}`].visibleDefault = visibleDefault;
    });
  }
  // The editor's own tables: open invoices + allocation grid (confirmed receipt) and invoice lines.
  await step(`D editor tables ${locale}`, async () => {
    for (const target of [
      ...(receiptId ? [{ key: "receipt-confirmed", path: `/sales/payments/${receiptId}` }] : []),
      { key: "receipt-from-invoice", path: `/sales/payments/new?partnerId=${customer.id}&invoiceId=${salesInvoice.id}` },
      { key: "invoice-detail", path: `/sales/invoices/${salesInvoice.id}` },
    ]) {
      await s.page.goto(`${BASE}${target.path}`);
      await settle(s.page, 1800);
      const count = await s.page.locator("table").count();
      for (let i = 0; i < count; i++) {
        const m = await measureTable(s.page, i);
        if (!m) continue;
        data[`editorTable:${target.key}:${i}:${locale}`] = m;
        assessTable(`D ${target.key} table#${i} ${locale}`, m);
        if (target.key === "receipt-confirmed") {
          const remainingCol = m.columns.find((c) => /^(المتبقي|Remaining)$/.test(c.header));
          if (remainingCol) {
            const api = await invoiceState(`/sales/invoices/${salesInvoice.id}`);
            const shown = Number(String(remainingCol.sample[0] ?? "").replace(/[^\d.]/g, ""));
            check(`D receipt-confirmed table#${i} ${locale}: «${remainingCol.header}» equals the invoice's remaining balance`, shown === api.remaining, `shown ${shown} vs invoice ${api.remaining}`);
          }
        }
      }
      await shot(s.page, `D-${target.key}-${locale}-1440`, false);
    }
  });
  if (locale === "en") await s.ctx.close();
}

await step("D server sort on each sortable column id", async () => {
  const sortIds = {
    "/sales/invoices": ["invoiceNumber", "customer", "grandTotal", "createdAt", "allocatedTotal", "remainingBalance"],
    "/purchasing/invoices": ["invoiceNumber", "supplier", "grandTotal", "createdAt"],
    "/financial-transactions/receipts": ["transactionNumber", "customer", "amount", "createdAt"],
    "/financial-transactions/payments": ["transactionNumber", "supplier", "amount", "createdAt"],
  };
  data.sort = {};
  for (const [path, ids] of Object.entries(sortIds)) {
    for (const id of ids) {
      const r = await raw("GET", `${path}?sortBy=${id}&sortOrder=desc&pageSize=50`);
      const body = await r.json().catch(() => null);
      const list = items(body);
      let numericOk = null;
      if (r.ok && /total|amount|balance/i.test(id)) {
        const values = list.map((row) => Number(row[id]));
        numericOk = values.every((v, i) => i === 0 || values[i - 1] >= v);
      }
      data.sort[`${path}:${id}`] = { status: r.status, rows: list.length, numericOk };
      check(`D sort ${path} by ${id}`, r.ok && numericOk !== false, `HTTP ${r.status}${numericOk === null ? "" : ` numeric-desc=${numericOk}`}`);
    }
  }
});

// ---------------------------------------------------------------- E. mobile 375
for (const locale of ["ar", "en"]) {
  await step(`E 375 ${locale}`, async () => {
    const m = await session({ locale, device: devices["iPhone 13"] });
    for (const target of [
      { key: "receipt-new", path: "/sales/payments/new" },
      { key: "sales-invoices", path: "/sales/invoices" },
      { key: "invoice-detail", path: `/sales/invoices/${salesInvoice.id}` },
      ...(receiptId ? [{ key: "receipt-confirmed", path: `/sales/payments/${receiptId}` }] : []),
    ]) {
      await m.page.goto(`${BASE}${target.path}`);
      await settle(m.page, 1500);
      await shot(m.page, `E-${target.key}-${locale}-375`);
      const noScroll = await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(`E ${target.key} ${locale} 375: no horizontal scroll`, noScroll, "");
      if (target.key === "receipt-new") {
        const style = await amountStyle(m.page);
        data[`mobileAmount:${locale}`] = style;
        check(`E receipt ${locale} 375: amount ≥ 44px tall and ≥ 16px text`, style && style.height >= 44 && parseFloat(style.fontSize) >= 16, style && `${style.height}px / ${style.fontSize}`);
      }
    }
    await m.ctx.close();
  });
}

// ---------------------------------------------------------------- English editor shots
await step("A en editors (screenshots)", async () => {
  const e = await session({ locale: "en" });
  for (const [key, path] of [["receipt", "/sales/payments/new"], ["payment", "/purchasing/payments/new"], ["expense", "/finance/expenses/new"]]) {
    await e.page.goto(`${BASE}${path}`);
    await settle(e.page, 1200);
    await shot(e.page, `A-${key}-new-en-1440`);
    data[`${key}AmountEn`] = await amountStyle(e.page);
  }
  if (receiptId) {
    await e.page.goto(`${BASE}/sales/invoices/${salesInvoice.id}`);
    await settle(e.page, 1200);
    await shot(e.page, "C-invoice-detail-en-1440");
  }
  await e.ctx.close();
});

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok).length;
writeFileSync(`${OUT}/measure.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), salesInvoice: salesInvoice.invoiceNumber, purchaseInvoice: purchaseInvoice?.invoiceNumber ?? null, results, data }, null, 2));
console.log(`\n${results.length - failed}/${results.length} pass, ${failed} fail → ${OUT}/measure.json`);
