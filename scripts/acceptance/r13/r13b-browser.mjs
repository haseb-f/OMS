#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R13b — browser acceptance: Expenses screen on expense vouchers (draft →
 * Confirm & post → Reverse, "Pay invoice instead", ar/en, 390 px), fixed asset
 * Dispose → supplier credit, prepaid "Cancel with refund" / "Recognize
 * remaining now", purchase-return refusal of an asset line with posted
 * depreciation, tax "recoverable" flag, payment methods + sales Live smoke.
 *
 *   BASE=http://localhost:3001 API=http://localhost:3005 node scripts/acceptance/r13/r13b-browser.mjs
 *
 * Login: admin@oms.local; the password is read at runtime from OMS_PW or the
 * dev seed (apps/api/prisma/seed.ts) — never written to evidence.
 * Demo data is tagged R13B<digits> (created via the API).
 * Note: the setup runs the global depreciation run up to the end of last month
 * (posts every due period of every capitalized asset in the local database).
 * Evidence: specs/round13-accounting-reporting/evidence/r13b-*.png + r13b-browser.{json,md}
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.env.BASE ?? "http://localhost:3001").replace(/\/$/, "");
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
const SHOTS = process.env.SHOTS !== "0";
const OUT = process.env.OUT ?? "specs/round13-accounting-reporting/evidence";
const EMAIL = process.env.OMS_EMAIL ?? "admin@oms.local";
mkdirSync(OUT, { recursive: true });
const PW =
  process.env.OMS_PW ??
  readFileSync("apps/api/prisma/seed.ts", "utf8").match(/bcrypt\.hash\('([^']+)'/)?.[1];
if (!PW) throw new Error("No password: set OMS_PW or keep the dev seed readable");

const TAG = "R13B" + Date.now().toString().slice(-6);
const results = [];
const notCovered = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 300) : ""}`,
  );
};
const shots = [];
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${OUT}/r13b-${name}.png` });
  shots.push(`r13b-${name}.png`);
};
/** Runs one journey; an exception is a FAIL of that journey, never an abort of the run. */
async function journey(name, fn) {
  // ONLY="E1,P" runs just the journeys whose name starts with one of those prefixes (debugging).
  if (process.env.ONLY && !process.env.ONLY.split(",").some((p) => name.startsWith(p))) return;
  try {
    await fn();
  } catch (error) {
    check(`${name}: journey completed without an exception`, false, error?.message ?? error);
  }
}

// ───────── API helpers ─────────
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  });
  return (await r.json()).accessToken;
}
const T = await login();
const call = async (m, p, b) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { Authorization: "Bearer " + T, "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* empty */
  }
  return { s: r.status, j };
};
const must = async (m, p, b) => {
  const r = await call(m, p, b);
  if (r.s >= 300) throw new Error(`${m} ${p} → ${r.s} ${JSON.stringify(r.j).slice(0, 300)}`);
  return r.j;
};
const items = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
const num = (v) => Number(v ?? 0);
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.005;
const isoDay = (d) => String(d ?? "").slice(0, 10);
const balanced = (e) =>
  near(
    (e.lines ?? []).reduce((s, l) => s + num(l.debit), 0),
    (e.lines ?? []).reduce((s, l) => s + num(l.credit), 0),
  ) && (e.lines ?? []).length >= 2;
const entriesFor = async (sourceType, sourceId) =>
  items(
    await must("GET", `/journal-entries?sourceType=${sourceType}&sourceId=${sourceId}&pageSize=20`),
  ).filter((e) => e.sourceType === sourceType && e.sourceId === sourceId);
const today = new Date().toISOString().slice(0, 10);
const now = new Date();
const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  .toISOString()
  .slice(0, 10);
/** Business day ("YYYY-MM-DD", Africa/Cairo) of a stored timestamp. */
const businessDay = (v) =>
  v ? new Date(v).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }) : "";
const back = new Date(now.getTime() - 3 * 86400000);
const expenseDate = back.toISOString().slice(0, 10);
const expenseDateLabel = back.toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  .toISOString()
  .slice(0, 10);

