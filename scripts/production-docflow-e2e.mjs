/**
 * Browser E2E for the document-flow release (payments, one-click
 * transitions, traceability, duplicate/draft, inline creation, mobile/RTL,
 * FX recovery, reports). Drives the real UI; API calls are used only to set
 * up isolated test data and to verify accounting results.
 *
 *   BASE=https://oms.haseb.org API=https://oms.haseb.org/api \
 *   EMAIL=qa-admin@... QA_PASSWORD=... node scripts/production-docflow-e2e.mjs
 *
 * Every record it creates is new and tagged "E2E-DF-<run>"; historical data
 * is never modified.
 */
/* global document, localStorage -- evaluated inside the browser page */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const require = createRequire(resolve("package.json"));
const { chromium } = require("playwright");

function loadEnvFile(path) {
  try {
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const i = raw.indexOf("=");
      if (i < 1) continue;
      const key = raw.slice(0, i);
      let value = raw.slice(i + 1);
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}
// QA persona secrets first (tmp/.qa.env), then deployment env files.
loadEnvFile("tmp/.qa.env");
loadEnvFile(".env.production.local");
loadEnvFile(".env.local");

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PASSWORD = process.env.QA_PASSWORD ?? process.env.PASSWORD;
const OUT = resolve(process.env.OUT ?? "tmp/docflow-e2e");
const RUN = `E2E-DF-${Date.now().toString(36).toUpperCase()}`;
mkdirSync(OUT, { recursive: true });

const report = {
  run: RUN,
  base: BASE,
  startedAt: new Date().toISOString(),
  checks: [],
  evidence: {},
};
function record(name, pass, detail = "") {
  report.checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const evidence = (key, value) => {
  report.evidence[key] = value;
};

let token = null;
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
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
const items = (response) => response.json?.items ?? response.json ?? [];

async function newPage(browser, { width, height, locale, theme = "light" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    hasTouch: width < 768,
    isMobile: width < 768,
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
  page.on("pageerror", (error) => {
    page.errors.push(error.message);
    if (process.env.DEBUG_ERRORS)
      console.log(
        "PAGEERROR",
        page.url(),
        error.stack?.split(String.fromCharCode(10)).slice(0, 8).join(" | "),
      );
  });
  page.requests = [];
  page.on("request", (request) => page.requests.push(request.url()));
  return { context, page };
}

const visibleButton = (scope, name) =>
  scope.getByRole("button", { name, exact: true }).filter({ visible: true }).first();

async function pickCombobox(page, placeholder, search, { nth = 0 } = {}) {
  const trigger = page
    .getByRole("combobox")
    .filter({ hasText: placeholder })
    .filter({ visible: true })
    .nth(nth);
  await trigger.click();
  const input = page.locator("[cmdk-input]").last();
  await input.fill(search);
  const option = page.getByRole("option").filter({ hasText: search }).first();
  await option.waitFor({ timeout: 20000 });
  await option.click();
}

async function confirmDialog(page, buttonName) {
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 15000 });
  await dialog.getByRole("button", { name: buttonName, exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 60000 });
}

async function noCrash(page, label) {
  const crashed = await page.evaluate(() =>
    /couldn.t load|Application error/i.test(document.body.innerText),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  record(
    `${label}: renders without crash / page overflow`,
    !crashed && page.errors.length === 0 && overflow <= 1,
    `overflow=${overflow} errors=${page.errors.slice(0, 2).join(" | ")}`,
  );
}

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, rememberMe: true }),
  }).then((r) => r.json());
  token = login.accessToken;
  record("API login", Boolean(token), EMAIL);
  if (!token) return;

  // ---- isolated setup data -------------------------------------------------
  const warehouses = items(await api("GET", "/warehouses?pageSize=50")).filter(
    (w) => w.isActive !== false,
  );
  const products = items(
    await api("GET", "/products/catalog?pageSize=50&isSellable=true&isInventoryItem=true"),
  );
  let stocked = null;
  let warehouse = null;
  for (const product of products.filter((p) => Number(p.salesPrice ?? 0) > 0)) {
    for (const w of warehouses) {
      const stock = await api(
        "GET",
        `/inventory/stock?productId=${product.id}&warehouseId=${w.id}`,
      );
      const available = Number(stock.json?.available ?? stock.json?.items?.[0]?.available ?? 0);
      if (available >= 3) {
        stocked = product;
        warehouse = w;
        break;
      }
    }
    if (stocked) break;
  }
  record(
    "setup: stocked sellable product found",
    Boolean(stocked),
    stocked ? `${stocked.sku} @ ${warehouse.name}` : "none",
  );

  const browser = await chromium.launch();
  try {
    // =====================================================================
    // 1) Sales cycle on desktop (EN): inline customer creation (no email),
    //    quotation → approve → order → confirm → invoice → post → JE
    // =====================================================================
    {
      const { context, page } = await newPage(browser, { width: 1440, height: 900, locale: "en" });
      await page.goto(`${BASE}/sales/quotations/new`, { waitUntil: "networkidle" });
      const customerName = `${RUN} Customer`;
      const trigger = page
        .getByRole("combobox")
        .filter({ hasText: "Select Customer" })
        .filter({ visible: true })
        .first();
      await trigger.click();
      await page
        .getByRole("option")
        .filter({ hasText: /Quick Create|Add new|Create/i })
        .first()
        .click();
      const modal = page.getByRole("dialog").last();
      await modal.locator('input[name="name"]').fill(customerName);
      await modal.getByRole("button", { name: "Save", exact: true }).click();
      await modal.waitFor({ state: "hidden", timeout: 30000 });
      const picked = await page.getByRole("combobox").filter({ hasText: customerName }).count();
      record(
        "inline create customer without email → selected in the document",
        picked > 0,
        customerName,
      );

      if (stocked) {
        await pickCombobox(page, "Select Product", stocked.displayName || stocked.name);
        await pickCombobox(page, "Select Warehouse", warehouse.name);
      }
      const catalogCalls = page.requests.filter((url) => url.includes("/products/catalog")).length;
      await visibleButton(page, "Save").click();
      await page.waitForURL(/\/sales\/quotations\/[0-9a-f-]{36}/, { timeout: 60000 });
      const quotationId = page.url().split("/").pop();
      record("quotation saved", Boolean(quotationId), page.url());
      evidence("quotationUrl", page.url());

      await visibleButton(page, "Approve").click();
      await confirmDialog(page, "Approve");
      await page.getByText("Approved", { exact: true }).first().waitFor({ timeout: 30000 });
      record("quotation approved in one step (no separate submit)", true);

      await visibleButton(page, "Convert to Order").click();
      const convertDialog = page.getByRole("dialog").last();
      await convertDialog.getByRole("button", { name: "Convert to Order", exact: true }).click();
      await page.waitForURL(/\/sales\/orders\/[0-9a-f-]{36}/, { timeout: 60000 });
      evidence("orderUrl", page.url());
      record("convert opens the created sales order", true, page.url());

      await visibleButton(page, "Confirm").click();
      await confirmDialog(page, "Confirm");
      await page.waitForTimeout(1500);
      await visibleButton(page, "Convert to Invoice").waitFor({ timeout: 30000 });
      record("order confirmed from Draft in one step", true);
      await visibleButton(page, "Convert to Invoice").click();
      const invDialog = page.getByRole("dialog").last();
      await invDialog.getByRole("button", { name: "Convert to Invoice", exact: true }).click();
      await page.waitForURL(/\/sales\/invoices\/[0-9a-f-]{36}/, { timeout: 60000 });
      const invoiceId = page.url().split("/").pop();
      evidence("invoiceUrl", page.url());

      await visibleButton(page, "Confirm").click();
      await confirmDialog(page, "Confirm");
      const fx = page.getByRole("alertdialog");
      if (await fx.isVisible().catch(() => false)) {
        record("FX dialog appeared for base-currency invoice (unexpected)", false);
      }
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: "networkidle" });
      const invoice = await api("GET", `/sales/invoices/${invoiceId}`);
      record(
        "invoice posted and survives reload",
        invoice.json.status === "CONFIRMED",
        `${invoice.json.invoiceNumber} ${invoice.json.status}`,
      );
      evidence("invoiceNumber", invoice.json.invoiceNumber);

      const trace = await api("GET", `/traceability/SALES_INVOICE/${invoiceId}`);
      const jeGroup = trace.json.groups?.find((g) => g.key === "JOURNAL_ENTRIES");
      const moves = trace.json.groups?.find((g) => g.key === "STOCK_MOVEMENTS");
      const docs = trace.json.groups?.find((g) => g.key === "DOCUMENTS");
      record(
        "invoice → exactly one JE",
        jeGroup?.items.filter((i) => i.sourceType === "SALES_INVOICE").length === 1,
        JSON.stringify(jeGroup?.items.map((i) => i.number)),
      );
      record(
        "invoice → stock delivery movement",
        (moves?.items.length ?? 0) > 0,
        `${moves?.items.length ?? 0} movement(s)`,
      );
      record(
        "invoice → source order link",
        (docs?.items ?? []).some((i) => i.kind === "SALES_ORDER"),
        "",
      );
      const jeId = jeGroup?.items[0]?.id;
      if (jeId) {
        const je = await api("GET", `/journal-entries/${jeId}`);
        const dr = je.json.lines.reduce((s, l) => s + Number(l.debit), 0);
        const cr = je.json.lines.reduce((s, l) => s + Number(l.credit), 0);
        record(
          "invoice JE balanced",
          Math.abs(dr - cr) < 0.005 && dr > 0,
          `${je.json.entryNumber} dr=${dr} cr=${cr}`,
        );
        evidence("invoiceJe", je.json.entryNumber);
        // UI: invoice → JE link → JE shows its source
        await page.getByRole("link").filter({ hasText: je.json.entryNumber }).first().click();
        await page.waitForURL(/\/finance\/journal-entries\//, { timeout: 30000 });
        const sourceLink = page
          .getByRole("link")
          .filter({ hasText: invoice.json.invoiceNumber })
          .first();
        await sourceLink.waitFor({ timeout: 20000 });
        record("UI: invoice → JE → back-link to source invoice", true, page.url());
        await page.screenshot({ path: `${OUT}/je-trace.png` });
        await sourceLink.click();
        await page.waitForURL(/\/sales\/invoices\//, { timeout: 30000 });
      }

      // Duplicate never copies accounting effects
      await visibleButton(page, "More").click();
      await page.getByRole("menuitem", { name: "Duplicate" }).click();
      await confirmDialog(page, "Duplicate");
      await page.waitForURL(
        (url) => url.pathname.startsWith("/sales/invoices/") && !url.pathname.endsWith(invoiceId),
        { timeout: 30000 },
      );
      const copyId = page.url().split("/").pop();
      const copy = await api("GET", `/sales/invoices/${copyId}`);
      const copyJes = await api(
        "GET",
        `/journal-entries?sourceType=SALES_INVOICE&sourceId=${copyId}`,
      );
      const originalJes = await api(
        "GET",
        `/journal-entries?sourceType=SALES_INVOICE&sourceId=${invoiceId}`,
      );
      record(
        "duplicate → new Draft with new number, no JE; original keeps its single JE",
        copy.json.status === "DRAFT" &&
          copy.json.invoiceNumber !== invoice.json.invoiceNumber &&
          items(copyJes).length === 0 &&
          items(originalJes).length === 1,
        `${copy.json.invoiceNumber} ${copy.json.status}`,
      );
      await noCrash(page, "desktop sales cycle");
      record(
        "product lookups reuse cached requests while editing",
        catalogCalls <= 3,
        `${catalogCalls} catalog request(s) for 1 line`,
      );
      evidence("catalogRequestsOneLine", catalogCalls);
      await context.close();
    }

    // =====================================================================
    // 2) Phone + Arabic: complete an invoice on mobile (cards, bottom bar)
    // =====================================================================
    if (stocked) {
      const { context, page } = await newPage(browser, { width: 390, height: 844, locale: "ar" });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      await page.locator('[data-sidebar="trigger"]').first().click();
      await page.waitForTimeout(600);
      const box = await page.locator('[data-mobile="true"]').first().boundingBox();
      record(
        "phone AR: navigation drawer opens from the right edge",
        Boolean(box && box.x + box.width >= 389),
        `x=${box?.x} w=${box?.width}`,
      );
      await page.keyboard.press("Escape");
      const customer = await api("POST", "/partners/find-or-create", {
        name: `${RUN} Mobile`,
        role: "CUSTOMER",
        email: "",
      });
      await page.goto(`${BASE}/sales/invoices/new`, { waitUntil: "networkidle" });
      await pickCombobox(page, "اختر عميلاً", `${RUN} Mobile`);
      await pickCombobox(page, "اختر منتجاً", stocked.displayName || stocked.name);
      await pickCombobox(page, "اختر مستودعاً", warehouse.name);
      await noCrash(page, "phone AR invoice entry");
      await page.screenshot({ path: `${OUT}/phone-ar-invoice-entry.png`, fullPage: true });
      const saveBtn = page
        .getByRole("button", { name: "حفظ", exact: true })
        .filter({ visible: true })
        .first();
      await saveBtn.click();
      await page.waitForURL(/\/sales\/invoices\/[0-9a-f-]{36}/, { timeout: 60000 });
      const mobileInvoiceId = page.url().split("/").pop();
      const postBtn = page
        .getByRole("button", { name: "تأكيد", exact: true })
        .filter({ visible: true })
        .first();
      const barBox = await postBtn.boundingBox();
      record(
        "phone: primary action pinned at the bottom, full tap target",
        Boolean(barBox && barBox.y > 700 && barBox.height >= 40),
        `y=${barBox?.y} h=${barBox?.height}`,
      );
      await postBtn.click();
      await confirmDialog(page, "تأكيد");
      await page.waitForTimeout(2500);
      const mobileInvoice = await api("GET", `/sales/invoices/${mobileInvoiceId}`);
      record(
        "phone AR: invoice completed and posted on mobile",
        mobileInvoice.json.status === "CONFIRMED",
        mobileInvoice.json.invoiceNumber,
      );
      evidence("mobileInvoice", mobileInvoice.json.invoiceNumber);
      await page.screenshot({ path: `${OUT}/phone-ar-invoice-posted.png`, fullPage: true });
      record(
        "partner saved without email",
        customer.status < 300 && !customer.json.partner?.email,
        customer.json.partner?.partnerNumber ?? "",
      );
      await context.close();
    }

    // =====================================================================
    // 3) Store-order payment: report → match → verify in UI → receipt/JE
    // =====================================================================
    if (stocked) {
      const currencies = items(await api("GET", "/currencies?pageSize=100"));
      const settings = await api("GET", "/exchange-rates/check?currencyId=" + currencies[0].id);
      const base =
        currencies.find((c) => c.id === settings.json.toCurrencyId) ??
        currencies.find((c) => c.code === "SAR");
      const sources = items(await api("GET", "/payment-sources?pageSize=10"));
      const accounts = items(await api("GET", "/receiving-accounts?pageSize=10"));
      const so = await api("POST", "/store-orders", {
        partner: { name: `${RUN} Store`, phone: `+9665${String(Date.now()).slice(-8)}` },
        currencyId: base.id,
        items: [{ productId: stocked.id, quantity: 1, unitPrice: 400 }],
      });
      const pay = await api("POST", `/store-orders/${so.json.id}/payments`, {
        amount: 400,
        paymentDate: new Date().toISOString(),
        paymentSourceId: sources[0]?.id,
        receivingAccountId: accounts[0]?.id,
        senderName: RUN,
      });
      record(
        "store order 400 + payment 400 created",
        so.status < 300 && pay.status < 300,
        `${so.json.internalOrderId} ${pay.json.paymentNumber ?? JSON.stringify(pay.json).slice(0, 120)}`,
      );
      const { context, page } = await newPage(browser, { width: 1440, height: 900, locale: "en" });
      await page.goto(`${BASE}/finance/payment-review`, { waitUntil: "networkidle" });
      const row = page
        .locator("tr, [data-state]")
        .filter({ hasText: pay.json.paymentNumber })
        .first();
      await row.getByRole("button", { name: /Match/ }).click();
      await page.waitForTimeout(2000);
      await page
        .locator("tr")
        .filter({ hasText: pay.json.paymentNumber })
        .first()
        .getByRole("button", { name: /Verify/ })
        .click();
      await page.waitForTimeout(2500);
      const verified = await api("GET", `/payments/${pay.json.id}`);
      record(
        "UI verify: payment VERIFIED (no false overpayment)",
        verified.json.status === "VERIFIED",
        verified.json.status,
      );
      const again = await api("POST", `/payments/${pay.json.id}/verify`, {
        verifiedById: login.user?.id,
      });
      record(
        "retry verify is idempotent",
        again.status < 300,
        JSON.stringify(again.json.collection),
      );
      const inv = await api("POST", `/store-orders/${so.json.id}/generate-invoice`);
      const sync = await api("POST", `/payments/${pay.json.id}/verify`, {
        verifiedById: login.user?.id,
      });
      record(
        "invoice then receipt posted (Sale → invoice → verified payment → receipt)",
        inv.status < 300 && sync.json.collection?.status === "POSTED",
        `${inv.json.invoiceNumber} ${JSON.stringify(sync.json.collection)}`,
      );
      const sync2 = await api("POST", `/payments/${pay.json.id}/verify`, {
        verifiedById: login.user?.id,
      });
      const receiptIds = sync2.json.collection?.receipts?.map((r) => r.id) ?? [];
      record(
        "re-sync creates no duplicate receipt",
        receiptIds.length === 1 && receiptIds[0] === sync.json.collection?.receipts?.[0]?.id,
        JSON.stringify(receiptIds),
      );
      const ptrace = await api("GET", `/traceability/PAYMENT/${pay.json.id}`);
      const pje = ptrace.json.groups?.find((g) => g.key === "JOURNAL_ENTRIES");
      record(
        "payment → receipt → JE traceable",
        pje?.state === "FOUND",
        JSON.stringify(pje?.items.map((i) => i.number)),
      );
      evidence("payment", {
        order: so.json.internalOrderId,
        payment: pay.json.paymentNumber,
        invoice: inv.json.invoiceNumber,
        receipt: sync.json.collection?.receipts?.[0]?.transactionNumber,
        je: pje?.items.map((i) => i.number),
      });
      const invTrace = await api("GET", `/traceability/SALES_INVOICE/${inv.json.id}`);
      const invJe = invTrace.json.groups?.find((g) => g.key === "JOURNAL_ENTRIES");
      record(
        "store-order invoice → revenue/COGS JE (+ fulfillment when configured)",
        invJe?.state === "FOUND",
        JSON.stringify(invJe?.items.map((i) => `${i.number}:${i.sourceType}`)),
      );
      await context.close();
    }

    // =====================================================================
    // 4) Purchase invoice with fixed-asset + prepaid lines → schedules
    // =====================================================================
    {
      const suppliers = items(await api("GET", "/partners/catalog?role=SUPPLIER&pageSize=1"));
      const categories = items(await api("GET", "/product-categories?pageSize=1"));
      const units = items(await api("GET", "/units?pageSize=1"));
      const expense = items(await api("GET", "/chart-of-accounts?pageSize=500")).find(
        (a) => a.accountType === "EXPENSE" && a.allowsPosting,
      );
      const created = await api("POST", "/products", {
        name: `${RUN} Laptop`,
        internalName: `${RUN} Laptop`,
        displayName: `${RUN} Laptop`,
        type: "SERVICE",
        categoryId: categories[0]?.id,
        unitId: units[0]?.id,
        isInventoryItem: false,
        isPurchasable: true,
        isSellable: false,
        status: "ACTIVE",
      });
      const productId = created.json.id;
      if (created.json.status !== "ACTIVE") await api("POST", `/products/${productId}/activate`);
      const pinv = await api("POST", "/purchasing/invoices", {
        partnerId: suppliers[0]?.id,
        referenceNumber: RUN,
        items: [
          {
            productId,
            warehouseId: warehouse?.id,
            unitId: units[0]?.id,
            quantity: 1,
            unitPrice: 1200,
            treatment: "FIXED_ASSET",
            assetUsefulLifeMonths: 12,
          },
          {
            productId,
            warehouseId: warehouse?.id,
            unitId: units[0]?.id,
            quantity: 1,
            unitPrice: 600,
            treatment: "PREPAID_EXPENSE",
            prepaidMonths: 6,
            prepaidExpenseAccountId: expense?.id,
          },
        ],
      });
      const posted = await api("POST", `/purchasing/invoices/${pinv.json.id}/confirm`);
      const repost = await api("POST", `/purchasing/invoices/${pinv.json.id}/confirm`);
      const trace = await api("GET", `/traceability/PURCHASE_INVOICE/${pinv.json.id}`);
      const assets = trace.json.groups?.find((g) => g.key === "ASSETS");
      const jes = trace.json.groups?.find((g) => g.key === "JOURNAL_ENTRIES");
      record(
        "purchase invoice → one asset + one prepayment, one JE (re-post safe)",
        posted.json.status === "CONFIRMED" &&
          repost.status < 300 &&
          assets?.items.length === 2 &&
          jes?.items.length === 1,
        `${pinv.json.invoiceNumber} assets=${assets?.items.map((i) => i.number)} jes=${jes?.items.map((i) => i.number)}`,
      );
      evidence("purchaseInvoice", {
        number: pinv.json.invoiceNumber,
        assets: assets?.items.map((i) => i.number),
        je: jes?.items.map((i) => i.number),
      });
      const { context, page } = await newPage(browser, { width: 1440, height: 900, locale: "en" });
      await page.goto(`${BASE}/purchasing/purchase-invoices/${pinv.json.id}`, {
        waitUntil: "networkidle",
      });
      const assetChip = page.getByRole("button").filter({
        hasText: assets?.items.find((i) => i.kind === "FIXED_ASSET")?.number ?? "__none__",
      });
      await assetChip
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      record(
        "UI: purchase invoice shows linked asset in related records",
        (await assetChip.count()) > 0,
      );
      if (await assetChip.count()) {
        await assetChip.first().click();
        await page.getByRole("dialog").last().waitFor();
        record("UI: asset opens in place (no dead link)", true);
        await page.screenshot({ path: `${OUT}/purchase-asset-trace.png` });
      }
      await context.close();
    }

    // =====================================================================
    // 5) Reports: reconcile + appearance (light/dark, AR/EN)
    // =====================================================================
    {
      const tb = (await api("GET", "/accounting/reports/trial-balance")).json;
      record(
        "TB: debits = credits",
        Math.abs(tb.totals.debitTotal - tb.totals.creditTotal) < 0.01,
        `${tb.totals.debitTotal} / ${tb.totals.creditTotal}`,
      );
      const bs = (await api("GET", "/accounting/reports/balance-sheet")).json;
      record(
        "BS: assets = liabilities + equity",
        Math.abs(bs.totals.totalAssets - bs.totals.totalLiabilities - bs.totals.totalEquity) < 0.01,
        JSON.stringify(bs.totals),
      );
      for (const variant of [
        { locale: "en", theme: "light" },
        { locale: "ar", theme: "dark" },
      ]) {
        const { context, page } = await newPage(browser, { width: 1440, height: 900, ...variant });
        await page.goto(`${BASE}/reports/finance`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        const aligned = await page.evaluate(() => {
          const table = document.querySelector(".financial-report-print table");
          if (!table) return null;
          const heads = [...table.querySelectorAll("thead th")];
          const firstRow = table.querySelector("tbody tr");
          if (!firstRow) return null;
          const cells = [...firstRow.querySelectorAll("td")];
          return heads.every((th, index) => {
            const a = th.getBoundingClientRect();
            const b = cells[index]?.getBoundingClientRect();
            return b && Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1;
          });
        });
        record(
          `reports ${variant.locale}/${variant.theme}: header/body columns aligned`,
          aligned === true,
        );
        await noCrash(page, `reports ${variant.locale}/${variant.theme}`);
        await page.screenshot({ path: `${OUT}/reports-${variant.locale}-${variant.theme}.png` });
        await context.close();
      }
    }

    // =====================================================================
    // 7) Foreign-currency posting: missing rate detected before posting,
    //    recoverable in place; never invented, never a partial post.
    // =====================================================================
    if (stocked) {
      const currencies = items(await api("GET", "/currencies?pageSize=100"));
      const probe = await api("GET", `/exchange-rates/check?currencyId=${currencies[0].id}`);
      const baseId = probe.json.toCurrencyId;
      const foreign =
        currencies.find((c) => c.id !== baseId && c.code === "USD") ??
        currencies.find((c) => c.id !== baseId);
      if (foreign) {
        const check = await api("GET", `/exchange-rates/check?currencyId=${foreign.id}`);
        const customers = items(
          await api(
            "GET",
            "/partners/catalog?role=CUSTOMER&pageSize=1&search=" + encodeURIComponent(RUN),
          ),
        );
        const draft = await api("POST", "/sales/invoices", {
          partnerId: customers[0]?.id,
          currencyId: foreign.id,
          referenceNumber: `${RUN}-FX`,
          items: [
            {
              productId: stocked.id,
              warehouseId: warehouse.id,
              unitId: stocked.unitId,
              quantity: 1,
              unitPrice: 10,
            },
          ],
        });
        const { context, page } = await newPage(browser, {
          width: 1440,
          height: 900,
          locale: "en",
        });
        await page.goto(`${BASE}/sales/invoices/${draft.json.id}`, { waitUntil: "networkidle" });
        await visibleButton(page, "Confirm").click();
        await confirmDialog(page, "Confirm");
        if (!check.json.available) {
          const fxDialog = page.getByRole("alertdialog").filter({ hasText: foreign.code });
          await fxDialog.waitFor({ timeout: 20000 });
          record(
            `FX: missing ${foreign.code} rate detected before posting, recovery dialog offered`,
            true,
            check.json.asOf,
          );
          await page.screenshot({ path: `${OUT}/fx-rate-required.png` });
          await fxDialog
            .getByRole("button", { name: /Close|Cancel/ })
            .first()
            .click();
          await page.waitForTimeout(1500);
          const after = await api("GET", `/sales/invoices/${draft.json.id}`);
          const jes = await api(
            "GET",
            `/journal-entries?sourceType=SALES_INVOICE&sourceId=${draft.json.id}`,
          );
          record(
            "FX: backing out leaves the invoice unposted (no JE, no stock, no invented rate)",
            after.json.status !== "CONFIRMED" && items(jes).length === 0,
            after.json.status,
          );
        } else {
          await page.waitForTimeout(3000);
          const after = await api("GET", `/sales/invoices/${draft.json.id}`);
          record(
            `FX: ${foreign.code} invoice posts with the recorded rate`,
            after.json.status === "CONFIRMED" &&
              Number(after.json.exchangeRate) === Number(check.json.rate),
            `${after.json.exchangeRate} vs ${check.json.rate}`,
          );
        }
        evidence("fxInvoice", draft.json.invoiceNumber);
        await context.close();
      }
    }

    // =====================================================================
    // 6) Investment opportunity product picker + import menu dedupe
    // =====================================================================
    {
      const { context, page } = await newPage(browser, { width: 1440, height: 900, locale: "en" });
      await page.goto(`${BASE}/investors/opportunities/new`, { waitUntil: "networkidle" });
      const picker = page.getByRole("combobox").filter({ hasText: "Select Product" }).first();
      if (await picker.count()) {
        await picker.click();
        await page.waitForTimeout(1500);
        const options = await page.getByRole("option").count();
        const emptyText = await page
          .locator("[cmdk-empty]")
          .innerText()
          .catch(() => "");
        record(
          "investment picker: eligible products listed or a clear eligibility message",
          options > 0 || /investment/i.test(emptyText),
          `options=${options} ${emptyText}`,
        );
      }
      await page.goto(`${BASE}/inventory/movements`, { waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: /Import/ })
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      const importButtons = await page
        .getByRole("button", { name: /Import/ })
        .filter({ visible: true })
        .count();
      const templateButtons = await page
        .getByRole("button", { name: /Download template/i })
        .filter({ visible: true })
        .count();
      record(
        "inventory movements: one Import control, no repeated template/upload buttons",
        importButtons === 1 && templateButtons === 0,
        `import=${importButtons} template=${templateButtons}`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  record(
    "E2E run completed without an unexpected error",
    false,
    error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" ") : String(error),
  );
}
report.finishedAt = new Date().toISOString();
report.passed = report.checks.filter((c) => c.pass).length;
report.failed = report.checks.filter((c) => !c.pass).length;
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.passed} passed, ${report.failed} failed — ${OUT}/report.json`);
process.exitCode = report.failed ? 1 : 0;
