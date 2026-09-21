#!/usr/bin/env node
/**
 * Browser E2E — payment reliability, contextual navigation, product browser,
 * export language, report summaries/alignment and the cash-flow movement view.
 *
 *   BASE=https://oms.haseb.org node scripts/production-payments-nav-e2e.mjs
 *   BASE=http://localhost:3001 API=http://localhost:3005 EMAIL=admin@oms.local \
 *     PASSWORD=... node scripts/production-payments-nav-e2e.mjs
 *
 * Creates only isolated, run-prefixed QA records. Writes OUT/report.json plus
 * screenshots and export samples.
 */
/* global document, window, localStorage, getComputedStyle -- evaluated in the page */
import { chromium } from "playwright";
import { createRequire } from "module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const i = raw.indexOf("=");
    if (i < 1) continue;
    const key = raw.slice(0, i);
    const value = raw.slice(i + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(new URL("../tmp/.qa.env", import.meta.url));

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PASSWORD = process.env.PASSWORD ?? process.env.QA_PASSWORD ?? "";
const OUT = process.env.OUT ?? "tmp/payments-nav-e2e";
const RUN = `QA-PN-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
mkdirSync(OUT, { recursive: true });

const results = [];
const evidenceMap = {};
let token = "";

function record(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 600) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
}
const evidence = (key, value) => (evidenceMap[key] = value);

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const items = (response) => response.json?.items ?? (Array.isArray(response.json) ? response.json : []);

async function newPage(browser, { width = 1440, height = 900, locale = "en", theme = "light" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    hasTouch: width < 768,
    isMobile: width < 768,
    acceptDownloads: true,
  });
  await context.addCookies([
    {
      name: "oms_token",
      value: token,
      domain: new URL(BASE).hostname,
      path: "/",
      secure: BASE.startsWith("https"),
    },
  ]);
  await context.addInitScript(
    ([loc, th]) => {
      localStorage.setItem("oms.locale", JSON.stringify(loc));
      localStorage.setItem("theme", th);
    },
    [locale, theme],
  );
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
  return { context, page };
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function toastText(page) {
  const toast = page.locator("[data-sonner-toast]").last();
  await toast.waitFor({ timeout: 60000 });
  return toast.innerText();
}

async function noOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1,
  );
}

async function balancedJe(jeId) {
  const je = await api("GET", `/journal-entries/${jeId}`);
  const lines = je.json.lines ?? [];
  const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit), 0);
  return {
    ok: Math.abs(dr - cr) < 0.005 && dr > 0 && je.json.status === "POSTED",
    entryNumber: je.json.entryNumber,
    dr,
    cr,
    lines: lines.map((l) => `${l.account?.code ?? ""} ${l.account?.name ?? l.accountId} Dr ${l.debit} Cr ${l.credit}`),
  };
}

async function traceJournal(kind, id) {
  const trace = await api("GET", `/traceability/${kind}/${id}`);
  const group = trace.json.groups?.find((g) => g.key === "JOURNAL_ENTRIES");
  return (group?.items ?? []).filter((i) => i.sourceType === kind || !i.sourceType);
}

/** Header vs body vs footer edge alignment for every numeric (end-aligned) column. */
async function alignmentReport(page) {
  return page.evaluate(() => {
    const NUMERIC = /^[-−(]?[\d.,\s]+\)?(\s?[A-Z]{3})?$/;
    const issues = [];
    let checked = 0;
    const textBox = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const boxes = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      if (!boxes.length) return null;
      return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)) };
    };
    /** The numeric content of a cell: an input value or the deepest element holding only a number. */
    const numericBox = (td) => {
      const input = td.querySelector("input:not([type=checkbox])");
      const addon = input?.closest('[data-slot="input-group"]')?.querySelector('[data-slot="input-group-addon"]');
      if (addon) return /\d/.test(input.value) ? textBox(addon) : null;
      if (input) {
        if (!/\d/.test(input.value)) return null;
        const style = getComputedStyle(input);
        if (style.textAlign === "center") return null;
        const r = input.getBoundingClientRect();
        return { left: r.left + parseFloat(style.paddingLeft), right: r.right - parseFloat(style.paddingRight) };
      }
      // Only purely numeric cells (a code inside a name cell or a status +
      // amount compound cell is not a numeric column).
      if (!NUMERIC.test((td.textContent ?? "").trim())) return null;
      const candidates = [td, ...td.querySelectorAll("*")].filter((el) => {
        const text = (el.textContent ?? "").trim();
        return NUMERIC.test(text) && /\d/.test(text) && getComputedStyle(el).display !== "none";
      });
      return candidates.length ? textBox(candidates[candidates.length - 1]) : null;
    };
    const headerBox = (th) => {
      const label = (th.textContent ?? "").trim();
      if (!label) return null;
      const all = [th, ...th.querySelectorAll("*")].filter((el) => (el.textContent ?? "").trim() === label);
      return textBox(all[all.length - 1]);
    };
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const rect = table.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const headRow = table.querySelector("thead tr");
      if (!headRow) continue;
      const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.children.length === headRow.children.length);
      const footRow = Array.from(table.querySelectorAll("tfoot tr")).find((row) => row.children.length === headRow.children.length);
      const rtl = getComputedStyle(table).direction === "rtl";
      const edge = (box) => (rtl ? box.left : box.right);
      Array.from(headRow.children).forEach((th, index) => {
        const body = bodyRows.map((row) => numericBox(row.children[index])).filter(Boolean);
        if (!body.length || body.length < Math.ceil(bodyRows.length / 2)) return;
        const h = headerBox(th);
        if (!h) return;
        checked += 1;
        const bodyEdges = body.map(edge);
        const spread = Math.max(...bodyEdges) - Math.min(...bodyEdges);
        const delta = Math.abs(edge(h) - bodyEdges[0]);
        const f = footRow?.children[index] ? numericBox(footRow.children[index]) : null;
        const footDelta = f ? Math.abs(edge(f) - bodyEdges[0]) : 0;
        if (delta > 3 || footDelta > 3 || spread > 3) {
          issues.push(`${(th.textContent ?? "").trim()}: header Δ${delta.toFixed(1)} footer Δ${footDelta.toFixed(1)} rows Δ${spread.toFixed(1)}`);
        }
      });
    }
    return { checked, issues };
  });
}

async function readXlsx(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v && typeof v === "object" && "result" in v ? v.result : v))));
  return { name: ws.name, rtl: Boolean(ws.views?.[0]?.rightToLeft), rows };
}

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, rememberMe: true }),
  }).then((r) => r.json());
  token = login.accessToken;
  record("API login as permanent QA user", Boolean(token), EMAIL);
  if (!token) return;
  evidence("run", RUN);

  // ---------------------------------------------------------------- setup
  const currencies = items(await api("GET", "/currencies?pageSize=200"));
  const sar = currencies.find((c) => c.code === "SAR") ?? currencies[0];
  const accounts = items(await api("GET", "/receiving-accounts")).filter(
    (a) => a.isActive !== false && (!a.currencyId || a.currencyId === sar.id),
  );
  const receivingAccount = accounts.find((a) => a.isDefault) ?? accounts[0];
  const paymentSource = items(await api("GET", "/payment-sources?pageSize=50")).find((s) => s.isActive !== false);
  const sellable = items(await api("GET", "/products/catalog?pageSize=50&isSellable=true"));
  const product = sellable[0];
  record(
    "setup: currency, receiving account, payment source, product",
    Boolean(sar && receivingAccount && paymentSource && product),
    `${sar?.code} / ${receivingAccount?.name} / ${paymentSource?.name} / ${product?.sku}`,
  );

  const phoneSeed = String(Date.now()).slice(-8);
  let phoneCounter = 0;
  const createOrder = async (unitPrice, label) =>
    api("POST", "/store-orders", {
      partner: { name: `${RUN} ${label}`, phone: `+96650${phoneSeed.slice(0, 6)}${phoneCounter++}` },
      currencyId: sar.id,
      notes: RUN,
      items: [{ productId: product.id, quantity: 1, unitPrice }],
    });
  const reportPayment = async (orderId, amount) =>
    api("POST", `/store-orders/${orderId}/report-payment`, {
      reportedAmount: amount,
      reportedDate: new Date().toISOString().slice(0, 10),
      paymentSourceId: paymentSource.id,
      receivingAccountId: receivingAccount.id,
      reference: RUN,
      senderName: `${RUN} Sender`,
    });
  const findPayment = async (orderId) => {
    for (const status of ["PENDING", "MATCHED", "VERIFIED", "REJECTED"]) {
      const hit = items(await api("GET", `/payments?status=${status}&pageSize=100`)).find(
        (p) => p.storeOrder?.id === orderId,
      );
      if (hit) return hit;
    }
    return null;
  };
  const receiptsFor = async (paymentNumber) =>
    items(await api("GET", `/financial-transactions/receipts?search=${paymentNumber}&pageSize=20`)).filter(
      (r) => r.status !== "CANCELLED",
    );

  const browser = await chromium.launch();
  try {
    // ================================================================
    // 1) Payment Confirm & Post (P0) — zero-price correction, one-step
    //    posting, retries/double-click, rejection, the reported record
    // ================================================================
    {
      const order = await createOrder(0, "ZeroPriced");
      record("setup: store order saved with 0.00 agreed amount (reproduces reported state)", order.status < 300, order.json.internalOrderId ?? JSON.stringify(order.json));
      const orderId = order.json.id;
      const blocked = await reportPayment(orderId, 2000);
      record("guard: a payment cannot be reported against a 0.00 order", blocked.status === 400, blocked.json.message);

      const { context, page } = await newPage(browser, { locale: "en" });
      await page.goto(`${BASE}/store-orders/${orderId}`, { waitUntil: "networkidle" });
      await settle(page);
      const fixButton = page.getByRole("button", { name: "Correct agreed amounts" }).first();
      await fixButton.waitFor({ timeout: 30000 });
      await fixButton.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.getByTestId("line-amounts-dialog").waitFor({ timeout: 30000 });
      await dialog.locator("input").first().fill("2000");
      await page.screenshot({ path: `${OUT}/p1-agreed-amounts-dialog.png` });
      await dialog.getByRole("button").last().click();
      const priced = await toastText(page);
      const after = await api("GET", `/store-orders/${orderId}`);
      record("correction path: agreed amounts entered by the user are saved + logged", Number(after.json.total) === 2000, `${priced} | total=${after.json.total}`);
      await context.close();

      const reported = await reportPayment(orderId, 2000);
      record("sales agent reports the 2,000.00 payment", reported.status < 300, reported.status);
      const payment = await findPayment(orderId);
      evidence("p1Payment", payment?.paymentNumber);

      const review = await newPage(browser, { locale: "en" });
      await review.page.goto(`${BASE}/finance/payment-review`, { waitUntil: "networkidle" });
      const row = review.page.locator("tr", { hasText: payment.paymentNumber });
      await row.waitFor({ timeout: 60000 });
      const hasMatchButton = await row.getByRole("button", { name: /^(Match|Verify)$/ }).count();
      record("review queue offers Confirm & Post / Reject only (no Match → Verify)", hasMatchButton === 0 && (await row.getByTestId("payment-confirm-post").isEnabled()), "");
      await row.getByTestId("payment-confirm-post").click();
      const alert = review.page.getByRole("alertdialog");
      await alert.waitFor();
      await review.page.screenshot({ path: `${OUT}/p1-confirm-dialog.png` });
      await alert.getByRole("button", { name: "Confirm & Post" }).dblclick();
      const posted = await toastText(review.page);
      await review.page.screenshot({ path: `${OUT}/p1-confirmed-toast.png` });
      record("one confirmation: success message names receipt + JE", /confirmed — receipt CR-.* journal entry JV-/i.test(posted), posted);
      await review.page.reload({ waitUntil: "networkidle" });
      await settle(review.page);
      record("confirmed payment leaves the queue after reload", (await review.page.locator("tr", { hasText: payment.paymentNumber }).count()) === 0);

      const retries = await Promise.all([
        api("POST", `/payments/${payment.id}/confirm`),
        api("POST", `/payments/${payment.id}/confirm`),
        api("POST", `/payments/${payment.id}/verify`, {}),
      ]);
      record(
        "retries after success return the same receipt (alreadyPosted)",
        retries.every((r) => r.status === 200 && r.json.alreadyPosted === true) &&
          new Set(retries.map((r) => r.json.receipt?.id)).size === 1,
        retries.map((r) => `${r.status}:${r.json.receipt?.transactionNumber}`).join(","),
      );
      const receipts = await receiptsFor(payment.paymentNumber);
      record("exactly one receipt for the payment (double-click + retries)", receipts.length === 1, receipts.map((r) => r.transactionNumber).join(","));
      const receipt = retries[0].json.receipt;
      const je = await balancedJe(receipt.journalEntry.id);
      record("receipt JE posted and balanced (Dr receiving account / Cr AR)", je.ok, `${je.entryNumber} dr=${je.dr} cr=${je.cr} :: ${je.lines.join(" | ")}`);
      const gl = await api("GET", `/journal-entries/${receipt.journalEntry.id}`);
      record("JE is in the General Ledger (POSTED, dated, sourced)", gl.json.status === "POSTED" && gl.json.sourceType === "CUSTOMER_RECEIPT", `${gl.json.entryNumber} ${gl.json.entryDate}`);
      const settled = await findPayment(orderId);
      record("payment VERIFIED and order fully settled after reload", settled.status === "VERIFIED" && settled.settlement?.fullySettled === true, JSON.stringify(settled.settlement));
      evidence("p1Receipt", receipt.transactionNumber);
      evidence("p1Journal", je.entryNumber);
      evidence("p1OrderUrl", `${BASE}/store-orders/${orderId}`);
      evidence("p1JournalUrl", `${BASE}/finance/journal-entries/${receipt.journalEntry.id}`);

      // concurrent confirmations of a fresh payment post exactly once
      const order2 = await createOrder(500, "Concurrent");
      await reportPayment(order2.json.id, 500);
      const pay2 = await findPayment(order2.json.id);
      const burst = await Promise.all([1, 2, 3].map(() => api("POST", `/payments/${pay2.id}/confirm`)));
      const fresh = burst.filter((r) => r.status === 200 && r.json.alreadyPosted === false).length;
      const receipts2 = await receiptsFor(pay2.paymentNumber);
      record("3 concurrent Confirm & Post calls → one posting, one receipt", fresh === 1 && receipts2.length === 1, burst.map((r) => `${r.status}:${r.json.alreadyPosted}`).join(","));

      // rejection persists its reason without posting
      const order3 = await createOrder(300, "Reject");
      await reportPayment(order3.json.id, 300);
      const pay3 = await findPayment(order3.json.id);
      await review.page.reload({ waitUntil: "networkidle" });
      const row3 = review.page.locator("tr", { hasText: pay3.paymentNumber });
      await row3.waitFor({ timeout: 60000 });
      await row3.getByTestId("payment-reject").click();
      await review.page.getByTestId("payment-reject-submit").click();
      const needReason = await review.page.getByText("Enter the reason for rejecting this payment.").isVisible();
      await review.page.locator("#payment-reject-reason").fill(`${RUN} transfer not found in statement`);
      await review.page.getByTestId("payment-reject-submit").click();
      const rejectedToast = await toastText(review.page);
      const rejected = await findPayment(order3.json.id);
      const receipts3 = await receiptsFor(pay3.paymentNumber);
      record(
        "Reject requires a reason, persists it, posts nothing",
        needReason && rejected.status === "REJECTED" && receipts3.length === 0,
        `${rejectedToast} | status=${rejected.status}`,
      );
      const rejectedDetail = await api("GET", `/payments/${pay3.id}`);
      record("rejection reason survives reload", rejectedDetail.json.rejectionReason?.includes("transfer not found"), rejectedDetail.json.rejectionReason);

      // the reported record (order …000058, EGP 2,000) — diagnosed, never invented
      const reportedPay = items(await api("GET", "/payments?status=MATCHED&pageSize=100")).find(
        (p) => (p.storeOrder?.internalOrderId ?? "").endsWith("000058"),
      );
      if (reportedPay) {
        const reportedRow = review.page.locator("tr", { hasText: reportedPay.paymentNumber });
        await reportedRow.waitFor({ timeout: 60000 });
        await reportedRow.scrollIntoViewIfNeeded();
        await review.page.screenshot({ path: `${OUT}/p1-reported-case-needs-price.png` });
        const confirmDisabled = await reportedRow.getByTestId("payment-confirm-post").isDisabled();
        const setPrice = await reportedRow.getByTestId("payment-set-price").isVisible();
        const attempt = await api("POST", `/payments/${reportedPay.id}/confirm`);
        const unchanged = await api("GET", `/payments/${reportedPay.id}`);
        record(
          "reported case: blocked with the exact missing input (agreed price), nothing changed",
          confirmDisabled && setPrice && attempt.status === 400 && unchanged.json.status === "MATCHED",
          `${reportedPay.paymentNumber} ${reportedPay.storeOrder.internalOrderId} ${reportedPay.amount} ${reportedPay.currency?.code} → ${attempt.json.message}`,
        );
        evidence("reportedCase", {
          payment: reportedPay.paymentNumber,
          order: reportedPay.storeOrder.internalOrderId,
          amount: `${reportedPay.amount} ${reportedPay.currency?.code}`,
          orderTotal: reportedPay.settlement?.total,
          missingInput: "agreed amount of the order line(s) — the order was converted from a lead with 0.00",
        });
      }
      record("payment review: no page errors", review.page.errors.length === 0, review.page.errors.join(" | "));
      await review.context.close();
    }

    // ================================================================
    // 2) Invoice → receipt / supplier payment (P0)
    // ================================================================
    const partners = items(await api("GET", `/partners?pageSize=5&search=${encodeURIComponent(RUN)}`));
    const customer = partners[0];
    const supplierRes = await api("POST", "/partners", { name: `${RUN} Supplier`, roles: ["SUPPLIER"] });
    const supplier = supplierRes.json;
    record("setup: QA customer + supplier", Boolean(customer?.id && supplier?.id), `${customer?.name} / ${supplier?.name ?? JSON.stringify(supplierRes.json).slice(0, 120)}`);

    const service = items(await api("GET", "/products/catalog?pageSize=50&isSellable=true&isInventoryItem=false"))[0];
    const purchasable = items(await api("GET", "/products/catalog?pageSize=50&isPurchasable=true"))[0];
    const warehouses = items(await api("GET", "/warehouses?pageSize=50")).filter((w) => w.isActive !== false);
    const unitOf = (p) => p.unitId ?? p.unit?.id;

    async function confirmDocument(base, id) {
      for (const step of ["confirm", "submit", "approve", "confirm"]) {
        const res = await api("POST", `${base}/${id}/${step}`);
        const doc = await api("GET", `${base}/${id}`);
        if (doc.json.status === "CONFIRMED") return doc.json;
        if (res.status >= 400 && step === "confirm" && doc.json.status !== "DRAFT") return doc.json;
      }
      return (await api("GET", `${base}/${id}`)).json;
    }

    const flows = [];
    if (customer && (service ?? sellable[0])) {
      const p = service ?? sellable[0];
      const inv = await api("POST", "/sales/invoices", {
        partnerId: customer.id,
        currencyId: sar.id,
        referenceNumber: RUN,
        items: [{ productId: p.id, unitId: unitOf(p), warehouseId: warehouses[0]?.id, quantity: 1, unitPrice: 115 }],
      });
      const doc = inv.status < 300 ? await confirmDocument("/sales/invoices", inv.json.id) : null;
      flows.push({ kind: "sales", doc, pagePath: `/sales/invoices/${inv.json.id}`, apiBase: "/sales/invoices", button: "Receive Payment", voucherApi: "/financial-transactions/receipts", voucherKind: "CUSTOMER_RECEIPT", createError: inv.status >= 300 ? inv.json : null });
    }
    if (supplier?.id && purchasable) {
      const inv = await api("POST", "/purchasing/invoices", {
        partnerId: supplier.id,
        currencyId: sar.id,
        referenceNumber: RUN,
        items: [{ productId: purchasable.id, unitId: unitOf(purchasable), warehouseId: warehouses[0]?.id, quantity: 1, unitPrice: 87 }],
      });
      const doc = inv.status < 300 ? await confirmDocument("/purchasing/invoices", inv.json.id) : null;
      flows.push({ kind: "purchase", doc, pagePath: `/purchasing/purchase-invoices/${inv.json.id}`, apiBase: "/purchasing/invoices", button: "Record Payment", voucherApi: "/financial-transactions/payments", voucherKind: "SUPPLIER_PAYMENT", createError: inv.status >= 300 ? inv.json : null });
    }

    for (const flow of flows) {
      if (!flow.doc || flow.doc.status !== "CONFIRMED") {
        record(`${flow.kind}: setup confirmed invoice`, false, JSON.stringify(flow.createError ?? flow.doc).slice(0, 300));
        continue;
      }
      evidence(`${flow.kind}Invoice`, flow.doc.invoiceNumber);
      const { context, page } = await newPage(browser, { locale: "en" });
      await page.goto(`${BASE}${flow.pagePath}`, { waitUntil: "networkidle" });
      const btn = page.getByRole("button", { name: flow.button }).first();
      await btn.waitFor({ timeout: 60000 });
      await btn.click();
      await page.waitForURL(/\/new\?/, { timeout: 60000 });
      await settle(page, 2500);
      const crashed = await page.evaluate(() => /Application error|couldn.t load/i.test(document.body.innerText));
      record(`${flow.kind}: invoice → payment page opens without crash`, !crashed && page.errors.length === 0, page.errors.join(" | "));
      const field = page
        .locator("div")
        .filter({ has: page.locator("label", { hasText: /^Receiving Account$/ }) })
        .locator("button[role=combobox]")
        .last();
      if (/—/.test(await field.innerText())) {
        await field.click();
        await page.getByRole("option").filter({ hasText: receivingAccount.name }).first().click();
      }
      await page.screenshot({ path: `${OUT}/p2-${flow.kind}-voucher-ready.png` });
      const before = items(await api("GET", `${flow.voucherApi}?search=${flow.doc.invoiceNumber}&pageSize=5`)).length;
      await page.getByRole("button", { name: "Confirm", exact: true }).first().dblclick();
      await page.waitForURL(/\/payments\/[0-9a-f-]{36}$/, { timeout: 60000 }).catch(() => {});
      await settle(page);
      const voucherId = page.url().split("/").pop();
      await page.reload({ waitUntil: "networkidle" });
      await settle(page, 2000);
      await page.screenshot({ path: `${OUT}/p2-${flow.kind}-voucher-posted.png`, fullPage: true });
      const voucher = await api("GET", `${flow.voucherApi}/${voucherId}`);
      const invoiceAfter = await api("GET", `${flow.apiBase}/${flow.doc.id}`);
      const partnerVouchers = items(await api("GET", `${flow.voucherApi}?partnerId=${flow.doc.partnerId}&pageSize=50`)).filter(
        (v) => v.status !== "CANCELLED" && (v.allocations ?? []).some((a) => (a.salesInvoiceId ?? a.purchaseInvoiceId) === flow.doc.id),
      );
      const jes = await traceJournal(flow.voucherKind, voucherId);
      const je = jes[0] ? await balancedJe(jes[0].id) : { ok: false };
      record(
        `${flow.kind}: voucher CONFIRMED, invoice PAID, outstanding 0 after reload`,
        voucher.json.status === "CONFIRMED" && invoiceAfter.json.paymentStatus === "PAID" && Number(invoiceAfter.json.remainingBalance) === 0,
        `${voucher.json.transactionNumber} ${voucher.json.status} | ${flow.doc.invoiceNumber} ${invoiceAfter.json.paymentStatus} remaining=${invoiceAfter.json.remainingBalance}`,
      );
      record(`${flow.kind}: double-click created exactly one voucher`, partnerVouchers.length === 1 && before === 0, `${partnerVouchers.length} voucher(s)`);
      record(`${flow.kind}: voucher JE exposed + balanced`, jes.length === 1 && je.ok, `${je.entryNumber} dr=${je.dr} cr=${je.cr}`);
      evidence(`${flow.kind}Voucher`, `${BASE}${flow.kind === "sales" ? "/sales/payments/" : "/purchasing/payments/"}${voucherId}`);
      evidence(`${flow.kind}VoucherJe`, je.entryNumber);
      await page.goto(`${BASE}${flow.pagePath}`, { waitUntil: "networkidle" });
      await settle(page);
      const paidShown = await page.getByText(/^(Paid|Fully paid)$/i).first().isVisible().catch(() => false);
      record(`${flow.kind}: invoice page shows Paid, no crash`, paidShown && page.errors.length === 0, page.errors.join(" | "));
      await context.close();
    }

    // ================================================================
    // 3) Browse Products + top-positioned quick-create (desktop + mobile)
    // ================================================================
    for (const [label, viewport, path] of [
      ["desktop sales invoice", { width: 1440, height: 900 }, "/sales/invoices/new"],
      ["desktop purchase order", { width: 1440, height: 900 }, "/purchasing/purchase-orders/new"],
      ["mobile sales quotation", { width: 390, height: 844 }, "/sales/quotations/new"],
    ]) {
      const { context, page } = await newPage(browser, { ...viewport, locale: "en" });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await settle(page);
      const partyTrigger = page.getByRole("combobox").filter({ hasText: /Select (Customer|Supplier)/ }).filter({ visible: true }).first();
      await partyTrigger.click();
      const create = page.getByTestId("entity-combobox-create").filter({ visible: true }).first();
      await create.waitFor({ timeout: 20000 });
      const createBox = await create.boundingBox();
      const firstOption = await page.getByRole("option").first().boundingBox().catch(() => null);
      record(
        `${label}: "+ New" pinned at the top of the party dropdown`,
        Boolean(createBox) && (!firstOption || createBox.y <= firstOption.y),
        `create.y=${createBox?.y} firstOption.y=${firstOption?.y}`,
      );
      await page.keyboard.press("Escape");
      const browse = page.getByTestId("browse-products").filter({ visible: true }).first();
      await browse.waitFor({ timeout: 20000 });
      await browse.click();
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor();
      await settle(page, 1500);
      const boxes = dialog.getByRole("checkbox");
      const count = await boxes.count();
      const picks = Math.min(2, Math.max(0, count - 1));
      for (let i = 1; i <= picks; i++) await boxes.nth(i).check().catch(() => boxes.nth(i).click());
      await page.screenshot({ path: `${OUT}/p3-${label.replace(/\s+/g, "-")}-browser.png` });
      const fits = await noOverflow(page);
      await page.getByTestId("browse-products-add").click();
      await settle(page, 1000);
      const lineCount = await page.getByTestId("document-line").filter({ visible: true }).count();
      record(`${label}: Browse Products adds the selected products together`, picks > 0 && lineCount >= picks && fits, `selected=${picks} rows=${lineCount} noOverflow=${fits}`);
      await context.close();
    }

    // inline quick-create keeps the document and selects the new record
    {
      const { context, page } = await newPage(browser, { locale: "en" });
      await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
      await settle(page);
      await page.getByTestId("browse-products").filter({ visible: true }).first().click();
      const dialog = page.getByRole("dialog").last();
      await settle(page, 1500);
      await dialog.getByRole("checkbox").nth(1).check().catch(() => dialog.getByRole("checkbox").nth(1).click());
      await page.getByTestId("browse-products-add").click();
      await settle(page, 800);
      const name = `${RUN} Inline Customer`;
      await page.getByRole("combobox").filter({ hasText: "Select Customer" }).filter({ visible: true }).first().click();
      await page.locator("[cmdk-input]").last().fill(name);
      await page.getByTestId("entity-combobox-create").filter({ visible: true }).first().click();
      const modal = page.getByRole("dialog").last();
      const nameInput = modal.locator('input[name="name"]');
      if (!(await nameInput.inputValue())) await nameInput.fill(name);
      await modal.getByRole("button", { name: "Save", exact: true }).click();
      await modal.waitFor({ state: "hidden", timeout: 30000 });
      const selected = await page.getByRole("combobox").filter({ hasText: name }).count();
      const linesKept = await page.getByTestId("browse-products").count();
      record("inline create customer: selected automatically, document lines preserved", selected > 0 && linesKept > 0, name);
      await context.close();
    }

    // ================================================================
    // 4) Contextual preview + return navigation (invoice → JE → back)
    // ================================================================
    const salesFlow = flows.find((f) => f.kind === "sales" && f.doc?.status === "CONFIRMED");
    for (const [label, opts] of [
      ["desktop EN", { locale: "en" }],
      ["mobile AR", { locale: "ar", width: 390, height: 844 }],
    ]) {
      if (!salesFlow) break;
      const { context, page } = await newPage(browser, opts);
      const invoiceUrl = `${BASE}${salesFlow.pagePath}`;
      await page.goto(`${invoiceUrl}?tab=overview`, { waitUntil: "networkidle" });
      await settle(page, 1500);
      await page.evaluate(() => window.scrollTo(0, 240));
      await page.waitForTimeout(300);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const started = Date.now();
      const link = page.locator('[data-testid="related-record-link"][data-kind="JOURNAL_ENTRY"]').filter({ visible: true }).first();
      await link.waitFor({ timeout: 30000 });
      await link.click();
      const preview = page.getByTestId("record-preview");
      await preview.waitFor({ timeout: 20000 });
      await page.getByTestId("record-preview-journal").waitFor({ timeout: 20000 });
      const previewMs = Date.now() - started;
      const previewText = await page.getByRole("dialog").last().innerText();
      await page.screenshot({ path: `${OUT}/p4-${label.replace(/\s+/g, "-")}-je-preview.png` });
      record(`${label}: JE preview shows accounts, debit/credit and totals`, /JV-/.test(previewText) && /(Debit|مدين)/.test(previewText) && /(Balanced|متوازن)/.test(previewText), `${previewMs}ms`);
      await page.getByTestId("record-preview-open-full").click();
      await page.waitForURL(/\/finance\/journal-entries\//, { timeout: 30000 });
      await page.getByTestId("nav-trail").waitFor({ timeout: 20000 });
      await page.screenshot({ path: `${OUT}/p4-${label.replace(/\s+/g, "-")}-full-je.png` });
      await page.getByTestId("nav-trail-back").first().click();
      await page.waitForURL((url) => url.toString().startsWith(invoiceUrl), { timeout: 30000 });
      await settle(page, 2500);
      const scrollAfter = await page.evaluate(() => window.scrollY);
      const sameDoc = page.url().includes("tab=overview");
      record(
        `${label}: Open Full Record → Back returns to the same invoice (query + scroll kept)`,
        sameDoc && Math.abs(scrollAfter - scrollBefore) <= 40 && page.errors.length === 0,
        `url=${page.url()} scroll ${scrollBefore}→${scrollAfter} ${page.errors.join(" | ")}`,
      );
      await context.close();
    }

    // ================================================================
    // 5) Export follows the active language (xlsx + csv, ar vs en)
    // ================================================================
    const exportSummary = {};
    for (const locale of ["ar", "en"]) {
      const { context, page } = await newPage(browser, { locale });
      await page.goto(`${BASE}/reports/finance?report=trialBalance`, { waitUntil: "networkidle" });
      await settle(page, 2500);
      for (const format of ["xlsx", "csv"]) {
        await page.getByRole("button", { name: locale === "ar" ? "تصدير" : "Export" }).filter({ visible: true }).first().click();
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60000 }),
          page.getByRole("menuitem").filter({ hasText: format === "xlsx" ? /Excel|xlsx/i : /CSV/i }).first().click(),
        ]);
        const path = `${OUT}/trial-balance-${locale}.${format}`;
        await download.saveAs(path);
        exportSummary[`${locale}.${format}`] = path;
      }
      await context.close();
    }
    const ar = await readXlsx(exportSummary["ar.xlsx"]);
    const en = await readXlsx(exportSummary["en.xlsx"]);
    const flat = (sheet) => sheet.rows.map((r) => r.join(" | ")).join("\n");
    const numbers = (sheet) => sheet.rows.flat().filter((v) => typeof v === "number");
    const sum = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) * 100) / 100;
    record("xlsx AR: Arabic title/headers, right-to-left sheet", ar.rtl && /[؀-ۿ]/.test(flat(ar)) && /ميزان المراجعة/.test(flat(ar) + ar.name), `${ar.name} rtl=${ar.rtl}`);
    record("xlsx EN: English title/headers, left-to-right sheet", !en.rtl && /Trial Balance/i.test(flat(en) + en.name) && !/[؀-ۿ]{4,}.*مدين/.test(flat(en)), `${en.name} rtl=${en.rtl}`);
    record("xlsx AR vs EN: identical numeric values and totals", sum(numbers(ar)) === sum(numbers(en)) && numbers(ar).length === numbers(en).length, `${sum(numbers(ar))} vs ${sum(numbers(en))}`);
    const csvAr = readFileSync(exportSummary["ar.csv"], "utf8");
    const csvEn = readFileSync(exportSummary["en.csv"], "utf8");
    record("csv AR: UTF-8 BOM + readable Arabic headers; EN: English headers", csvAr.charCodeAt(0) === 0xfeff && /مدين/.test(csvAr) && /Debit/.test(csvEn), `${csvAr.split(/\r?\n/)[0].slice(0, 80)} || ${csvEn.split(/\r?\n/)[0].slice(0, 80)}`);
    evidence("exports", exportSummary);
    writeFileSync(`${OUT}/export-inspection.json`, JSON.stringify({ ar: ar.rows.slice(0, 12), en: en.rows.slice(0, 12) }, null, 1));

    // ================================================================
    // 6) Report summary colours + global table alignment
    // ================================================================
    for (const [label, opts] of [
      ["AR light desktop", { locale: "ar", theme: "light" }],
      ["EN dark desktop", { locale: "en", theme: "dark" }],
      ["AR mobile", { locale: "ar", width: 390, height: 844 }],
    ]) {
      const { context, page } = await newPage(browser, opts);
      await page.goto(`${BASE}/reports/finance?report=incomeStatement`, { waitUntil: "networkidle" });
      await settle(page, 2500);
      const tones = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-tone]")).map((el) => el.getAttribute("data-tone")),
      );
      const rowsTinted = await page.evaluate(
        () => document.querySelectorAll("tbody [class*='report-revenue'], tbody [class*='report-expense']").length,
      );
      const align = await alignmentReport(page);
      await page.screenshot({ path: `${OUT}/p6-income-${label.replace(/\s+/g, "-")}.png`, fullPage: true });
      record(
        `${label}: summary uses revenue/expense/result tones only in the summary`,
        tones.includes("revenue") && tones.includes("expense") && rowsTinted === 0,
        `tones=${[...new Set(tones)].join(",")} tintedRows=${rowsTinted}`,
      );
      record(`${label}: income statement numeric headers/body/footer aligned`, align.checked > 0 && align.issues.length === 0, `${align.checked} columns ${align.issues.join("; ")}`);
      record(`${label}: no horizontal page scroll`, await noOverflow(page));
      await page.goto(`${BASE}/reports/finance?report=trialBalance`, { waitUntil: "networkidle" });
      await settle(page, 2500);
      const tb = await alignmentReport(page);
      const balanced = await page.getByText(/Balanced|متوازن/).first().isVisible().catch(() => false);
      record(`${label}: trial balance aligned + Balanced indicator`, tb.checked > 0 && tb.issues.length === 0 && balanced, `${tb.checked} columns ${tb.issues.join("; ")}`);
      await context.close();
    }
    for (const [label, path] of [
      ["data table (sales invoices)", "/sales/invoices"],
      ["document lines (sales invoice)", salesFlow?.pagePath ?? "/sales/invoices"],
    ]) {
      for (const locale of ["ar", "en"]) {
        const { context, page } = await newPage(browser, { locale });
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        await settle(page, 2000);
        const align = await alignmentReport(page);
        record(`${label} ${locale}: numeric header/body alignment`, align.issues.length === 0, `${align.checked} columns ${align.issues.join("; ")}`);
        await context.close();
      }
    }

    // ================================================================
    // 7) Cash-flow movement view — reconciles, filters + export keep view
    // ================================================================
    {
      const range = `dateFrom=${new Date().getFullYear()}-01-01&dateTo=${new Date().toISOString().slice(0, 10)}`;
      const movement = await api("GET", `/accounting/reports/cash-flow?view=movement&${range}`);
      const activities = await api("GET", `/accounting/reports/cash-flow?view=activities&${range}`);
      const m = movement.json.totals ?? {};
      const a = activities.json.totals ?? {};
      const mOpen = Number(m.openingBalance ?? movement.json.openingBalance);
      const aOpen = Number(a.openingBalance ?? activities.json.openingBalance);
      const idM = Math.abs(mOpen + Number(m.netCashChange) - Number(m.closingBalance)) < 0.01;
      const idA = Math.abs(aOpen + Number(a.netCashChange) - Number(a.closingBalance)) < 0.01;
      const inOut = Math.abs(Number(m.inflows) - Number(m.outflows) - Number(m.netCashChange)) < 0.01;
      record("cash flow (movement): opening + net change = closing; inflows − outflows = net", idM && inOut, JSON.stringify(m));
      record("cash flow (activities): opening + net change = closing", idA, JSON.stringify(a));
      record("both views agree on opening / net change / closing", Math.abs(mOpen - aOpen) < 0.01 && Math.abs(Number(m.closingBalance) - Number(a.closingBalance)) < 0.01, `${mOpen}/${m.closingBalance} vs ${aOpen}/${a.closingBalance}`);
      const tbRes = await api("GET", `/accounting/reports/trial-balance?${range}`);
      evidence("cashFlowTotals", { movement: m, activities: a, trialBalanceStatus: tbRes.status });

      const { context, page } = await newPage(browser, { locale: "en" });
      await page.goto(`${BASE}/reports/finance?report=cashFlow&view=movement`, { waitUntil: "networkidle" });
      await settle(page, 2500);
      const text = await page.locator("main").last().innerText();
      await page.screenshot({ path: `${OUT}/p7-cash-flow-movement.png`, fullPage: true });
      record("movement view shows opening, inflows, outflows, net change, closing", ["Opening", "Inflow", "Outflow", "Net", "Closing"].every((w) => new RegExp(w, "i").test(text)), "");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        (async () => {
          await page.getByRole("button", { name: "Export" }).filter({ visible: true }).first().click();
          await page.getByRole("menuitem").filter({ hasText: /CSV/i }).first().click();
        })(),
      ]);
      const csvPath = `${OUT}/cash-flow-movement.csv`;
      await download.saveAs(csvPath);
      const csv = readFileSync(csvPath, "utf8");
      record("export keeps the selected view (movement)", /movement/i.test(download.suggestedFilename()) && /Inflow/i.test(csv), download.suggestedFilename());
      const align = await alignmentReport(page);
      record("movement view table aligned", align.issues.length === 0, `${align.checked} columns ${align.issues.join("; ")}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  record("script completed without an exception", false, error.stack ?? String(error));
}
const failed = results.filter((r) => !r.pass);
writeFileSync(
  `${OUT}/report.json`,
  JSON.stringify({ base: BASE, run: RUN, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results, evidence: evidenceMap }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} passed → ${OUT}/report.json`);
process.exitCode = failed.length ? 1 : 0;