// ───────── demo data (tagged, via the API) ─────────
const setup = {};
try {
  const expenseAccounts = items(
    await must("GET", "/chart-of-accounts?accountType=EXPENSE&postingOnly=true&pageSize=1000"),
  ).filter((a) => a.accountType === "EXPENSE" && a.allowsPosting && !a.deletedAt);
  const sibling = expenseAccounts.find((a) => a.parentAccountId) ?? expenseAccounts[0];
  setup.expenseAccount = await must("POST", "/chart-of-accounts", {
    name: `${TAG} مصروفات قرطاسية`,
    nameEn: `${TAG} Stationery expense`,
    accountType: "EXPENSE",
    parentAccountId: sibling?.parentAccountId ?? undefined,
    allowsPosting: true,
    description: `${TAG} browser acceptance`,
  });
  const ras = items(await must("GET", "/receiving-accounts?pageSize=200")).filter(
    (r) => r.isActive && r.chartOfAccountId && !r.currencyId,
  );
  setup.bank = await must("POST", "/receiving-accounts", {
    name: `${TAG} Bank`,
    code: `${TAG}-BANK`,
    chartOfAccountId: ras[0].chartOfAccountId,
    notes: `${TAG} browser acceptance — do not use`,
    isActive: true,
  });
  setup.costCenter = await must("POST", "/cost-centers", {
    code: `${TAG}-CC`,
    name: `${TAG} Admin cost centre`,
  });
  setup.supplier = await must("POST", "/partners", {
    name: `${TAG} Supplier`,
    roles: ["SUPPLIER"],
    entityType: "ORGANIZATION",
  });
  const ref = items(
    await must("GET", "/products?pageSize=5&isInventoryItem=false&status=ACTIVE"),
  )[0];
  setup.product = await must("POST", "/products", {
    name: `${TAG} Office printer`,
    nameEn: `${TAG} Office printer`,
    internalName: `${TAG} Office printer`,
    displayName: `${TAG} Office printer`,
    sku: `${TAG}-PRN`,
    type: "SERVICE",
    itemType: "SERVICE",
    categoryId: ref.categoryId,
    unitId: ref.unitId,
    status: "ACTIVE",
    isPurchasable: true,
    isSellable: false,
    isInventoryItem: false,
  });
  const warehouses = items(await must("GET", "/warehouses?pageSize=50")).filter((w) => w.isActive);
  const warehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  // Purchase invoice with a FIXED_ASSET line → confirmed → capitalized asset; its first
  // period (last month) is posted by the depreciation run → the line can no longer be returned.
  const inv = await must("POST", "/purchasing/invoices", {
    partnerId: setup.supplier.id,
    referenceNumber: `${TAG} printer`,
    items: [
      {
        productId: setup.product.id,
        warehouseId: warehouse.id,
        unitId: setup.product.unitId,
        quantity: 1,
        unitPrice: 2400,
        treatment: "FIXED_ASSET",
        assetUsefulLifeMonths: 12,
        assetDepreciationMethod: "STRAIGHT_LINE",
        scheduleStartDate: prevMonthStart,
      },
    ],
  });
  await must("POST", `/purchasing/invoices/${inv.id}/confirm`);
  setup.invoice = await must("GET", `/purchasing/invoices/${inv.id}`);
  const assetId =
    setup.invoice.items?.[0]?.fixedAsset?.id ??
    items(await must("GET", `/fixed-assets?search=${encodeURIComponent(TAG)}&pageSize=10`))[0]?.id;
  const run = await must("POST", "/fixed-assets/depreciation-run", { asOf: prevMonthEnd });
  setup.asset = await must("GET", `/fixed-assets/${assetId}`);
  const postedPeriods = (
    setup.asset.depreciationPeriods ??
    setup.asset.schedule ??
    setup.asset.periods ??
    []
  ).filter((p) => p.status === "POSTED").length;
  check(
    "setup: confirmed purchase invoice with a FIXED_ASSET line → capitalized asset with posted depreciation",
    setup.invoice.status === "CONFIRMED" &&
      setup.asset.status === "CAPITALIZED" &&
      postedPeriods > 0,
    `${setup.invoice.invoiceNumber} ${setup.asset.code} ${setup.asset.status} run posted=${run.postedCount} failed=${run.failedCount} postedPeriods=${postedPeriods}`,
  );
  // Prepaid expense (ACTIVE) for the early-closing actions.
  const prepaid = await must("POST", "/prepaid-expenses", {
    name: `${TAG} Annual licence`,
    amount: 1200,
    startDate: today,
    totalPeriods: 12,
    expenseAccountId: setup.expenseAccount.id,
    receivingAccountId: setup.bank.id,
    notes: `${TAG} browser acceptance`,
  });
  await must("POST", `/prepaid-expenses/${prepaid.id}/activate`);
  setup.prepaid = await must("GET", `/prepaid-expenses/${prepaid.id}`);
  check(
    "setup: tagged ACTIVE prepaid expense",
    setup.prepaid.status === "ACTIVE",
    `${setup.prepaid.prepaidNumber} ${setup.prepaid.status}`,
  );
  check("setup: tagged expense account, bank, cost centre, supplier", true, TAG);
} catch (error) {
  check("setup: demo data created via the API", false, error?.message ?? error);
}

// ───────── browser helpers ─────────
async function newContext(
  browser,
  { locale = "en", theme = "light", viewport = { width: 1440, height: 900 }, touch = false } = {},
) {
  const ctx = await browser.newContext({
    viewport,
    locale: locale === "ar" ? "ar-EG" : "en-US",
    hasTouch: touch,
    isMobile: touch,
  });
  await ctx.addInitScript(
    ([l, th]) => {
      try {
        localStorage.setItem("oms.locale", JSON.stringify(l));
        localStorage.setItem("theme", th);
      } catch {
        /* storage blocked */
      }
    },
    [locale, theme],
  );
  return ctx;
}
async function signIn(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('input[type="password"]').first().press("Enter");
  const t0 = Date.now();
  while (new URL(page.url()).pathname.includes("/login")) {
    if (Date.now() - t0 > 60000) throw new Error("login stuck");
    await page.waitForTimeout(300);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}
const settle = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
const go = async (page, path, ms = 1500) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(page, ms);
};
const text = async (loc) =>
  ((await loc.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const noHorizontalScroll = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement;
    return { scrollW: el.scrollWidth, vw: innerWidth, ok: el.scrollWidth <= innerWidth };
  });
/** The control a <label for> names (ids from useId contain colons — attribute selector). */
const byLabel = async (scope, label) => {
  const el = scope
    .locator("label")
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
    .first();
  const id = await el.getAttribute("for");
  // A label without `for` (e.g. the editor's party label): the combobox in the same field.
  return id
    ? scope.locator(`[id="${id}"]`)
    : el.locator("xpath=..").locator('[role="combobox"]').first();
};
/** Opens an EntityCombobox trigger, types, picks the first item matching `match`. */
const pick = async (page, trigger, query, match = query) => {
  await trigger.click();
  await page.waitForTimeout(350);
  await page.keyboard.type(query, { delay: 15 });
  await page.waitForTimeout(1200);
  await page.locator("[cmdk-item]").filter({ hasText: match }).first().click();
  await page.waitForTimeout(500);
};
const toastText = async (page) => text(page.locator("[data-sonner-toast]").last()).catch(() => "");
/** Runs a header / document action: inline button when shown, otherwise via «More». */
const runAction = async (page, name) => {
  const inline = page.locator("main").getByRole("button", { name, exact: true });
  for (let i = 0; i < (await inline.count()); i++) {
    if (await inline.nth(i).isVisible()) {
      await inline.nth(i).click();
      await page.waitForTimeout(500);
      return "inline";
    }
  }
  const more = page.locator("main").getByRole("button", { name: /^(More|المزيد)$/ });
  for (let i = 0; i < (await more.count()); i++) {
    if (await more.nth(i).isVisible()) {
      await more.nth(i).click();
      break;
    }
  }
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name }).first().click();
  await page.waitForTimeout(600);
  return "menu";
};
const dialog = (page) => page.locator('[role="alertdialog"], [role="dialog"]').last();

// The pinned Playwright revision may differ from the browsers installed on the
// machine: CHROMIUM_PATH (or the shared /opt/pw-browsers/chromium) is used then.
const fallbackChromium = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch(
  existsSync(chromium.executablePath()) || !existsSync(fallbackChromium)
    ? {}
    : { executablePath: fallbackChromium },
);

// ═════════ E1. Expenses: draft → Confirm & post (double click) → Reverse ═════════
let voucherId = null;
await journey("E1. expense voucher", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/finance/expenses");
  const listBody = await text(page.locator("main"));
  check("E1. /finance/expenses list loads", /Expenses/.test(listBody), listBody.slice(0, 120));
  await go(page, "/finance/expenses/new", 2000);
  const main = page.locator("main");
  await pick(page, await byLabel(main, "Expense account"), TAG, `${TAG}`);
  await (await byLabel(main, "Description")).fill(`${TAG} printer paper`);
  await main.locator('[id$="-amount"]').first().fill("123.45");
  await pick(page, await byLabel(main, "Paid from"), TAG, `${TAG} Bank`);
  await pick(page, await byLabel(main, "Cost center"), TAG, TAG);
  const dateInput = main
    .locator("label")
    .filter({ hasText: /^\s*Expense date\s*$/ })
    .locator("xpath=..")
    .locator("input")
    .first();
  await dateInput.fill(expenseDateLabel);
  await dateInput.press("Enter");
  await page.waitForTimeout(400);
  const formText = await text(main);
  check(
    "E1. form: expense account, paid from and cost centre chosen on the form",
    formText.includes(`${TAG} Stationery expense`) || formText.includes(`${TAG} مصروفات`),
    formText.slice(0, 200),
  );
  await main.getByRole("button", { name: "Save", exact: true }).first().click();
  const t0 = Date.now();
  while (!/\/finance\/expenses\/[0-9a-f-]{36}/.test(page.url()) && Date.now() - t0 < 20000)
    await page.waitForTimeout(300);
  await settle(page, 1500);
  voucherId = page.url().match(/\/finance\/expenses\/([0-9a-f-]{36})/)?.[1] ?? null;
  check("E1. Save draft → editor of the saved voucher", !!voucherId, page.url());
  const draft = await must("GET", `/financial-transactions/expense-payments/${voucherId}`);
  const draftEntries = await entriesFor("EXPENSE_PAYMENT", voucherId);
  check(
    "E1. API: draft saved with the chosen account / bank / cost centre / date and NO journal entry",
    draft.status === "DRAFT" &&
      businessDay(draft.transactionDate) === expenseDate &&
      draft.expenseAccountId === setup.expenseAccount.id &&
      draft.receivingAccountId === setup.bank.id &&
      draft.costCenterId === setup.costCenter.id &&
      near(draft.amount, 123.45) &&
      draftEntries.length === 0 &&
      !draft.postedToAccounting,
    `${draft.transactionNumber} ${draft.status} date=${businessDay(draft.transactionDate)} amount=${draft.amount} JEs=${draftEntries.length}`,
  );
  const draftBody = await text(main);
  check(
    "E1. UI: posting state 'Not posted (draft)'",
    /Not posted \(draft\)/.test(draftBody),
    draftBody.match(/Posting.{0,40}/)?.[0],
  );
  await shot(page, "expense-draft");

  // Confirm & post → confirmation dialog → double click
  await main.getByRole("button", { name: "Confirm & post", exact: true }).first().click();
  await page.waitForTimeout(600);
  const dlg = dialog(page);
  const dlgText = await text(dlg);
  check(
    "E1. Confirm & post asks for confirmation (Dr expense / Cr paid-from explained)",
    /Dr the expense account, Cr the paid-from account/.test(dlgText),
    dlgText.slice(0, 160),
  );
  await dlg.getByRole("button", { name: "Confirm & post" }).dblclick();
  await settle(page, 3000);
  const toast = await toastText(page);
  const posted = await must("GET", `/financial-transactions/expense-payments/${voucherId}`);
  const entries = await entriesFor("EXPENSE_PAYMENT", voucherId);
  const je = entries[0];
  const dr = je?.lines?.find((l) => num(l.debit) > 0);
  const cr = je?.lines?.find((l) => num(l.credit) > 0);
  check(
    // `postedToAccounting` is a prep-only placeholder column (schema) — the entry is the proof.
    "E1. API: status posted (CONFIRMED)",
    posted.status === "CONFIRMED",
    posted.status,
  );
  check(
    "E1. double-click Confirm → exactly one journal entry",
    entries.length === 1,
    entries.map((e) => e.entryNumber).join(","),
  );
  check(
    "E1. API: entry balanced Dr expense account / Cr bank's ledger account, 123.45",
    je &&
      balanced(je) &&
      je.status === "POSTED" &&
      dr?.accountId === setup.expenseAccount.id &&
      near(dr?.debit, 123.45) &&
      cr?.accountId === setup.bank.chartOfAccountId &&
      near(cr?.credit, 123.45),
    je
      ? `${je.entryNumber} Dr ${dr?.account?.code} ${dr?.debit} / Cr ${cr?.account?.code} ${cr?.credit}`
      : "no entry",
  );
  check(
    "E1. API: entry dated on the expense date (back-dated, not the confirm date)",
    je && businessDay(je.entryDate) === expenseDate && expenseDate !== today,
    `entry ${businessDay(je?.entryDate)} expense ${expenseDate} confirmed ${isoDay(posted.confirmedAt)}`,
  );
  check(
    "E1. API: cost centre carried to the journal entry (header; reports filter by it)",
    dr?.costCenterId === setup.costCenter.id || je?.costCenterId === setup.costCenter.id,
    `line=${dr?.costCenterId} header=${je?.costCenterId}`,
  );
  await page.waitForTimeout(1500);
  const postedBody = await text(main);
  const ui = {
    toast: /posted/i.test(toast),
    badge: /Posting Posted/.test(postedBody),
    number: !!je && postedBody.includes(je.entryNumber),
    link:
      !!je &&
      (await main
        .locator('[data-testid="related-record-link"][data-kind="JOURNAL_ENTRY"]')
        .filter({ hasText: je.entryNumber })
        .count()) > 0,
  };
  check(
    "E1. UI: success toast + 'Posted' + journal entry number linked",
    ui.toast && ui.badge && ui.number && ui.link,
    `${JSON.stringify(ui)} toast="${toast.slice(0, 70)}" JE=${je?.entryNumber} ${postedBody.match(/Posting.{0,60}/)?.[0]}`,
  );
  await shot(page, "expense-posted");
  if (ui.link) {
    await main
      .locator('[data-testid="related-record-link"][data-kind="JOURNAL_ENTRY"]')
      .filter({ hasText: je.entryNumber })
      .first()
      .click();
    await page.waitForTimeout(1500);
    const preview = await text(dialog(page));
    check(
      "E1. journal entry link opens the entry preview",
      preview.includes(je.entryNumber),
      preview.slice(0, 160),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Reverse → reversal entry linked
  const how = await runAction(page, "Reverse");
  const rdlg = dialog(page);
  const rText = await text(rdlg);
  check(
    "E1. Reverse asks for confirmation (reversal entry explained)",
    /reversal journal entry/.test(rText),
    `${how}: ${rText.slice(0, 140)}`,
  );
  await rdlg.getByRole("button", { name: "Reverse" }).click();
  await settle(page, 3000);
  const reversed = await must("GET", `/financial-transactions/expense-payments/${voucherId}`);
  const all = await entriesFor("EXPENSE_PAYMENT", voucherId);
  const original = all.find((e) => e.id === je?.id) ?? je;
  let reversal = all.find((e) => e.reversalOfEntryId === je?.id);
  if (!reversal) {
    const search = items(
      await must(
        "GET",
        `/journal-entries?search=${encodeURIComponent(posted.transactionNumber)}&pageSize=20`,
      ),
    );
    reversal = search.find(
      (e) => e.reversalOfEntryId === je?.id || (e.id !== je?.id && e.sourceId === voucherId),
    );
  }
  const reversalDetail = reversal ? await must("GET", `/journal-entries/${reversal.id}`) : null;
  const mirrors =
    reversalDetail &&
    reversalDetail.lines.some(
      (l) => l.accountId === setup.expenseAccount.id && near(l.credit, 123.45),
    ) &&
    reversalDetail.lines.some(
      (l) => l.accountId === setup.bank.chartOfAccountId && near(l.debit, 123.45),
    );
  check(
    "E1. API: Reverse → CANCELLED + balanced reversal entry mirroring the original",
    reversed.status === "CANCELLED" && !!reversalDetail && balanced(reversalDetail) && mirrors,
    `${reversed.status} original=${original?.entryNumber}(${original?.status}) reversal=${reversalDetail?.entryNumber} reversalOf=${reversalDetail?.reversalOfEntryId === je?.id}`,
  );
  await page.waitForTimeout(1500);
  const revBody = await text(main);
  check(
    "E1. UI: 'Reversed' + reversal entry linked on the voucher",
    /Reversed/.test(revBody) &&
      !!reversalDetail &&
      (await main
        .locator('[data-testid="related-record-link"][data-kind="JOURNAL_ENTRY"]')
        .filter({ hasText: reversalDetail.entryNumber })
        .count()) > 0,
    `reversal=${reversalDetail?.entryNumber} shownOriginal=${revBody.includes(je?.entryNumber ?? "∅")}`,
  );
  await shot(page, "expense-reversed");
  await ctx.close();
});

// ═════════ E1b. New form → Confirm & post double-clicked → one voucher, one entry ═════════
await journey("E1b. new form confirm", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/finance/expenses/new", 2000);
  const main = page.locator("main");
  await pick(page, await byLabel(main, "Expense account"), TAG, TAG);
  await (await byLabel(main, "Description")).fill(`${TAG} direct post`);
  await main.locator('[id$="-amount"]').first().fill("77");
  await pick(page, await byLabel(main, "Paid from"), TAG, `${TAG} Bank`);
  await main.getByRole("button", { name: "Confirm & post", exact: true }).first().click();
  await page.waitForTimeout(600);
  await dialog(page).getByRole("button", { name: "Confirm & post" }).dblclick();
  await settle(page, 3500);
  const list = items(
    await must(
      "GET",
      `/financial-transactions/expense-payments?search=${encodeURIComponent(TAG)}&pageSize=50`,
    ),
  ).filter((v) => v.description === `${TAG} direct post`);
  const entries = list[0] ? await entriesFor("EXPENSE_PAYMENT", list[0].id) : [];
  check(
    "E1b. new form, Confirm & post double-clicked → one voucher, posted once",
    list.length === 1 &&
      list[0].status === "CONFIRMED" &&
      entries.length === 1 &&
      balanced(entries[0]),
    `${list.map((v) => `${v.transactionNumber}:${v.status}`).join(",")} JEs=${entries.length} url=${new URL(page.url()).pathname}`,
  );
  await ctx.close();
});

// ═════════ E2. Supplier with an open confirmed purchase invoice → "Pay invoice instead" ═════════
await journey("E2. pay invoice instead", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/finance/expenses/new", 2000);
  const main = page.locator("main");
  await pick(page, await byLabel(main, "Supplier \\(optional\\)"), TAG, `${TAG} Supplier`);
  await page.waitForTimeout(1500);
  const alert = main.getByText(/open purchase invoice/).first();
  const alertText = await text(alert);
  check(
    "E2. open purchase invoice warning shown for the supplier",
    (await alert.count()) > 0 && alertText.includes(`${TAG} Supplier`),
    alertText.slice(0, 160),
  );
  const link = main.getByRole("link", { name: "Pay invoice instead" }).first();
  const href = (await link.getAttribute("href").catch(() => null)) ?? "";
  check(
    "E2. 'Pay invoice instead' links to the supplier payment editor for that invoice",
    href.startsWith("/purchasing/payments/new") &&
      href.includes(`partnerId=${setup.supplier.id}`) &&
      href.includes(`invoiceId=${setup.invoice.id}`),
    href,
  );
  await shot(page, "expense-pay-invoice");
  await link.click();
  await settle(page, 2500);
  const body = await text(page.locator("main"));
  check(
    "E2. clicking it opens the supplier payment editor",
    new URL(page.url()).pathname === "/purchasing/payments/new" &&
      !/not found|404/i.test(body) &&
      body.length > 50,
    `${new URL(page.url()).pathname} ${body.slice(0, 100)}`,
  );
  await ctx.close();
});

// ═════════ E3. Arabic RTL + English; E4. 390 px ═════════
await journey("E3. arabic", async () => {
  const ctx = await newContext(browser, { locale: "ar" });
  const page = await signIn(ctx);
  for (const path of ["/finance/expenses", "/finance/expenses/new"]) {
    await go(page, path, 2000);
    const dir = await page.evaluate(() => document.documentElement.dir);
    const body = await text(page.locator("main"));
    check(
      `E3. [ar] ${path} renders RTL with Arabic labels`,
      dir === "rtl" &&
        (path.endsWith("new")
          ? /حساب المصروف/.test(body) && /مدفوع من/.test(body)
          : /المصروفات/.test(body)),
      `${dir} ${body.slice(0, 100)}`,
    );
  }
  if (voucherId) {
    await go(page, `/finance/expenses/${voucherId}`, 2500);
    const body = await text(page.locator("main"));
    check(
      "E3. [ar] reversed voucher shows 'معكوس' and the action bar in Arabic",
      /معكوس/.test(body),
      body.slice(0, 160),
    );
    await shot(page, "expense-ar-rtl");
  }
  await ctx.close();
  const en = await newContext(browser, { locale: "en" });
  const p2 = await signIn(en);
  await go(p2, "/finance/expenses", 2000);
  const dir = await p2.evaluate(() => document.documentElement.dir);
  check("E3. [en] /finance/expenses renders LTR", dir === "ltr", dir);
  await en.close();
});
await journey("E4. 390", async () => {
  const ctx = await newContext(browser, {
    locale: "ar",
    viewport: { width: 390, height: 844 },
    touch: true,
  });
  const page = await signIn(ctx);
  const paths = ["/finance/expenses", "/finance/expenses/new"];
  if (voucherId) paths.push(`/finance/expenses/${voucherId}`);
  for (const path of paths) {
    await go(page, path, 2500);
    const hs = await noHorizontalScroll(page);
    check(
      `E4. 390 px: ${path.replace(/[0-9a-f-]{36}/, ":id")} — no horizontal scroll`,
      hs.ok,
      JSON.stringify(hs),
    );
    if (path.endsWith("/new")) await shot(page, "expense-mobile-390");
  }
  await ctx.close();
});

// ═════════ F. Fixed asset: Dispose → supplier credit (shown, not executed) ═════════
await journey("F. fixed asset dispose", async () => {
  if (!setup.asset) throw new Error("no asset (setup failed)");
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, `/finance/fixed-assets/${setup.asset.id}`, 2500);
  const how = await runAction(page, "Dispose");
  const dlg = dialog(page);
  await dlg.locator('input[inputmode="decimal"], input[type="number"]').first().fill("1500");
  await page.waitForTimeout(500);
  const radio = dlg.getByRole("radio", { name: "Supplier credit" });
  check(
    "F. dispose dialog offers 'Supplier credit' once proceeds > 0",
    (await radio.count()) > 0,
    `${how}: ${(await text(dlg)).slice(0, 200)}`,
  );
  await radio.first().click();
  await page.waitForTimeout(500);
  const dText = await text(dlg);
  check(
    "F. supplier credit shows 'Supplier to credit' + the Accounts Payable hint",
    /Supplier to credit/.test(dText) && /debit Accounts Payable/.test(dText),
    dText.slice(0, 260),
  );
  await shot(page, "fixed-asset-dispose-supplier-credit");
  await page.keyboard.press("Escape");
  await ctx.close();
});

// ═════════ P. Prepaid: Cancel with refund / Recognize remaining now ═════════
await journey("P. prepaid", async () => {
  if (!setup.prepaid) throw new Error("no prepaid (setup failed)");
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, `/finance/prepaid-expenses/${setup.prepaid.id}`, 2500);
  // Cancel with refund — dialog only (not executed)
  const how1 = await runAction(page, "Cancel with refund");
  const c = dialog(page);
  const cText = await text(c);
  check(
    "P. 'Cancel with refund' dialog: balance reclaimed from the supplier + Refund to (supplier credit / cash)",
    /reclaimed from the supplier/.test(cText) &&
      /Refund to/.test(cText) &&
      /Supplier credit/.test(cText) &&
      /Cash received/.test(cText),
    `${how1}: ${cText.slice(0, 260)}`,
  );
  await c
    .getByRole("button", { name: /^(Close|Cancel)$/ })
    .first()
    .click()
    .catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(600);
  // Recognize remaining now — dialog explains the difference, then executed
  const how2 = await runAction(page, "Recognize remaining now");
  const r = dialog(page);
  const rText = await text(r);
  check(
    "P. 'Recognize remaining now' dialog: balance expensed on the date (not reclaimed)",
    /expensed on that date/.test(rText) && !/reclaimed/.test(rText),
    `${how2}: ${rText.slice(0, 220)}`,
  );
  await shot(page, "prepaid-recognize-remaining");
  await r.getByRole("button", { name: "Recognize remaining now" }).click();
  await settle(page, 3000);
  const toast = await toastText(page);
  const after = await must("GET", `/prepaid-expenses/${setup.prepaid.id}`);
  const acc = await entriesFor("PREPAID_ACCELERATION", setup.prepaid.id);
  const e = acc[0];
  const remaining = num(setup.prepaid.amount) - num(setup.prepaid.recognizedAmount);
  check(
    "P. API: recognize remaining → COMPLETED (closure RECOGNIZED)",
    after.status === "COMPLETED" && (after.closureType ?? "RECOGNIZED") === "RECOGNIZED",
    `${after.status} closure=${after.closureType} toast="${toast.slice(0, 60)}"`,
  );
  check(
    "P. API: one balanced PREPAID_ACCELERATION entry Dr expense for the unrecognized balance",
    acc.length === 1 &&
      balanced(e) &&
      e.lines.some((l) => l.accountId === setup.expenseAccount.id && near(l.debit, remaining)),
    e ? `${e.entryNumber} total=${e.totalDebit} remaining=${remaining}` : "no entry",
  );
  const body = await text(page.locator("main"));
  check(
    "P. UI: closed notice shown, early-closing actions gone",
    /on \d/.test(body) &&
      (await page
        .locator("main")
        .getByRole("button", { name: "Recognize remaining now" })
        .count()) === 0,
    body.slice(0, 200),
  );
  await ctx.close();
});

// ═════════ R. Purchase return refused for an asset line with posted depreciation ═════════
await journey("R. purchase return", async () => {
  if (!setup.invoice) throw new Error("no invoice (setup failed)");
  const summary = await must("GET", `/purchasing/returns/returnable-summary/${setup.invoice.id}`);
  const reason = items(summary)[0]?.returnBlockedReason ?? summary.items?.[0]?.returnBlockedReason;
  check(
    "R. API: returnable summary refuses the asset line (posted depreciation)",
    /posted depreciation/.test(reason ?? ""),
    reason,
  );
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, `/purchasing/purchase-invoices/${setup.invoice.id}`, 2500);
  const how = await runAction(page, "Create Return");
  await page.waitForTimeout(1500);
  const dlg = dialog(page);
  const dText = await text(dlg);
  check(
    "R. return dialog shows 'Cannot be returned' with the reason (dispose to supplier instead)",
    /Cannot be returned/.test(dText) &&
      /posted depreciation/.test(dText) &&
      /supplier credit/.test(dText),
    `${how}: ${dText.slice(0, 300)}`,
  );
  const rowCheckbox = dlg.getByRole("checkbox").first();
  check(
    "R. the blocked line cannot be selected",
    (await rowCheckbox.count()) === 0 || (await rowCheckbox.isDisabled()),
    `checkboxes=${await dlg.getByRole("checkbox").count()}`,
  );
  await shot(page, "purchase-return-blocked");
  await ctx.close();
});

// ═════════ T. Tax form shows the "recoverable" flag ═════════
await journey("T. tax", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/master-data/taxes", 2000);
  await page
    .getByRole("button", { name: /^Add new$/i })
    .first()
    .click();
  await page.waitForTimeout(1200);
  const dlg = dialog(page);
  const dText = await text(dlg);
  const ctl = dlg
    .getByRole("checkbox", { name: /Recoverable input tax/ })
    .or(dlg.getByRole("switch", { name: /Recoverable input tax/ }));
  const checked = (await ctl.count())
    ? await ctl
        .first()
        .getAttribute("aria-checked")
        .then((v) => v ?? String(false))
    : "n/a";
  check(
    "T. tax form shows 'Recoverable input tax' (default on)",
    /Recoverable input tax/.test(dText) && (checked === "true" || checked === "n/a"),
    `control=${await ctl.count()} checked=${checked}`,
  );
  await shot(page, "tax-recoverable");
  await ctx.close();
});

// ═════════ S. Smoke: payment methods tabs + sales Live ═════════
await journey("S. smoke", async () => {
  const ctx = await newContext(browser);
  const page = await signIn(ctx);
  await go(page, "/master-data/payment-methods", 2000);
  const tabs = await page.getByRole("tab").allInnerTexts();
  check(
    "S. payment methods: tabs Methods / Channels / Receiving accounts",
    ["Methods", "Channels", "Receiving accounts"].every((t) => tabs.some((x) => x.includes(t))),
    tabs.join(" | "),
  );
  await page.getByRole("tab", { name: "Channels" }).click();
  await settle(page, 1200);
  const panel = await text(page.locator('[role="tabpanel"]:visible').first());
  check("S. payment methods: Channels tab renders", panel.length > 20, panel.slice(0, 100));
  await go(page, "/reports/sales", 3000);
  const cards = await page.locator('main [data-slot="insight-card"]').count();
  const body = await text(page.locator("main"));
  check(
    "S. sales reports Live loads (5 period cards, no error)",
    cards === 5 && !/Could not load the report/.test(body),
    `${cards} cards`,
  );
  await ctx.close();
});

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(
  `${OUT}/r13b-browser.json`,
  JSON.stringify(
    {
      tag: TAG,
      base: BASE,
      ranAt: new Date().toISOString(),
      passed: results.length - failed.length,
      failed: failed.length,
      notCovered,
      screenshots: shots,
      results,
    },
    null,
    2,
  ),
);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
