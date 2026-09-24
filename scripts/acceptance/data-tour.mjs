#!/usr/bin/env node
/**
 * OMS acceptance data tour — API-driven builder + verifier.
 *
 * Creates PERSISTENT, clearly tagged fictional demo data (every record name /
 * notes / reference carries RUN = DEMO-ACCEPTANCE-YYYYMMDD-HHMM) and verifies
 * accounting integrity end-to-end. Demo records are never deleted, and
 * pre-existing non-demo records are only ever read (master-data lookups).
 * No real communications: fictional +20100000xxxx phones, example.com mails.
 *
 * Usage (local):
 *   BASE=http://localhost:3001 API=http://localhost:3005 \
 *     EMAIL=admin@oms.local PW=... node scripts/acceptance/data-tour.mjs
 * Usage (Production — lead engineer only):
 *   BASE=https://oms.haseb.org node scripts/acceptance/data-tour.mjs
 *   (API defaults to BASE/api, EMAIL to qa-admin@oms.haseb.org and PW to
 *    QA_PASSWORD from tmp/.qa.env)
 *
 * Optional env:
 *   ALLOW_GLOBAL_RUNS=1|0  fixed-asset depreciation run and prepaid
 *                          recognition are company-wide batch jobs (they post
 *                          for every due asset/prepayment, not only demo ones).
 *                          Default: 1 against localhost, 0 otherwise.
 *   OUT_ROOT               output root (default tmp/acceptance)
 *
 * Outputs tmp/acceptance/<RUN>/{data-tour-report.json, demo-record-index.json,
 * walkthrough.md}. Always exits 0 once the report is written — each flow is
 * isolated; app defects are reported as FAIL, missing prerequisites as BLOCKED.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------ config
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i);
    const value = line.slice(i + 1).replace(/^["']|["']$/g, "");
    if (value === "[SENSITIVE]") continue;
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(resolve(ROOT, "tmp/.qa.env"));

const BASE = (process.env.BASE ?? "https://oms.haseb.org").replace(/\/$/, "");
const API = (process.env.API ?? `${BASE}/api`).replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PW = process.env.PW ?? process.env.PASSWORD ?? process.env.QA_PASSWORD ?? "";
const IS_LOCAL_API = /localhost|127\.0\.0\.1/.test(API);
const ALLOW_GLOBAL_RUNS =
  process.env.ALLOW_GLOBAL_RUNS != null ? process.env.ALLOW_GLOBAL_RUNS === "1" : IS_LOCAL_API;

const pad = (v) => String(v).padStart(2, "0");
const started = new Date();
const RUN =
  process.env.RUN ??
  `DEMO-ACCEPTANCE-${started.getFullYear()}${pad(started.getMonth() + 1)}${pad(started.getDate())}-${pad(started.getHours())}${pad(started.getMinutes())}`;
const OUT = resolve(ROOT, process.env.OUT_ROOT ?? "tmp/acceptance", RUN);
const WEB_APP_DIR = resolve(ROOT, "apps/web/src/app/(shell)");

const isoDay = (d) => d.toISOString().slice(0, 10);
const TODAY = isoDay(new Date());
const monthsAgo = (m) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - m);
  return isoDay(d);
};

// ------------------------------------------------------------------ state
const report = {
  run: RUN,
  startedAt: started.toISOString(),
  base: BASE,
  api: API,
  user: EMAIL,
  allowGlobalRuns: ALLOW_GLOBAL_RUNS,
  functionalCurrency: null,
  flows: [],
  blockers: [],
};
const recordIndex = [];
const ctx = {}; // shared master data + cross-flow records
let token = "";

// ------------------------------------------------------------------ helpers
const n = (v) => (v == null || v === "" ? 0 : Number(v));
const r2 = (v) => Math.round(n(v) * 100) / 100;
const eq = (a, b, tol = 0.01) => Math.abs(n(a) - n(b)) <= tol;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const items = (json) =>
  Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : Array.isArray(json?.data) ? json.data : [];
const short = (v, len = 300) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > len ? `${s.slice(0, len)}…` : s;
};

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return { status: 0, ok: false, json: null, message: `network: ${error.message}` };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  const fields = Array.isArray(json?.fields)
    ? json.fields.map((f) => `${f.field}: ${(f.constraints ?? []).join("/")}`).join("; ")
    : "";
  const message = res.ok
    ? ""
    : `${Array.isArray(json?.message) ? json.message.join("; ") : json?.message ?? json?.error ?? text.slice(0, 200)}${fields ? ` [${fields}]` : ""}`;
  return { status: res.status, ok: res.ok, json, message, method, path };
}

class Blocked extends Error {}

/** Throws with a readable reason unless the call succeeded. */
function must(res, label) {
  if (!res.ok) {
    const err = new Error(`${label}: ${res.method} ${res.path} → ${res.status} ${res.message}`);
    err.res = res;
    throw err;
  }
  return res.json;
}

const readable = (msg) => typeof msg === "string" && msg.trim().length >= 8 && !/^internal server error$/i.test(msg.trim());

// Web routes — each template is verified against apps/web/src/app/(shell).
const ROUTES = {
  lead: "/crm/leads/[id]",
  storeOrder: "/store-orders/[id]",
  paymentReview: "/finance/payment-review",
  customerReceipt: "/sales/payments/[id]",
  customerRefund: "/sales/refunds/[id]",
  supplierPayment: "/purchasing/payments/[id]",
  salesQuotation: "/sales/quotations/[id]",
  salesOrder: "/sales/orders/[id]",
  salesInvoice: "/sales/invoices/[id]",
  salesReturn: "/sales/returns/[id]",
  purchaseQuotation: "/purchasing/purchase-quotations/[id]",
  purchaseOrder: "/purchasing/purchase-orders/[id]",
  purchaseInvoice: "/purchasing/purchase-invoices/[id]",
  purchaseReturn: "/purchasing/purchase-returns/[id]",
  product: "/products/[id]",
  customer: "/sales/customers/[id]",
  supplier: "/purchasing/suppliers/[id]",
  journalEntry: "/finance/journal-entries/[id]",
  fixedAssets: "/finance/fixed-assets",
  prepaidExpenses: "/finance/prepaid-expenses",
  movements: "/inventory/movements",
  stock: "/inventory/stock",
  reports: "/reports/finance",
  shipping: "/shipping",
};
const routeChecked = {};
function routeExists(template) {
  if (routeChecked[template] != null) return routeChecked[template];
  const file = resolve(WEB_APP_DIR, `.${template}`, "page.tsx");
  routeChecked[template] = existsSync(WEB_APP_DIR) ? existsSync(file) : null;
  return routeChecked[template];
}
function webUrl(kind, id, query = "") {
  const template = ROUTES[kind];
  if (!template) return null;
  return `${BASE}${template.replace("[id]", id ?? "")}${query}`;
}

/** Adds (or merges into) one entry of demo-record-index.json. */
function indexRecord(entry) {
  const existing = recordIndex.find((r) => r.id && r.id === entry.id && r.type === entry.type);
  const template = ROUTES[entry.route];
  const full = {
    type: entry.type,
    id: entry.id ?? null,
    number: entry.number ?? null,
    name: entry.name ?? null,
    flow: entry.flow ?? null,
    url: entry.url ?? (entry.route ? webUrl(entry.route, entry.id, entry.query ?? "") : null),
    routeTemplate: template ?? null,
    routeVerified: template ? routeExists(template) : null,
    journalEntries: entry.journalEntries ?? [],
    stockMovements: entry.stockMovements ?? [],
    expected: entry.expected ?? {},
    notes: entry.notes ?? null,
  };
  if (existing) {
    for (const key of ["number", "name", "url", "notes"]) if (full[key] && !existing[key]) existing[key] = full[key];
    existing.journalEntries = dedupeBy([...existing.journalEntries, ...full.journalEntries], "id");
    existing.stockMovements = dedupeBy([...existing.stockMovements, ...full.stockMovements], "id");
    existing.expected = { ...existing.expected, ...full.expected };
    return existing;
  }
  recordIndex.push(full);
  return full;
}
const dedupeBy = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = typeof x === "object" ? x?.[key] : x;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// --------------------------------------------------------------- accounting
async function jeInfo(id) {
  const je = must(await api("GET", `/journal-entries/${id}`), "journal entry");
  const lines = (je.lines ?? []).map((l) => ({
    accountId: l.accountId,
    code: l.account?.code ?? null,
    control: l.account?.partnerControlType ?? null,
    partnerId: l.partnerId ?? null,
    debit: n(l.debit),
    credit: n(l.credit),
  }));
  const dr = r2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = r2(lines.reduce((s, l) => s + l.credit, 0));
  return {
    id: je.id,
    number: je.entryNumber,
    status: je.status,
    sourceType: je.sourceType,
    sourceId: je.sourceId,
    currency: je.currency?.code ?? je.currencyId ?? null,
    currencyId: je.currencyId ?? null,
    exchangeRate: je.exchangeRate == null ? null : n(je.exchangeRate),
    dr,
    cr,
    balanced: eq(dr, cr) && dr > 0,
    lines,
  };
}
const jeRef = (je) => ({ id: je.id, number: je.number, sourceType: je.sourceType, total: je.dr });

async function jesFor(sourceType, sourceId) {
  const res = await api(
    "GET",
    `/journal-entries?pageSize=50&sourceType=${encodeURIComponent(sourceType)}&sourceId=${encodeURIComponent(sourceId)}`,
  );
  return items(res.json).filter(
    (row) => row.sourceType === sourceType && row.sourceId === sourceId && !row.reversalOfEntryId,
  );
}
async function waitJes(sourceType, sourceId, min = 1, timeoutMs = 15000) {
  const startedAt = Date.now();
  let found = [];
  while (Date.now() - startedAt < timeoutMs) {
    found = await jesFor(sourceType, sourceId);
    if (found.length >= min) return found;
    await sleep(700);
  }
  return found;
}
const sumLines = (je, pred, side) => r2(je.lines.filter(pred).reduce((s, l) => s + l[side], 0));
const onAccount = (accountId) => (l) => l.accountId === accountId;

async function trace(kind, id) {
  const res = await api("GET", `/traceability/${kind}/${id}`);
  if (!res.ok) return { ok: false, message: `${res.status} ${res.message}`, groups: [] };
  const groups = res.json?.groups ?? [];
  const group = (key) => groups.find((g) => g.key === key) ?? { state: "MISSING", items: [] };
  return { ok: true, record: res.json?.record, groups, group, ids: (key) => group(key).items.map((i) => i.id) };
}

async function movementsFor(productId) {
  const res = await api("GET", `/inventory/movements?productId=${productId}&pageSize=200`);
  return items(res.json).filter((m) => m.productId === productId);
}
async function onHand(productId, warehouseId) {
  const moves = await movementsFor(productId);
  return r2(
    moves
      .filter((m) => (!warehouseId || m.warehouseId === warehouseId) && !/^RESERVATION/.test(m.type))
      .reduce((s, m) => s + n(m.quantity), 0),
  );
}

/** Walks a document through submit → approve → confirm until one of `targets`. */
async function advance(base, id, targets) {
  const errors = [];
  let doc = must(await api("GET", `${base}/${id}`), `${base} read`);
  for (const step of ["submit", "approve", "confirm"]) {
    if (targets.includes(doc.status)) break;
    const res = await api("POST", `${base}/${id}/${step}`);
    if (!res.ok) errors.push(`${step}: ${res.status} ${res.message}`);
    doc = must(await api("GET", `${base}/${id}`), `${base} read`);
  }
  if (!targets.includes(doc.status)) {
    throw new Error(`${base}/${id} stuck in ${doc.status} (wanted ${targets.join("/")}) — ${errors.join(" | ")}`);
  }
  return doc;
}

// ------------------------------------------------------------------ flow runner
async function runFlow(id, name, fn) {
  const flow = { id, name, status: "PASS", checks: [], evidence: {}, records: [], error: null };
  const f = {
    check(label, pass, detail = "") {
      const ok = Boolean(pass);
      flow.checks.push({ name: label, pass: ok, detail: short(detail, 600) });
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${short(detail, 180)}` : ""}`);
      return ok;
    },
    /** Expect a 4xx rejection with a human-readable message. */
    expectReject(label, res, statuses = [400, 403, 409, 422]) {
      const ok = statuses.includes(res.status) && readable(res.message);
      return f.check(label, ok, `${res.status} ${res.message}`);
    },
    evidence(key, value) {
      flow.evidence[key] = value;
    },
    rec(entry) {
      const e = indexRecord({ ...entry, flow: id });
      if (!flow.records.includes(e)) flow.records.push(e);
      return e;
    },
  };
  console.log(`\n=== ${id} ${name}`);
  try {
    await fn(f);
  } catch (error) {
    if (error instanceof Blocked) {
      flow.status = "BLOCKED";
      flow.error = error.message;
      report.blockers.push(`${id}: ${error.message}`);
      console.log(`  BLOCKED ${error.message}`);
    } else {
      flow.error = error.message;
      flow.checks.push({ name: "flow completed without an unexpected error", pass: false, detail: short(error.message, 600) });
      console.log(`  FAIL  ${error.message}`);
    }
  }
  if (flow.status !== "BLOCKED" && flow.checks.some((c) => !c.pass)) flow.status = "FAIL";
  report.flows.push({
    ...flow,
    records: flow.records.map((r) => ({ type: r.type, id: r.id, number: r.number, url: r.url })),
  });
  return flow;
}

// ------------------------------------------------------------------ setup
let phoneSeq = 0;
const phoneBase = String(Date.now()).slice(-5);
/** Fictional Egyptian mobile +20100xxxxxxx (per-run unique; never contacted — OMS sends no SMS/WhatsApp/email). */
const fakePhone = () => `+20100${phoneBase}${pad(phoneSeq++ % 100)}`;

const notTest = (row) => !/test|qa-|m3-|fx |cftest|milestone|closure/i.test(`${row.name ?? ""} ${row.code ?? ""}`);

async function setup() {
  const me = must(await api("GET", "/auth/me"), "auth/me");
  ctx.userId = me.id;

  const settings = must(await api("GET", "/accounting/posting-settings"), "posting settings");
  ctx.settings = settings;
  const currencies = items(must(await api("GET", "/currencies?pageSize=200"), "currencies"));
  const fcId = settings.functionalCurrencyId ?? settings.functionalCurrency?.id ?? null;
  const fc = currencies.find((c) => c.id === fcId) ?? (settings.functionalCurrency?.code ? settings.functionalCurrency : null);
  if (!fcId || !fc) {
    throw new Blocked(
      "BLOCKER: posting settings have no functionalCurrency — set it in Accounting Settings; the tour will not guess a document currency.",
    );
  }
  ctx.currency = { id: fcId, code: fc.code };
  report.functionalCurrency = fc.code;

  const warehouses = items(must(await api("GET", "/warehouses?pageSize=100"), "warehouses")).filter(
    (w) => w.isActive !== false && !w.deletedAt,
  );
  ctx.warehouse = warehouses.find((w) => w.isDefault) ?? warehouses.find(notTest) ?? warehouses[0];
  if (!ctx.warehouse) throw new Blocked("No active warehouse");

  const units = items(must(await api("GET", "/units?pageSize=200"), "units"));
  ctx.unit = units.find(notTest) ?? units[0];
  const categories = items(must(await api("GET", "/product-categories?pageSize=200"), "categories"));
  ctx.category = categories.find(notTest) ?? categories[0];
  if (!ctx.unit || !ctx.category) throw new Blocked("No unit or product category master data");

  const countries = items(must(await api("GET", "/countries?pageSize=300"), "countries"));
  ctx.country = countries.find((c) => c.code === "EG") ?? countries.find((c) => c.isActive !== false);
  if (!ctx.country) throw new Blocked("No country master data");

  const receiving = items(must(await api("GET", "/receiving-accounts?pageSize=100"), "receiving accounts")).filter(
    (a) => a.isActive !== false && !a.deletedAt && a.chartOfAccountId && (!a.currencyId || a.currencyId === fcId),
  );
  ctx.receivingAccount = receiving.find((a) => a.isDefault) ?? receiving.find(notTest) ?? receiving[0];
  if (!ctx.receivingAccount) throw new Blocked(`No active receiving account usable for ${fc.code}`);
  ctx.receivingGlId = ctx.receivingAccount.chartOfAccountId;

  const sources = items(must(await api("GET", "/payment-sources?pageSize=100"), "payment sources")).filter(
    (s) => s.isActive !== false,
  );
  ctx.paymentSource = sources.find((s) => s.isDefault) ?? sources.find(notTest) ?? sources[0];
  if (!ctx.paymentSource) throw new Blocked("No active payment source");

  const journals = items(must(await api("GET", "/journals?pageSize=100"), "journals"));
  ctx.generalJournal = journals.find((j) => j.code === "GJ") ?? journals.find((j) => j.type === "GENERAL") ?? null;

  const years = items(must(await api("GET", "/accounting/fiscal-years"), "fiscal years"));
  ctx.fiscalYear =
    years.find((y) => new Date(y.startDate) <= new Date() && new Date(y.endDate) >= new Date()) ?? null;

  // Demo master data — every name carries RUN.
  const newProduct = async (label, extra = {}) => {
    const body = {
      name: `${RUN} ${label}`,
      nameEn: `${RUN} ${label}`,
      internalName: `${RUN} ${label}`,
      displayName: `${RUN} ${label}`,
      internalNotes: `${RUN} fictional demo product — do not sell`,
      type: "PURCHASE_AND_SALE",
      status: "ACTIVE",
      categoryId: ctx.category.id,
      unitId: ctx.unit.id,
      isPurchasable: true,
      isSellable: true,
      isInventoryItem: true,
      costingMethod: "AVERAGE",
      preferredWarehouseId: ctx.warehouse.id,
      weight: 0.5,
      width: 15,
      height: 22,
      length: 2,
      ...extra,
    };
    const product = must(await api("POST", "/products", body), `create product ${label}`);
    if (product.status !== "ACTIVE") must(await api("POST", `/products/${product.id}/activate`), "activate product");
    return must(await api("GET", `/products/${product.id}`), "read product");
  };
  ctx.book = await newProduct("Book", { salesPrice: 450, purchasePrice: 35 });
  ctx.bookLab = await newProduct("Book Lab", { salesPrice: 60, purchasePrice: 36 });

  const newPartner = async (label, roles) => {
    const body = {
      name: `${RUN} ${label}`,
      roles,
      mobile: fakePhone(),
      email: `demo.${label.toLowerCase().replace(/\W+/g, "-")}.${Date.now()}@example.com`,
      countryId: ctx.country.id,
      city: "Demo City",
      address: `${RUN} fictional address`,
      notes: `${RUN} fictional demo partner`,
      currencyId: fcId,
    };
    const created = must(await api("POST", "/partners", body), `create partner ${label}`);
    const read = must(await api("GET", `/partners/${created.id}`), "read partner");
    return { ...read, _sent: body };
  };
  ctx.b2bCustomer = await newPartner("Customer B2B", ["CUSTOMER"]);
  ctx.supplier = await newPartner("Supplier", ["SUPPLIER"]);

  // Opening stock for the shared demo product: 100 @ 40.
  const opening = await api("POST", "/inventory/opening-balance", {
    productId: ctx.book.id,
    warehouseId: ctx.warehouse.id,
    quantity: 100,
    unitCost: 40,
    notes: `${RUN} opening stock`,
  });
  must(opening, "opening stock Book");
  ctx.bookOpening = opening.json;
}

// ------------------------------------------------------------------ store-order helpers
async function leadToOrder(f, label, { qty, agreed, paymentType = "PREPAID" }) {
  const lead = must(
    await api("POST", "/leads", {
      customerName: `${RUN} ${label}`,
      mobileNumber: fakePhone(),
      countryId: ctx.country.id,
      city: "Demo City",
      address: `${RUN} fictional address`,
      productId: ctx.book.id,
      quantity: qty,
      currencyId: ctx.currency.id,
      source: "MANUAL",
    }),
    `create lead ${label}`,
  );
  const converted = must(
    await api("POST", `/leads/${lead.id}/convert`, {
      items: [{ productId: ctx.book.id, quantity: qty, agreedAmount: agreed }],
      paymentType,
      currencyId: ctx.currency.id,
      city: "Demo City",
      address: `${RUN} fictional address`,
      notes: `${RUN} ${label} order`,
    }),
    `convert lead ${label}`,
  );
  const orderId = converted.storeOrder?.id ?? converted.storeOrderId;
  if (!orderId) throw new Error(`lead ${lead.leadNumber} converted without a store order: ${short(converted)}`);
  const order = must(await api("GET", `/store-orders/${orderId}`), "read store order");
  f.rec({ type: "Lead", id: lead.id, number: lead.leadNumber, name: `${RUN} ${label}`, route: "lead", expected: { convertedToOrder: order.internalOrderId } });
  if (order.partnerId) {
    const partner = (await api("GET", `/partners/${order.partnerId}`)).json;
    f.rec({ type: "Customer", id: order.partnerId, number: partner?.partnerNumber, name: partner?.name ?? `${RUN} ${label}`, route: "customer" });
  }
  return { lead, order };
}

async function reportAndConfirm(f, order, amount, label) {
  const reported = must(
    await api("POST", `/store-orders/${order.id}/report-payment`, {
      reportedAmount: amount,
      reportedDate: TODAY,
      paymentSourceId: ctx.paymentSource.id,
      receivingAccountId: ctx.receivingAccount.id,
      reference: `${RUN} ${label}`,
      senderName: `${RUN} ${label} sender`,
      notes: `${RUN} ${label} payment report`,
    }),
    `report payment ${label}`,
  );
  const payment = reported.payment;
  const confirmed = must(await api("POST", `/payments/${payment.id}/confirm`), `confirm payment ${label}`);
  return { payment, confirmed };
}

async function generateInvoice(order) {
  const inv = must(await api("POST", `/store-orders/${order.id}/generate-invoice`), "generate invoice");
  const invoiceId = inv?.id ?? inv?.salesInvoice?.id ?? inv?.salesInvoiceId;
  return must(await api("GET", `/sales/invoices/${invoiceId}`), "read invoice");
}

async function receiptsForPayment(paymentNumber) {
  const res = await api("GET", `/financial-transactions/receipts?search=${encodeURIComponent(paymentNumber)}&pageSize=50`);
  return items(res.json).filter((r) => r.status !== "CANCELLED" && r.referenceNumber === paymentNumber);
}

// ================================================================== FLOW 1
async function flowLeadsStoreOrders(f) {
  const AGREED = 900;
  const QTY = 2;
  const { order } = await leadToOrder(f, "Customer A", { qty: QTY, agreed: AGREED });
  ctx.orderA = order;
  f.check("order total equals agreed amount", eq(order.total ?? order.grandTotal ?? 0, AGREED) || eq(order.items?.reduce((s, i) => s + n(i.agreedAmount), 0), AGREED), `total=${order.total} items=${short(order.items?.map((i) => i.agreedAmount))}`);
  f.check("order currency is the functional currency", order.currencyId === ctx.currency.id, `${order.currencyId} vs ${ctx.currency.code}`);

  const { payment, confirmed } = await reportAndConfirm(f, order, AGREED, "Customer A");
  f.check("Confirm & Post: payment VERIFIED, first call not alreadyPosted", confirmed.status === "VERIFIED" && confirmed.alreadyPosted === false, short(confirmed));
  const receipt = confirmed.receipt;
  f.check("Confirm & Post returned receipt + JE", Boolean(receipt?.id && receipt?.journalEntry?.id), `${receipt?.transactionNumber} ${receipt?.journalEntry?.entryNumber}`);

  // Retry twice (idempotency).
  const retries = [await api("POST", `/payments/${payment.id}/confirm`), await api("POST", `/payments/${payment.id}/confirm`)];
  f.check(
    "retry Confirm & Post ×2 → alreadyPosted, same receipt",
    retries.every((r) => r.ok && r.json?.alreadyPosted === true && r.json?.receipt?.id === receipt?.id),
    retries.map((r) => `${r.status}:${r.json?.alreadyPosted}:${r.json?.receipt?.transactionNumber ?? r.message}`).join(", "),
  );
  const receipts = await receiptsForPayment(payment.paymentNumber);
  f.check("exactly ONE customer receipt for the payment", receipts.length === 1, receipts.map((r) => r.transactionNumber).join(","));
  const receiptJes = receipt?.id ? await waitJes("CUSTOMER_RECEIPT", receipt.id) : [];
  f.check("exactly ONE receipt JE", receiptJes.length === 1, receiptJes.map((j) => j.entryNumber).join(","));

  let receiptJe = null;
  if (receiptJes[0]) {
    receiptJe = await jeInfo(receiptJes[0].id);
    f.check("receipt JE balanced & POSTED", receiptJe.balanced && receiptJe.status === "POSTED", `${receiptJe.number} Dr ${receiptJe.dr} Cr ${receiptJe.cr}`);
    f.check(
      `receipt JE total = order amount in ${ctx.currency.code} (no FX multiplication)`,
      eq(receiptJe.dr, AGREED) && (receiptJe.exchangeRate == null || eq(receiptJe.exchangeRate, 1, 1e-6)) && (!receiptJe.currencyId || receiptJe.currencyId === ctx.currency.id),
      `Dr ${receiptJe.dr} rate=${receiptJe.exchangeRate} currency=${receiptJe.currency}`,
    );
    f.check("receipt JE: Dr receiving account / Cr AR for the order amount", eq(sumLines(receiptJe, onAccount(ctx.receivingGlId), "debit"), AGREED) && eq(sumLines(receiptJe, onAccount(ctx.settings.accountsReceivableAccountId), "credit"), AGREED), receiptJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | "));
  }

  // Settlement consistency: payment-context vs order list row.
  const pc = must(await api("GET", `/store-orders/${order.id}/payment-context`), "payment context");
  f.check("payment-context: paid = total = agreed, outstanding 0, fully settled", eq(pc.total, AGREED) && eq(pc.paid, AGREED) && eq(pc.outstanding, 0) && pc.fullySettled === true, short(pc));
  const list = items((await api("GET", `/store-orders?search=${encodeURIComponent(order.internalOrderId)}&pageSize=10`)).json);
  const row = list.find((o) => o.id === order.id);
  const rowTotal = row ? n(row.total ?? row.grandTotal ?? row.items?.reduce((s, i) => s + n(i.agreedAmount), 0)) : null;
  f.check(
    "order list row agrees with payment-context (status + total)",
    row && row.paymentStatus === pc.paymentStatus && (row.total == null || eq(rowTotal, pc.total)),
    row ? `list paymentStatus=${row.paymentStatus} total=${row.total} | context ${pc.paymentStatus} ${pc.total}` : "order not found in list",
  );
  if (row) {
    const listPaid = r2((row.payments ?? []).filter((p) => p.status === "VERIFIED").reduce((sum, p) => sum + n(p.amount), 0));
    const listOutstanding = r2(n(row.total) - listPaid);
    f.check("order list paid/outstanding (from its payments) = payment-context", eq(listPaid, pc.paid) && eq(listOutstanding, pc.outstanding), `list paid ${listPaid} outstanding ${listOutstanding} | context paid ${pc.paid} outstanding ${pc.outstanding}`);
  }

  // Fully-settled order rejects another payment.
  const extra = await api("POST", `/store-orders/${order.id}/report-payment`, {
    reportedAmount: 50,
    reportedDate: TODAY,
    paymentSourceId: ctx.paymentSource.id,
    receivingAccountId: ctx.receivingAccount.id,
    reference: `${RUN} overpayment probe`,
  });
  f.expectReject("fully-settled order rejects another payment (400)", extra, [400]);

  // Invoice.
  const invoice = await generateInvoice(order);
  ctx.invoiceA = invoice;
  f.check("invoice grand total = agreed amount", eq(invoice.grandTotal, AGREED), `${invoice.invoiceNumber} ${invoice.grandTotal}`);
  const again = await api("POST", `/store-orders/${order.id}/generate-invoice`);
  f.expectReject("generate-invoice retry is rejected (no duplicate invoice)", again, [400, 409]);
  const invJes = await waitJes("SALES_INVOICE", invoice.id);
  f.check("exactly ONE invoice JE", invJes.length === 1, invJes.map((j) => j.entryNumber).join(","));
  let invJe = null;
  if (invJes[0]) {
    invJe = await jeInfo(invJes[0].id);
    f.check("invoice JE balanced; AR debit = revenue credit = agreed amount", invJe.balanced && eq(sumLines(invJe, onAccount(ctx.settings.accountsReceivableAccountId), "debit"), AGREED) && eq(sumLines(invJe, onAccount(ctx.settings.salesRevenueAccountId), "credit"), AGREED - n(invoice.taxTotal)), invJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | "));
    f.check(`invoice JE in ${ctx.currency.code}, rate 1`, (invJe.exchangeRate == null || eq(invJe.exchangeRate, 1, 1e-6)) && (!invJe.currencyId || invJe.currencyId === ctx.currency.id), `${invJe.currency} ${invJe.exchangeRate}`);
    f.check("invoice JE records COGS = qty × 40 (opening cost)", eq(sumLines(invJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "debit"), QTY * 40), `COGS ${sumLines(invJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "debit")}`);
  }
  await sleep(500);
  const invAfter = must(await api("GET", `/sales/invoices/${invoice.id}`), "invoice reload");
  f.check("invoice settled by the advance receipt (PAID, remaining 0)", invAfter.paymentStatus === "PAID" && eq(invAfter.remainingBalance ?? 0, 0), `${invAfter.paymentStatus} remaining=${invAfter.remainingBalance}`);

  const moves = (await movementsFor(ctx.book.id)).filter((m) => m.referenceId === invoice.id);
  f.check("invoice delivered stock (SALES_DELIVERY −qty)", moves.some((m) => m.type === "SALES_DELIVERY" && eq(m.quantity, -QTY)), moves.map((m) => `${m.movementNumber} ${m.type} ${m.quantity}`).join(","));

  f.rec({ type: "StoreOrder", id: order.id, number: order.internalOrderId, route: "storeOrder", expected: { total: AGREED, paid: AGREED, outstanding: 0, currency: ctx.currency.code, paymentStatus: pc.paymentStatus } });
  f.rec({ type: "Payment", id: payment.id, number: payment.paymentNumber, route: "storeOrder", url: webUrl("storeOrder", order.id), notes: `Store-order payment of ${order.internalOrderId} (Payments tab of the order; the review queue only lists unconfirmed payments)`, expected: { amount: AGREED, status: "VERIFIED" } });
  if (receipt?.id) f.rec({ type: "CustomerReceipt", id: receipt.id, number: receipt.transactionNumber, route: "customerReceipt", journalEntries: receiptJe ? [jeRef(receiptJe)] : [], expected: { amount: AGREED } });
  f.rec({ type: "SalesInvoice", id: invoice.id, number: invoice.invoiceNumber, route: "salesInvoice", journalEntries: invJe ? [jeRef(invJe)] : [], stockMovements: moves.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })), expected: { grandTotal: AGREED, cogs: QTY * 40, paymentStatus: "PAID" } });
  if (receiptJe) f.rec({ type: "JournalEntry", id: receiptJe.id, number: receiptJe.number, route: "journalEntry", notes: "Customer receipt JE (Confirm & Post)", expected: { debit: AGREED, credit: AGREED } });
  if (invJe) f.rec({ type: "JournalEntry", id: invJe.id, number: invJe.number, route: "journalEntry", notes: "Store-order invoice JE", expected: { debit: invJe.dr } });
  ctx.partnerA = order.partnerId;
  ctx.expectedPartnerClosing = { ...(ctx.expectedPartnerClosing ?? {}), [order.partnerId]: { control: "RECEIVABLE", closing: 0, open: 0, label: "Customer A" } };

  // Validation failure: convert a lead with agreed amount 0.
  const zeroLead = must(
    await api("POST", "/leads", {
      customerName: `${RUN} Customer Zero`,
      mobileNumber: fakePhone(),
      countryId: ctx.country.id,
      productId: ctx.book.id,
      quantity: 1,
      currencyId: ctx.currency.id,
      source: "MANUAL",
    }),
    "create zero lead",
  );
  const zero = await api("POST", `/leads/${zeroLead.id}/convert`, {
    items: [{ productId: ctx.book.id, quantity: 1, agreedAmount: 0 }],
    paymentType: "PREPAID",
    currencyId: ctx.currency.id,
    notes: `${RUN} zero agreed amount probe`,
  });
  f.expectReject("convert lead with agreed amount 0 → 400 with a readable reason", zero, [400]);
  const zeroAfter = must(await api("GET", `/leads/${zeroLead.id}`), "zero lead reload");
  f.check("rejected conversion left the lead unconverted", !zeroAfter.storeOrder && !zeroAfter.storeOrderId, `status=${zeroAfter.status?.code}`);
  f.rec({ type: "Lead", id: zeroLead.id, number: zeroLead.leadNumber, name: `${RUN} Customer Zero`, route: "lead", notes: "Validation probe — conversion with 0.00 must be refused; stays a lead" });
}

// ================================================================== FLOW 2
async function flowShippingAndReturn(f) {
  const PRICE = 450;
  const SHIP = 30;
  // Order B — delivered.
  const { order: orderB } = await leadToOrder(f, "Customer B", { qty: 1, agreed: PRICE });
  ctx.orderB = orderB;
  await reportAndConfirm(f, orderB, PRICE, "Customer B");
  const invB = await generateInvoice(orderB);
  const costRes = await api("POST", `/store-orders/${orderB.id}/shipments/shipping-cost`, {
    baseShippingCost: SHIP,
    costPaidBy: "COMPANY",
    notes: `${RUN} carrier cost`,
  });
  f.check("shipping cost recorded on the shipment", costRes.ok, `${costRes.status} ${costRes.message}`);
  const steps = {};
  for (const step of ["ship", "out-for-delivery", "deliver"]) {
    const res = await api("POST", `/store-orders/${orderB.id}/shipments/${step}`);
    steps[step] = res;
    f.check(`shipment ${step}`, res.ok, `${res.status} ${res.json?.status ?? res.message}`);
  }
  const shipments = items((await api("GET", `/store-orders/${orderB.id}/shipments`)).json);
  const shipment = shipments[shipments.length - 1] ?? steps.deliver?.json;
  f.check("shipment status DELIVERED after reload", shipment?.status === "DELIVERED", shipment?.status);

  const invBJes = await waitJes("SALES_INVOICE", invB.id);
  const invBJe = invBJes[0] ? await jeInfo(invBJes[0].id) : null;
  const cogsB = invBJe ? sumLines(invBJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "debit") : null;
  f.check("COGS JE exists for the delivered order (1 × 40)", invBJe && eq(cogsB, 40) && eq(sumLines(invBJe, onAccount(ctx.settings.inventoryAccountId), "credit"), 40), invBJe ? `${invBJe.number} COGS ${cogsB}` : "no invoice JE");
  const movesB = (await movementsFor(ctx.book.id)).filter((m) => m.referenceId === invB.id);
  f.check("stock movement SALES_DELIVERY −1 for the delivered order", movesB.some((m) => m.type === "SALES_DELIVERY" && eq(m.quantity, -1)), movesB.map((m) => `${m.movementNumber} ${m.quantity}`).join(","));
  const shipJes = shipment?.id ? await waitJes("SHIPMENT_COST", shipment.id) : [];
  let shipJe = null;
  if (shipJes[0]) shipJe = await jeInfo(shipJes[0].id);
  f.check("shipping cost JE posted once on delivery (= 30)", shipJes.length === 1 && shipJe?.balanced && eq(shipJe.dr, SHIP), shipJe ? `${shipJe.number} Dr ${shipJe.dr}` : `${shipJes.length} JE(s)`);
  if (shipment?.id) {
    const retryDeliver = await api("POST", `/store-orders/${orderB.id}/shipments/deliver`);
    const shipJes2 = await jesFor("SHIPMENT_COST", shipment.id);
    f.check("re-deliver is idempotent or refused — still ONE shipping-cost JE", shipJes2.length === 1 && (retryDeliver.ok || (retryDeliver.status >= 400 && retryDeliver.status < 500)), `retry ${retryDeliver.status} ${retryDeliver.message}; ${shipJes2.length} JE(s)`);
  }
  const tr = await trace("STORE_ORDER", orderB.id);
  f.check("order traceability lists invoice, payment, shipment", tr.ok && tr.groups.length > 0, tr.ok ? tr.groups.map((g) => `${g.key}:${g.state}:${g.items.length}`).join(" ") : tr.message);

  f.rec({ type: "StoreOrder", id: orderB.id, number: orderB.internalOrderId, route: "storeOrder", journalEntries: [invBJe, shipJe].filter(Boolean).map(jeRef), stockMovements: movesB.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })), expected: { total: PRICE, paid: PRICE, shippingCost: SHIP, cogs: 40, shipment: "DELIVERED" } });
  f.rec({ type: "SalesInvoice", id: invB.id, number: invB.invoiceNumber, route: "salesInvoice", journalEntries: invBJe ? [jeRef(invBJe)] : [], expected: { grandTotal: PRICE, cogs: 40 } });
  if (shipment?.id) f.rec({ type: "Shipment", id: shipment.id, number: `Shipment #${shipment.attemptNumber ?? 1} of ${orderB.internalOrderId}`, route: "storeOrder", url: webUrl("storeOrder", orderB.id), journalEntries: shipJe ? [jeRef(shipJe)] : [], expected: { status: "DELIVERED", shippingCost: SHIP } });
  ctx.expectedPartnerClosing[orderB.partnerId] = { control: "RECEIVABLE", closing: 0, open: 0, label: "Customer B" };

  // Order C — delivered then returned (separate lifecycle branch).
  const { order: orderC } = await leadToOrder(f, "Customer C Return", { qty: 1, agreed: PRICE });
  ctx.orderC = orderC;
  await reportAndConfirm(f, orderC, PRICE, "Customer C");
  const invC = await generateInvoice(orderC);
  for (const step of ["ship", "out-for-delivery", "deliver"]) {
    const res = await api("POST", `/store-orders/${orderC.id}/shipments/${step}`);
    f.check(`order C shipment ${step}`, res.ok, `${res.status} ${res.message}`);
  }
  const stockBefore = await onHand(ctx.book.id, ctx.warehouse.id);
  const invCFull = must(await api("GET", `/sales/invoices/${invC.id}`), "invoice C");
  const line = (invCFull.items ?? [])[0];
  const ret = must(
    await api("POST", "/sales/returns", {
      partnerId: invCFull.partnerId,
      salesInvoiceId: invC.id,
      currencyId: ctx.currency.id,
      referenceNumber: `${RUN} return`,
      internalNotes: `${RUN} customer returned the delivered book`,
      items: [
        {
          productId: line.productId,
          warehouseId: line.warehouseId ?? ctx.warehouse.id,
          unitId: line.unitId ?? ctx.unit.id,
          quantity: 1,
          unitPrice: n(line.unitPrice),
          salesInvoiceItemId: line.id,
        },
      ],
    }),
    "create sales return",
  );
  const over = await api("POST", "/sales/returns", {
    partnerId: invCFull.partnerId,
    salesInvoiceId: invC.id,
    currencyId: ctx.currency.id,
    referenceNumber: `${RUN} over-return probe`,
    items: [{ productId: line.productId, warehouseId: ctx.warehouse.id, unitId: line.unitId ?? ctx.unit.id, quantity: 5, unitPrice: n(line.unitPrice), salesInvoiceItemId: line.id }],
  });
  f.expectReject("returning more than invoiced is rejected", over, [400]);
  if (over.ok && over.json?.id) f.rec({ type: "SalesReturn", id: over.json.id, number: over.json.returnNumber, route: "salesReturn", notes: "UNEXPECTED: over-return draft accepted (probe)" });
  const retDoc = await advance("/sales/returns", ret.id, ["CONFIRMED", "CLOSED"]);
  const retJes = await waitJes("SALES_RETURN", ret.id);
  const retJe = retJes[0] ? await jeInfo(retJes[0].id) : null;
  f.check("sales return JE balanced; reverses revenue (Dr) and AR (Cr) = 450", retJe?.balanced && eq(sumLines(retJe, onAccount(ctx.settings.accountsReceivableAccountId), "credit"), PRICE), retJe ? retJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | ") : "no JE");
  f.check("sales return reverses COGS (Dr inventory / Cr COGS = 40)", retJe && eq(sumLines(retJe, onAccount(ctx.settings.inventoryAccountId), "debit"), 40) && eq(sumLines(retJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "credit"), 40), retJe ? `inv Dr ${sumLines(retJe, onAccount(ctx.settings.inventoryAccountId), "debit")} COGS Cr ${sumLines(retJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "credit")}` : "no JE");
  const stockAfter = await onHand(ctx.book.id, ctx.warehouse.id);
  const retMoves = (await movementsFor(ctx.book.id)).filter((m) => m.referenceId === ret.id);
  f.check("stock back +1 after the return", eq(stockAfter - stockBefore, 1) && retMoves.some((m) => m.type === "SALES_RETURN" && eq(m.quantity, 1)), `before ${stockBefore} after ${stockAfter}; ${retMoves.map((m) => m.movementNumber).join(",")}`);
  const retry = await api("POST", `/sales/returns/${ret.id}/confirm`);
  const retJes2 = await jesFor("SALES_RETURN", ret.id);
  f.check("re-confirming the return posts nothing new", retJes2.length === 1, `${retry.status}; ${retJes2.length} JE(s)`);

  // Customer Refund — pays the posted return's credit back (Dr AR / Cr cash).
  const refundable = must(
    await api("GET", `/financial-transactions/refunds/refundable/${ret.id}`),
    "refundable summary for returned order",
  );
  f.check(
    "refundable amount equals return total (unrefunded credit)",
    eq(refundable.refundableAmount, PRICE) && eq(refundable.unrefundedCredit, PRICE),
    JSON.stringify(refundable),
  );
  const refund = must(
    await api("POST", "/financial-transactions/refunds/confirmed", {
      partnerId: orderC.partnerId,
      currencyId: ctx.currency.id,
      transactionDate: TODAY,
      paymentSourceId: ctx.paymentSource.id,
      receivingAccountId: ctx.receivingAccount.id,
      amount: PRICE,
      referenceNumber: `${RUN} customer refund`,
      notes: `${RUN} cash refund against return`,
      allocations: [{ invoiceId: ret.id, allocatedAmount: PRICE }],
    }),
    "create+confirm customer refund",
  );
  const refundDup = await api("POST", `/financial-transactions/refunds/${refund.id}/confirm`);
  const refundJes = await waitJes("CUSTOMER_REFUND", refund.id);
  const refundJe = refundJes[0] ? await jeInfo(refundJes[0].id) : null;
  f.check(
    "customer refund: one balanced JE of return amount (retry-safe)",
    refundJes.length === 1 && refundJe?.balanced && eq(refundJe.dr, PRICE),
    `${refundJe?.number} Dr ${refundJe?.dr}; retry ${refundDup.status}`,
  );
  f.check(
    "refund JE: Dr AR / Cr receiving account = 450",
    refundJe &&
      eq(sumLines(refundJe, onAccount(ctx.settings.accountsReceivableAccountId), "debit"), PRICE) &&
      eq(sumLines(refundJe, onAccount(ctx.receivingGlId), "credit"), PRICE),
    refundJe ? refundJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | ") : "no JE",
  );
  const afterRefundable = must(
    await api("GET", `/financial-transactions/refunds/refundable/${ret.id}`),
    "refundable after refund",
  );
  f.check(
    "after full refund: refundableAmount 0",
    eq(afterRefundable.refundableAmount, 0) && eq(afterRefundable.refundedTotal, PRICE),
    JSON.stringify(afterRefundable),
  );
  f.evidence(
    "refund",
    `Customer Refund ${refund.transactionNumber} CONFIRMED for ${PRICE} against ${retDoc.returnNumber ?? ret.id}; JE ${refundJe?.number ?? "?"}`,
  );

  f.rec({ type: "StoreOrder", id: orderC.id, number: orderC.internalOrderId, route: "storeOrder", expected: { total: PRICE, paid: PRICE, returned: PRICE, refunded: PRICE } });
  f.rec({ type: "SalesInvoice", id: invC.id, number: invC.invoiceNumber, route: "salesInvoice", expected: { grandTotal: PRICE } });
  f.rec({
    type: "SalesReturn",
    id: ret.id,
    number: retDoc.returnNumber ?? retDoc.documentNumber,
    route: "salesReturn",
    journalEntries: retJe ? [jeRef(retJe)] : [],
    stockMovements: retMoves.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })),
    expected: { total: PRICE, stockBack: 1, cogsReversed: 40, refund: refund.transactionNumber },
  });
  f.rec({
    type: "CustomerRefund",
    id: refund.id,
    number: refund.transactionNumber,
    route: "customerRefund",
    url: `${BASE}/sales/refunds/${refund.id}`,
    journalEntries: refundJe ? [jeRef(refundJe)] : [],
    expected: { amount: PRICE, status: "CONFIRMED", againstReturn: retDoc.returnNumber },
  });
  if (retJe) f.rec({ type: "JournalEntry", id: retJe.id, number: retJe.number, route: "journalEntry", notes: "Sales return reversal JE" });
  if (refundJe) f.rec({ type: "JournalEntry", id: refundJe.id, number: refundJe.number, route: "journalEntry", notes: "Customer refund JE" });
  ctx.expectedPartnerClosing[orderC.partnerId] = {
    control: "RECEIVABLE",
    closing: 0,
    open: 0,
    label: "Customer C Return (return then full cash refund)",
  };
}

// ================================================================== FLOW 3
async function flowB2BCustomer(f) {
  const cust = ctx.b2bCustomer;
  f.check("customer persisted as written (reload)", cust.name === cust._sent.name && (cust.mobile ?? cust.phone ?? "").replace(/\D/g, "").endsWith(cust._sent.mobile.replace(/\D/g, "").slice(-8)), `${cust.name} ${cust.mobile}`);
  f.rec({ type: "Customer", id: cust.id, number: cust.partnerNumber, name: cust.name, route: "customer" });
  const QTY = 3;
  const PRICE = 500;
  const TOTAL = QTY * PRICE;
  const line = { productId: ctx.book.id, unitId: ctx.book.unitId ?? ctx.unit.id, warehouseId: ctx.warehouse.id, quantity: QTY, unitPrice: PRICE, notes: `${RUN} line` };

  const bad = await api("POST", "/sales/quotations", { partnerId: cust.id, currencyId: ctx.currency.id, items: [{ ...line, quantity: 0 }] });
  f.expectReject("quotation with quantity 0 → 400 validation message", bad, [400]);

  const q = must(await api("POST", "/sales/quotations", { partnerId: cust.id, currencyId: ctx.currency.id, referenceNumber: `${RUN} B2B`, internalNotes: `${RUN} B2B quotation`, items: [line] }), "create quotation");
  const qDoc = await advance("/sales/quotations", q.id, ["APPROVED", "CONFIRMED"]);
  const so = must(
    await api("POST", `/sales/quotations/${q.id}/convert-to-order`, {
      items: (qDoc.items ?? []).map((i) => ({ quotationItemId: i.id, warehouseId: ctx.warehouse.id, quantity: n(i.quantity) })),
    }),
    "quotation → order",
  );
  const soId = so.id ?? so.salesOrder?.id;
  const soDoc = await advance("/sales/orders", soId, ["CONFIRMED"]);
  f.check("sales order confirmed with quotation total", eq(soDoc.grandTotal, TOTAL), `${soDoc.orderNumber ?? soDoc.documentNumber} ${soDoc.grandTotal}`);
  const invRes = must(
    await api("POST", `/sales/orders/${soId}/convert-to-invoice`, {
      items: (soDoc.items ?? []).map((i) => ({ salesOrderItemId: i.id, quantity: n(i.quantity) })),
    }),
    "order → invoice",
  );
  const invId = invRes.id ?? invRes.salesInvoice?.id;
  const inv = await advance("/sales/invoices", invId, ["CONFIRMED"]);
  ctx.invoiceB2B = inv;
  f.check("sales invoice confirmed, total 1500", eq(inv.grandTotal, TOTAL), `${inv.invoiceNumber} ${inv.grandTotal}`);
  const invJes = await waitJes("SALES_INVOICE", inv.id);
  const invJe = invJes[0] ? await jeInfo(invJes[0].id) : null;
  f.check("invoice JE: AR 1500 Dr, COGS 3×40", invJe && eq(sumLines(invJe, onAccount(ctx.settings.accountsReceivableAccountId), "debit"), TOTAL) && eq(sumLines(invJe, onAccount(ctx.settings.costOfGoodsSoldAccountId), "debit"), QTY * 40), invJe ? invJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | ") : "no JE");
  ctx.invoiceB2BJe = invJe;
  const reconfirm = await api("POST", `/sales/invoices/${inv.id}/confirm`);
  f.check("re-confirming the invoice posts no second JE", (await jesFor("SALES_INVOICE", inv.id)).length === 1, `${reconfirm.status}`);

  const receipt = async (amount, label) => {
    const r = must(
      await api("POST", "/financial-transactions/receipts", {
        partnerId: cust.id,
        currencyId: ctx.currency.id,
        transactionDate: TODAY,
        paymentSourceId: ctx.paymentSource.id,
        receivingAccountId: ctx.receivingAccount.id,
        amount,
        referenceNumber: `${RUN} ${label}`,
        notes: `${RUN} ${label}`,
        allocations: [{ invoiceId: inv.id, allocatedAmount: amount }],
      }),
      `receipt ${label}`,
    );
    must(await api("POST", `/financial-transactions/receipts/${r.id}/confirm`), `confirm receipt ${label}`);
    const dup = await api("POST", `/financial-transactions/receipts/${r.id}/confirm`);
    const jes = await waitJes("CUSTOMER_RECEIPT", r.id);
    const je = jes[0] ? await jeInfo(jes[0].id) : null;
    f.check(`${label}: one balanced JE of ${amount} (retry-safe)`, jes.length === 1 && je?.balanced && eq(je.dr, amount), `${je?.number} Dr ${je?.dr}; retry ${dup.status}`);
    const doc = must(await api("GET", `/financial-transactions/receipts/${r.id}`), "receipt reload");
    f.rec({ type: "CustomerReceipt", id: r.id, number: doc.transactionNumber, route: "customerReceipt", journalEntries: je ? [jeRef(je)] : [], expected: { amount, allocatedTo: inv.invoiceNumber } });
    return doc;
  };
  const over = await api("POST", "/financial-transactions/receipts", {
    partnerId: cust.id,
    currencyId: ctx.currency.id,
    paymentSourceId: ctx.paymentSource.id,
    receivingAccountId: ctx.receivingAccount.id,
    amount: 100,
    referenceNumber: `${RUN} over-allocation probe`,
    allocations: [{ invoiceId: inv.id, allocatedAmount: 5000 }],
  });
  f.expectReject("allocation larger than the receipt/invoice is rejected", over, [400]);

  await receipt(600, "partial receipt");
  let after = must(await api("GET", `/sales/invoices/${inv.id}`), "invoice reload");
  f.check("after partial receipt: PARTIALLY_PAID, remaining 900", /PARTIAL/.test(after.paymentStatus ?? "") && eq(after.remainingBalance, 900), `${after.paymentStatus} ${after.remainingBalance}`);
  await receipt(900, "final receipt");
  after = must(await api("GET", `/sales/invoices/${inv.id}`), "invoice reload");
  f.check("after full receipt: PAID, remaining 0", after.paymentStatus === "PAID" && eq(after.remainingBalance, 0), `${after.paymentStatus} ${after.remainingBalance}`);

  const st = must(await api("GET", `/accounting/reports/partner-statement?partnerId=${cust.id}&controlType=RECEIVABLE&pageSize=200`), "partner statement");
  const mv = st.movements ?? [];
  const last = mv[mv.length - 1];
  f.check("partner statement: opening 0, invoice 1500 Dr, receipts 600 + 900 Cr", eq(st.openingBalance, 0) && mv.some((m) => m.sourceType === "SALES_INVOICE" && eq(m.debit, TOTAL)) && mv.filter((m) => m.sourceType === "CUSTOMER_RECEIPT").map((m) => n(m.credit)).sort((a, b) => a - b).join() === "600,900", mv.map((m) => `${m.sourceType} ${m.debit}/${m.credit} rb=${m.runningBalance}`).join(" | "));
  f.check("partner statement closing = 0 and last running balance = closing", eq(st.closingBalance, 0) && (!last || eq(last.runningBalance, st.closingBalance)), `closing ${st.closingBalance} last rb ${last?.runningBalance}`);

  f.rec({ type: "SalesQuotation", id: q.id, number: qDoc.quotationNumber ?? qDoc.documentNumber, route: "salesQuotation", expected: { total: TOTAL, status: qDoc.status } });
  f.rec({ type: "SalesOrder", id: soId, number: soDoc.orderNumber ?? soDoc.documentNumber, route: "salesOrder", expected: { total: TOTAL } });
  f.rec({ type: "SalesInvoice", id: inv.id, number: inv.invoiceNumber, route: "salesInvoice", journalEntries: invJe ? [jeRef(invJe)] : [], expected: { grandTotal: TOTAL, paymentStatus: "PAID", cogs: QTY * 40 } });
  f.rec({ type: "PartnerStatement", id: cust.id, number: cust.partnerNumber, name: `${cust.name} statement`, route: "reports", query: `?report=customerStatement&partner=${cust.id}`, url: `${webUrl("reports")}?report=customerStatement&partner=${cust.id}`, expected: { opening: 0, closing: 0 } });
  ctx.expectedPartnerClosing[cust.id] = { control: "RECEIVABLE", closing: 0, open: 0, label: "Customer B2B" };
}

// ================================================================== FLOW 4
async function flowSupplier(f) {
  const sup = ctx.supplier;
  f.rec({ type: "Supplier", id: sup.id, number: sup.partnerNumber, name: sup.name, route: "supplier" });
  const QTY = 10;
  const PRICE = 35;
  const TOTAL = QTY * PRICE;
  const pq = must(
    await api("POST", "/purchasing/quotations", {
      partnerId: sup.id,
      currencyId: ctx.currency.id,
      purchaseType: "INVENTORY",
      referenceNumber: `${RUN} RFQ`,
      internalNotes: `${RUN} purchase quotation`,
      items: [{ productId: ctx.book.id, unitId: ctx.book.unitId ?? ctx.unit.id, warehouseId: ctx.warehouse.id, quantity: QTY, unitPrice: PRICE, notes: `${RUN} line` }],
    }),
    "create purchase quotation",
  );
  const pqDoc = await advance("/purchasing/quotations", pq.id, ["APPROVED", "CONFIRMED"]);
  const po = must(await api("POST", `/purchasing/quotations/${pq.id}/convert-to-order`), "purchase quotation → PO");
  const poId = po.id ?? po.purchaseOrder?.id;
  let poDoc = must(await api("GET", `/purchase-orders/${poId}`), "PO read");
  if (poDoc.status === "DRAFT") must(await api("POST", `/purchase-orders/${poId}/approve`), "approve PO");
  poDoc = must(await api("GET", `/purchase-orders/${poId}`), "PO read");
  const poTotal = poDoc.grandTotal ?? poDoc.total ?? (poDoc.items ?? []).reduce((sum, i) => sum + n(i.subtotal ?? n(i.quantity) * n(i.unitPrice)), 0);
  f.check("purchase order approved with quotation total", poDoc.status === "APPROVED" && eq(poTotal, TOTAL), `${poDoc.poNumber ?? poDoc.orderNumber} ${poDoc.status} ${poTotal}`);
  const movesBefore = await onHand(ctx.book.id, ctx.warehouse.id);
  const pi = must(await api("POST", `/purchase-orders/${poId}/convert-to-invoice`, { warehouseId: ctx.warehouse.id }), "PO → invoice");
  const piId = pi.id ?? pi.purchaseInvoice?.id;
  const piDoc = await advance("/purchasing/invoices", piId, ["CONFIRMED"]);
  const repost = await api("POST", `/purchasing/invoices/${piId}/confirm`);
  f.check("purchase invoice confirmed, total 350", eq(piDoc.grandTotal, TOTAL), `${piDoc.invoiceNumber} ${piDoc.grandTotal}`);
  const piJes = await waitJes("PURCHASE_INVOICE", piId);
  const piJe = piJes[0] ? await jeInfo(piJes[0].id) : null;
  f.check("purchase invoice: exactly one JE (re-confirm safe), Dr inventory 350 / Cr AP 350", piJes.length === 1 && piJe?.balanced && eq(sumLines(piJe, onAccount(ctx.settings.inventoryAccountId), "debit"), TOTAL) && eq(sumLines(piJe, onAccount(ctx.settings.accountsPayableAccountId), "credit"), TOTAL), piJe ? `${piJe.number} ${piJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | ")}; retry ${repost.status}` : `${piJes.length} JE`);
  const stockAfterPi = await onHand(ctx.book.id, ctx.warehouse.id);
  const piMoves = (await movementsFor(ctx.book.id)).filter((m) => m.referenceId === piId);
  f.check("stock receipt +10", eq(stockAfterPi - movesBefore, QTY) && piMoves.some((m) => m.type === "PURCHASE_RECEIPT"), `before ${movesBefore} after ${stockAfterPi}`);

  const pay = async (amount, label) => {
    const p = must(
      await api("POST", "/financial-transactions/payments", {
        partnerId: sup.id,
        currencyId: ctx.currency.id,
        transactionDate: TODAY,
        paymentSourceId: ctx.paymentSource.id,
        receivingAccountId: ctx.receivingAccount.id,
        amount,
        referenceNumber: `${RUN} ${label}`,
        notes: `${RUN} ${label}`,
        allocations: [{ invoiceId: piId, allocatedAmount: amount }],
      }),
      `supplier ${label}`,
    );
    must(await api("POST", `/financial-transactions/payments/${p.id}/confirm`), `confirm ${label}`);
    const jes = await waitJes("SUPPLIER_PAYMENT", p.id);
    const je = jes[0] ? await jeInfo(jes[0].id) : null;
    f.check(`${label}: one balanced JE, Dr AP ${amount}`, jes.length === 1 && je?.balanced && eq(sumLines(je, onAccount(ctx.settings.accountsPayableAccountId), "debit"), amount), je ? `${je.number} Dr ${je.dr}` : "no JE");
    const doc = must(await api("GET", `/financial-transactions/payments/${p.id}`), "payment reload");
    f.rec({ type: "SupplierPayment", id: p.id, number: doc.transactionNumber, route: "supplierPayment", journalEntries: je ? [jeRef(je)] : [], expected: { amount } });
  };
  await pay(200, "partial supplier payment");
  let piAfter = must(await api("GET", `/purchasing/invoices/${piId}`), "PI reload");
  f.check("after partial payment: remaining 150", eq(piAfter.remainingBalance, TOTAL - 200), `${piAfter.paymentStatus} ${piAfter.remainingBalance}`);
  await pay(150, "final supplier payment");
  piAfter = must(await api("GET", `/purchasing/invoices/${piId}`), "PI reload");
  f.check("after full payment: PAID, remaining 0", piAfter.paymentStatus === "PAID" && eq(piAfter.remainingBalance, 0), `${piAfter.paymentStatus} ${piAfter.remainingBalance}`);

  const piLine = (piAfter.items ?? [])[0];
  const RET_QTY = 2;
  const pr = must(
    await api("POST", "/purchasing/returns", {
      partnerId: sup.id,
      purchaseInvoiceId: piId,
      currencyId: ctx.currency.id,
      referenceNumber: `${RUN} purchase return`,
      internalNotes: `${RUN} 2 damaged books returned to supplier`,
      items: [{ productId: ctx.book.id, warehouseId: ctx.warehouse.id, unitId: piLine?.unitId ?? ctx.unit.id, quantity: RET_QTY, unitPrice: PRICE, purchaseInvoiceItemId: piLine?.id }],
    }),
    "create purchase return",
  );
  const prDoc = await advance("/purchasing/returns", pr.id, ["CONFIRMED", "CLOSED"]);
  const prJes = await waitJes("PURCHASE_RETURN", pr.id);
  const prJe = prJes[0] ? await jeInfo(prJes[0].id) : null;
  f.check("purchase return JE: Dr AP 70 / Cr inventory", prJe?.balanced && eq(sumLines(prJe, onAccount(ctx.settings.accountsPayableAccountId), "debit"), RET_QTY * PRICE), prJe ? prJe.lines.map((l) => `${l.code} ${l.debit}/${l.credit}`).join(" | ") : "no JE");
  const prMoves = (await movementsFor(ctx.book.id)).filter((m) => m.referenceId === pr.id);
  f.check("stock −2 for the purchase return", prMoves.some((m) => eq(m.quantity, -RET_QTY)), prMoves.map((m) => `${m.movementNumber} ${m.type} ${m.quantity}`).join(","));

  const st = must(await api("GET", `/accounting/reports/partner-statement?partnerId=${sup.id}&controlType=PAYABLE&pageSize=200`), "supplier statement");
  const mv = st.movements ?? [];
  // AP sign convention: closing reported as debit − credit on the payable control.
  const expectedClosing = -TOTAL + 200 + 150 + RET_QTY * PRICE; // = +70 (supplier owes us)
  const last = mv[mv.length - 1];
  f.check("supplier statement: invoice 350 Cr, payments 200+150 Dr, return 70 Dr", mv.some((m) => m.sourceType === "PURCHASE_INVOICE" && eq(m.credit, TOTAL)) && mv.filter((m) => m.sourceType === "SUPPLIER_PAYMENT").length === 2 && mv.some((m) => m.sourceType === "PURCHASE_RETURN" && eq(m.debit, RET_QTY * PRICE)), mv.map((m) => `${m.sourceType} ${m.debit}/${m.credit} rb=${m.runningBalance}`).join(" | "));
  f.check("supplier statement reconciles: closing = opening + Σ(debit−credit) = 70 debit", eq(st.closingBalance, expectedClosing) && eq(n(st.openingBalance) + mv.reduce((s, m) => s + n(m.debit) - n(m.credit), 0), st.closingBalance) && (!last || eq(last.runningBalance, st.closingBalance)), `opening ${st.openingBalance} closing ${st.closingBalance} expected ${expectedClosing}`);

  f.rec({ type: "PurchaseQuotation", id: pq.id, number: pqDoc.quotationNumber ?? pqDoc.documentNumber, route: "purchaseQuotation", expected: { total: TOTAL } });
  f.rec({ type: "PurchaseOrder", id: poId, number: poDoc.poNumber ?? poDoc.orderNumber ?? poDoc.documentNumber, route: "purchaseOrder", expected: { total: TOTAL, status: "APPROVED" } });
  f.rec({ type: "PurchaseInvoice", id: piId, number: piDoc.invoiceNumber, route: "purchaseInvoice", journalEntries: piJe ? [jeRef(piJe)] : [], stockMovements: piMoves.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })), expected: { grandTotal: TOTAL, paymentStatus: "PAID" } });
  f.rec({ type: "PurchaseReturn", id: pr.id, number: prDoc.returnNumber ?? prDoc.documentNumber, route: "purchaseReturn", journalEntries: prJe ? [jeRef(prJe)] : [], stockMovements: prMoves.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })), expected: { total: RET_QTY * PRICE } });
  f.rec({ type: "PartnerStatement", id: sup.id, number: sup.partnerNumber, name: `${sup.name} statement`, route: "reports", url: `${webUrl("reports")}?report=supplierStatement&partner=${sup.id}`, expected: { closing: st.closingBalance, closingMeaning: "supplier owes 70 (return after full payment)" } });
  ctx.expectedPartnerClosing[sup.id] = { control: "PAYABLE", closing: expectedClosing, open: 0, label: "Supplier (debit 70 after return)" };
}

// ================================================================== FLOW 5
async function flowInventory(f) {
  const p = ctx.bookLab;
  f.check("demo product persisted as written (reload)", p.name === `${RUN} Book Lab` && p.isInventoryItem === true && p.status === "ACTIVE", `${p.sku} ${p.name} ${p.status}`);
  const op = await api("POST", "/inventory/opening-balance", { productId: p.id, warehouseId: ctx.warehouse.id, quantity: 10, unitCost: 30, notes: `${RUN} opening stock (lab)` });
  f.check("opening stock 10 @ 30 posted", op.ok, `${op.status} ${op.message}`);
  const neg = await api("POST", "/inventory/opening-balance", { productId: p.id, warehouseId: ctx.warehouse.id, quantity: -5, unitCost: 30, notes: `${RUN} negative probe` });
  f.expectReject("negative opening quantity rejected", neg, [400]);
  let prod = must(await api("GET", `/products/${p.id}`), "product reload");
  f.check("valuation after opening: currentCost 30", eq(prod.currentCost, 30), `currentCost ${prod.currentCost}`);

  // Second cost layer via purchase invoice 10 @ 36 → moving average 33.
  const pi = must(
    await api("POST", "/purchasing/invoices", {
      partnerId: ctx.supplier.id,
      currencyId: ctx.currency.id,
      referenceNumber: `${RUN} lab purchase`,
      internalNotes: `${RUN} second cost layer`,
      items: [{ productId: p.id, warehouseId: ctx.warehouse.id, unitId: p.unitId ?? ctx.unit.id, quantity: 10, unitPrice: 36 }],
    }),
    "lab purchase invoice",
  );
  const piDoc = await advance("/purchasing/invoices", pi.id, ["CONFIRMED"]);
  prod = must(await api("GET", `/products/${p.id}`), "product reload");
  f.check("moving average after purchase = (10×30 + 10×36)/20 = 33", eq(prod.currentCost, 33), `currentCost ${prod.currentCost}`);

  // Sale of 4 → COGS = 4 × 33 = 132.
  const inv = must(
    await api("POST", "/sales/invoices", {
      partnerId: ctx.b2bCustomer.id,
      currencyId: ctx.currency.id,
      referenceNumber: `${RUN} lab sale`,
      internalNotes: `${RUN} COGS verification sale`,
      items: [{ productId: p.id, warehouseId: ctx.warehouse.id, unitId: p.unitId ?? ctx.unit.id, quantity: 4, unitPrice: 60 }],
    }),
    "lab sales invoice",
  );
  const invDoc = await advance("/sales/invoices", inv.id, ["CONFIRMED"]);
  const jes = await waitJes("SALES_INVOICE", inv.id);
  const je = jes[0] ? await jeInfo(jes[0].id) : null;
  const cogs = je ? sumLines(je, onAccount(ctx.settings.costOfGoodsSoldAccountId), "debit") : null;
  f.check("COGS on sale = qty × moving average = 4 × 33 = 132.00", je && eq(cogs, 132) && eq(sumLines(je, onAccount(ctx.settings.inventoryAccountId), "credit"), 132), `COGS ${cogs}`);
  const stock = await onHand(p.id, ctx.warehouse.id);
  f.check("on-hand = 10 + 10 − 4 = 16 (sum of movements)", eq(stock, 16), `onHand ${stock}`);
  const stockApi = await api("GET", `/inventory/stock?productId=${p.id}&warehouseId=${ctx.warehouse.id}`);
  const apiQty = stockApi.ok ? n(stockApi.json?.onHand ?? stockApi.json?.quantityOnHand ?? stockApi.json?.quantity ?? items(stockApi.json)[0]?.onHand) : null;
  f.check("GET /inventory/stock agrees (16)", stockApi.ok && eq(apiQty, 16), stockApi.ok ? short(stockApi.json, 200) : `${stockApi.status} ${stockApi.message}`);
  prod = must(await api("GET", `/products/${p.id}`), "product reload");
  f.check("valuation after sale: cost stays 33, stock value 16 × 33 = 528", eq(prod.currentCost, 33), `currentCost ${prod.currentCost} value ${r2(16 * n(prod.currentCost))}`);
  const moves = await movementsFor(p.id);

  // Order-level profitability for the delivered store order (flow 2).
  if (ctx.orderB) {
    const econ = await api("GET", `/store-orders/${ctx.orderB.id}/economics`);
    const e = econ.json ?? {};
    f.check("store-order economics: revenue 450, COGS 40, shipping 30", econ.ok && eq(e.netRevenue, 450) && eq(e.cogs, 40) && eq(e.shippingCost, 30), econ.ok ? short({ netRevenue: e.netRevenue, cogs: e.cogs, shippingCost: e.shippingCost, profit: e.contributionProfit ?? e.netProfit }) : `${econ.status} ${econ.message}`);
  } else {
    f.check("store-order economics (needs flow 2 order)", false, "flow 2 did not produce an order");
  }
  const prof = await api("GET", `/cost-analytics/profitability?dimension=PRODUCT&dateFrom=${TODAY}&dateTo=${TODAY}&pageSize=200`);
  const row = (prof.json?.rows ?? []).find((r) => r.dimensionValue === ctx.book.id);
  f.check(
    "profitability by product (Book): revenue & COGS consistent with store orders (1800 or 1350 after return; COGS 40/unit)",
    prof.ok && row && [1800, 1350].some((v) => eq(row.netRevenue, v)) && eq(n(row.cogs) / Math.max(n(row.totalQuantity), 1), 40),
    prof.ok ? short(row ?? "no row for the demo product") : `${prof.status} ${prof.message}`,
  );

  f.rec({ type: "Product", id: p.id, number: p.sku, name: p.name, route: "product", stockMovements: moves.map((m) => ({ id: m.id, number: m.movementNumber, type: m.type, quantity: n(m.quantity) })), expected: { onHand: 16, currentCost: 33, stockValue: 528, cogsOnSaleOf4: 132 } });
  f.rec({ type: "Product", id: ctx.book.id, number: ctx.book.sku, name: ctx.book.name, route: "product", expected: { openingStock: "100 @ 40", note: "shared demo product for flows 1-4" } });
  f.rec({ type: "PurchaseInvoice", id: pi.id, number: piDoc.invoiceNumber, route: "purchaseInvoice", expected: { grandTotal: 360, layer: "10 @ 36" } });
  f.rec({ type: "SalesInvoice", id: inv.id, number: invDoc.invoiceNumber, route: "salesInvoice", journalEntries: je ? [jeRef(je)] : [], expected: { grandTotal: 240, cogs: 132 } });
  f.rec({ type: "InventoryMovements", id: `movements-${p.id}`, name: `${p.name} movements`, url: webUrl("movements"), route: "movements", expected: { onHand: 16 } });
  ctx.expectedPartnerClosing[ctx.b2bCustomer.id] = { control: "RECEIVABLE", closing: 240, open: 240, label: "Customer B2B (+ unpaid lab sale 240)" };
  const supExp = ctx.expectedPartnerClosing[ctx.supplier.id];
  if (supExp) {
    ctx.expectedPartnerClosing[ctx.supplier.id] = { ...supExp, closing: r2(supExp.closing - 360), open: 360, label: "Supplier (70 debit after return − unpaid lab purchase 360)" };
  } else {
    ctx.expectedPartnerClosing[ctx.supplier.id] = { control: "PAYABLE", closing: null, open: 360, label: "Supplier (flow 4 incomplete)" };
  }
}

// ================================================================== FLOW 6
async function flowOther(f) {
  // Duplicate a sales invoice.
  const src = ctx.invoiceB2B;
  if (src) {
    const dup = await api("POST", `/sales/invoices/${src.id}/duplicate`);
    f.check("duplicate sales invoice → new DRAFT", dup.ok && dup.json?.status === "DRAFT" && dup.json?.id !== src.id, dup.ok ? `${dup.json.invoiceNumber} ${dup.json.status}` : `${dup.status} ${dup.message}`);
    if (dup.ok) {
      await api("PATCH", `/sales/invoices/${dup.json.id}`, { internalNotes: `${RUN} duplicated draft — intentionally never posted` });
      const copy = must(await api("GET", `/sales/invoices/${dup.json.id}`), "duplicate reload");
      f.check("duplicate copies lines/total, has no JE", eq(copy.grandTotal, src.grandTotal) && (await jesFor("SALES_INVOICE", copy.id)).length === 0, `${copy.grandTotal} vs ${src.grandTotal}`);
      f.check("duplicate edit persisted (reload)", (copy.internalNotes ?? "").includes("duplicated draft"), copy.internalNotes);
      f.rec({ type: "SalesInvoice", id: copy.id, number: copy.invoiceNumber, route: "salesInvoice", notes: "Duplicated draft — never posted", expected: { status: "DRAFT", grandTotal: n(copy.grandTotal) } });
    }
  } else {
    f.check("duplicate sales invoice (needs flow 3 invoice)", false, "flow 3 invoice missing");
  }

  // Manual JE lifecycle.
  const dr = ctx.settings.defaultExpenseAccountId ?? ctx.settings.otherExpenseAccountId;
  const cr = ctx.settings.cashAccountId;
  if (!ctx.generalJournal || !dr || !cr) {
    f.check("manual JE prerequisites (general journal, expense + cash accounts)", false, `journal=${ctx.generalJournal?.code} dr=${dr} cr=${cr}`);
  } else {
    const unbalanced = await api("POST", "/journal-entries", {
      journalId: ctx.generalJournal.id,
      description: `${RUN} unbalanced probe`,
      lines: [
        { accountId: dr, debit: 10, credit: 0 },
        { accountId: cr, debit: 0, credit: 9 },
      ],
    });
    if (unbalanced.ok) {
      const post = await api("POST", `/journal-entries/${unbalanced.json.id}/post`);
      f.expectReject("unbalanced manual JE cannot be posted", post, [400]);
      f.rec({ type: "JournalEntry", id: unbalanced.json.id, number: unbalanced.json.entryNumber, route: "journalEntry", notes: "Unbalanced DRAFT probe — must never post" });
    } else {
      f.expectReject("unbalanced manual JE rejected", unbalanced, [400]);
    }
    const draft = must(
      await api("POST", "/journal-entries", {
        journalId: ctx.generalJournal.id,
        entryDate: TODAY,
        currencyId: ctx.currency.id,
        description: `${RUN} manual demo entry`,
        referenceNumber: RUN,
        lines: [
          { accountId: dr, debit: 15, credit: 0, description: `${RUN} demo expense` },
          { accountId: cr, debit: 0, credit: 15, description: `${RUN} demo cash` },
        ],
      }),
      "create manual JE",
    );
    f.check("manual JE created as DRAFT", draft.status === "DRAFT", draft.status);
    const edit = await api("PATCH", `/journal-entries/${draft.id}`, {
      description: `${RUN} manual demo entry (edited)`,
      lines: [
        { accountId: dr, debit: 20, credit: 0, description: `${RUN} demo expense` },
        { accountId: cr, debit: 0, credit: 20, description: `${RUN} demo cash` },
      ],
    });
    let je = await jeInfo(draft.id);
    f.check("draft edit persisted (reload: 20/20, new description)", edit.ok && eq(je.dr, 20) && eq(je.cr, 20), `${edit.status} ${edit.message} Dr ${je.dr}`);
    const posted = await api("POST", `/journal-entries/${draft.id}/post`);
    f.check("manual JE posted", posted.ok && posted.json?.status === "POSTED", `${posted.status} ${posted.json?.entryNumber ?? posted.message}`);
    const lockedEdit = await api("PATCH", `/journal-entries/${draft.id}`, { description: `${RUN} edit while posted` });
    f.expectReject("posted manual JE is immutable (PATCH rejected)", lockedEdit, [400, 403, 409]);
    const reset = await api("POST", `/journal-entries/${draft.id}/reset-to-draft`);
    f.check("manual JE reset to draft", reset.ok && reset.json?.status === "DRAFT", `${reset.status} ${reset.json?.status ?? reset.message}`);
    await api("PATCH", `/journal-entries/${draft.id}`, { description: `${RUN} manual demo entry (reposted)` });
    const repost = await api("POST", `/journal-entries/${draft.id}/post`);
    je = await jeInfo(draft.id);
    f.check("manual JE reposted (POSTED, 20/20)", repost.ok && je.status === "POSTED" && eq(je.dr, 20), `${je.number} ${je.status}`);
    const acts = items((await api("GET", `/journal-entries/${draft.id}/activities`)).json);
    f.check("unpost/repost recorded in the audit trail", acts.some((a) => /UNPOST/.test(a.type ?? "")), acts.map((a) => a.type).join(","));
    f.rec({ type: "JournalEntry", id: je.id, number: je.number, route: "journalEntry", notes: "Manual JE: draft → edit → post → reset → repost", expected: { debit: 20, credit: 20, status: "POSTED" } });
  }

  // Generated-JE protection.
  const genJe = ctx.invoiceB2BJe;
  if (genJe) {
    const patch = await api("PATCH", `/journal-entries/${genJe.id}`, { description: `${RUN} tamper probe` });
    f.expectReject("PATCH on a system-generated JE is rejected", patch, [400, 403, 409]);
    const reset = await api("POST", `/journal-entries/${genJe.id}/reset-to-draft`);
    f.expectReject("reset-to-draft on a system-generated JE is rejected", reset, [400, 403, 409]);
    const after = await jeInfo(genJe.id);
    f.check("generated JE unchanged after the probes", after.status === "POSTED" && eq(after.dr, genJe.dr), `${after.number} ${after.status}`);
  } else {
    f.check("generated-JE protection (needs flow 3 invoice JE)", false, "missing");
  }

  // Fixed asset.
  const acq = monthsAgo(2);
  const asset = must(
    await api("POST", "/fixed-assets", {
      name: `${RUN} Laptop Asset`,
      acquisitionDate: acq,
      cost: 1200,
      usefulLifeMonths: 12,
      salvageValue: 0,
      depreciationStartDate: acq,
      receivingAccountId: ctx.receivingAccount.id,
      notes: `${RUN} fictional demo asset`,
    }),
    "create fixed asset",
  );
  const cap = await api("POST", `/fixed-assets/${asset.id}/capitalize`, { usefulLifeMonths: 12, salvageValue: 0, depreciationStartDate: acq, receivingAccountId: ctx.receivingAccount.id });
  f.check("fixed asset capitalized", cap.ok, `${cap.status} ${cap.json?.status ?? cap.message}`);
  const capJes = await waitJes("FIXED_ASSET_CAPITALIZATION", asset.id);
  const capJe = capJes[0] ? await jeInfo(capJes[0].id) : null;
  f.check("capitalization JE 1200 (Dr fixed assets)", capJe?.balanced && eq(sumLines(capJe, onAccount(ctx.settings.fixedAssetsAccountId), "debit"), 1200), capJe ? `${capJe.number} Dr ${capJe.dr}` : "no JE");
  const assetJes = capJe ? [jeRef(capJe)] : [];
  if (ALLOW_GLOBAL_RUNS) {
    const run1 = await api("POST", "/fixed-assets/depreciation-run", { asOf: TODAY });
    const run2 = await api("POST", "/fixed-assets/depreciation-run", { asOf: TODAY });
    f.check("depreciation run posted and is idempotent", run1.ok && run2.ok && n(run2.json?.postedCount) === 0, `first ${run1.json?.postedCount ?? run1.message} second ${run2.json?.postedCount ?? run2.message}`);
    const tr = await trace("FIXED_ASSET", asset.id);
    const depJes = tr.ok ? tr.group("JOURNAL_ENTRIES").items.filter((i) => i.sourceType === "FIXED_ASSET_DEPRECIATION" || /DEPREC/.test(i.sourceType ?? "")) : [];
    f.check("asset has depreciation JE(s) of 100/month", depJes.length >= 1, tr.ok ? tr.group("JOURNAL_ENTRIES").items.map((i) => `${i.number}:${i.sourceType}`).join(",") : tr.message);
    for (const d of depJes) assetJes.push({ id: d.id, number: d.number, sourceType: d.sourceType });
  } else {
    f.evidence("depreciationRun", "SKIPPED — company-wide batch; set ALLOW_GLOBAL_RUNS=1 to run it (posts every due asset, not only demo ones)");
  }
  f.rec({ type: "FixedAsset", id: asset.id, number: asset.code ?? asset.assetNumber, name: asset.name, route: "fixedAssets", url: webUrl("fixedAssets"), journalEntries: assetJes, expected: { cost: 1200, monthlyDepreciation: 100, usefulLifeMonths: 12 } });

  // Prepaid expense.
  const ppStart = monthsAgo(2);
  const ppEnd = (() => {
    const d = new Date(`${ppStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 3);
    d.setUTCDate(0);
    return isoDay(d);
  })();
  const pp = must(
    await api("POST", "/prepaid-expenses", {
      name: `${RUN} Prepaid Insurance`,
      amount: 300,
      startDate: ppStart,
      endDate: ppEnd,
      totalPeriods: 3,
      expenseAccountId: ctx.settings.defaultExpenseAccountId ?? ctx.settings.otherExpenseAccountId ?? ctx.settings.shippingExpenseAccountId,
      receivingAccountId: ctx.receivingAccount.id,
      currencyId: ctx.currency.id,
      notes: `${RUN} fictional prepaid`,
    }),
    "create prepaid",
  );
  const act = await api("POST", `/prepaid-expenses/${pp.id}/activate`);
  f.check("prepaid activated", act.ok, `${act.status} ${act.json?.status ?? act.message}`);
  const ppJes = await waitJes("PREPAID_EXPENSE", pp.id);
  const ppJe = ppJes[0] ? await jeInfo(ppJes[0].id) : null;
  f.check("prepaid payment JE 300 (Dr prepayments)", ppJe?.balanced && eq(sumLines(ppJe, onAccount(ctx.settings.prepaymentsAccountId), "debit"), 300), ppJe ? `${ppJe.number}` : "no JE");
  const ppRefs = ppJe ? [jeRef(ppJe)] : [];
  if (ALLOW_GLOBAL_RUNS) {
    const rec1 = await api("POST", "/prepaid-expenses/recognize", { asOf: TODAY });
    const rec2 = await api("POST", "/prepaid-expenses/recognize", { asOf: TODAY });
    f.check("recognition run posted and is idempotent", rec1.ok && rec2.ok && n(rec2.json?.postedCount) === 0, `first ${rec1.json?.postedCount ?? rec1.message} second ${rec2.json?.postedCount ?? rec2.message}`);
    const tr = await trace("PREPAID_EXPENSE", pp.id);
    const recJes = tr.ok ? tr.group("JOURNAL_ENTRIES").items.filter((i) => /RECOGN/.test(i.sourceType ?? "")) : [];
    f.check("prepaid has recognition JE(s) of 100", recJes.length >= 1, tr.ok ? tr.group("JOURNAL_ENTRIES").items.map((i) => `${i.number}:${i.sourceType}`).join(",") : tr.message);
    for (const d of recJes) ppRefs.push({ id: d.id, number: d.number, sourceType: d.sourceType });
  } else {
    f.evidence("prepaidRecognition", "SKIPPED — company-wide batch; set ALLOW_GLOBAL_RUNS=1");
  }
  f.rec({ type: "PrepaidExpense", id: pp.id, number: pp.code ?? pp.prepaidNumber, name: pp.name, route: "prepaidExpenses", url: webUrl("prepaidExpenses"), journalEntries: ppRefs, expected: { amount: 300, periods: 3, perPeriod: 100 } });

  // Traceability.
  if (ctx.invoiceA && ctx.orderA) {
    const ti = await trace("SALES_INVOICE", ctx.invoiceA.id);
    const invJeIds = (await jesFor("SALES_INVOICE", ctx.invoiceA.id)).map((j) => j.id);
    const all = ti.ok ? ti.groups.flatMap((g) => g.items.map((i) => i.id)) : [];
    f.check("trace(invoice) → its JE and its store order", ti.ok && invJeIds.every((id) => all.includes(id)) && all.includes(ctx.orderA.id), ti.ok ? ti.groups.map((g) => `${g.key}:${g.items.map((i) => i.number).join("/")}`).join(" ") : ti.message);
    const payId = recordIndex.find((r) => r.type === "Payment" && r.flow === "F1")?.id;
    if (payId) {
      const tp = await trace("PAYMENT", payId);
      const pAll = tp.ok ? tp.groups.flatMap((g) => g.items.map((i) => i.id)) : [];
      const rc = recordIndex.find((r) => r.type === "CustomerReceipt" && r.flow === "F1");
      f.check("trace(payment) → order + receipt/JE", tp.ok && pAll.includes(ctx.orderA.id) && (!rc || pAll.includes(rc.id) || rc.journalEntries.some((j) => pAll.includes(j.id))), tp.ok ? tp.groups.map((g) => `${g.key}:${g.items.map((i) => i.number).join("/")}`).join(" ") : tp.message);
    }
    const to = await trace("STORE_ORDER", ctx.orderA.id);
    const oAll = to.ok ? to.groups.flatMap((g) => g.items.map((i) => i.id)) : [];
    f.check("trace(order) → invoice + payment", to.ok && oAll.includes(ctx.invoiceA.id) && (!payId || oAll.includes(payId)), to.ok ? to.groups.map((g) => `${g.key}:${g.items.map((i) => i.number).join("/")}`).join(" ") : to.message);
  } else {
    f.check("traceability (needs flow 1 records)", false, "missing flow 1 invoice/order");
  }
}

// ================================================================== FLOW 7
async function flowReports(f) {
  const range = `dateFrom=${ctx.runDateFrom}&dateTo=${TODAY}`;
  const tbRun = must(await api("GET", `/accounting/reports/trial-balance?${range}&pageSize=200`), "TB (run range)");
  f.check("Trial Balance (RUN range) debits = credits", eq(tbRun.totals?.debitTotal, tbRun.totals?.creditTotal), short(tbRun.totals));
  const tbAll = must(await api("GET", `/accounting/reports/trial-balance?dateTo=${TODAY}&pageSize=200`), "TB (overall)");
  f.check("Trial Balance (overall) debits = credits", eq(tbAll.totals?.debitTotal, tbAll.totals?.creditTotal), short(tbAll.totals));

  // GL closing per touched account = TB closing (same range).
  const s = ctx.settings;
  const touched = [
    ["AR", s.accountsReceivableAccountId],
    ["AP", s.accountsPayableAccountId],
    ["Revenue", s.salesRevenueAccountId],
    ["COGS", s.costOfGoodsSoldAccountId],
    ["Inventory", s.inventoryAccountId],
    ["Receiving GL", ctx.receivingGlId],
  ].filter(([, id]) => id);
  const tbItems = items(tbRun);
  const mismatches = [];
  for (const [label, accountId] of touched) {
    const gl = await api("GET", `/accounting/reports/general-ledger?${range}&accountId=${accountId}&pageSize=200`);
    const glRow = items(gl.json).find((r) => (r.account?.id ?? r.accountId) === accountId);
    const tbRow = tbItems.find((r) => r.accountId === accountId);
    const ok = gl.ok && glRow && tbRow && eq(glRow.closingBalance, tbRow.closingBalance);
    f.check(`GL closing = TB closing — ${label}`, ok, gl.ok ? `GL ${glRow?.closingBalance} TB ${tbRow?.closingBalance}` : `${gl.status} ${gl.message}`);
    if (!ok) mismatches.push(label);
    if (gl.ok && glRow) {
      const mv = glRow.movements ?? [];
      const last = mv[mv.length - 1];
      if (mv.length && mv.length === n(glRow.movementCount ?? mv.length)) {
        f.check(`GL running balance ends at closing — ${label}`, !last || eq(last.runningBalance, glRow.closingBalance), `last rb ${last?.runningBalance} closing ${glRow.closingBalance}`);
      }
    }
  }

  // P&L vs Balance Sheet current earnings.
  const bs = must(await api("GET", `/accounting/reports/balance-sheet?dateTo=${TODAY}`), "balance sheet");
  f.check("Balance Sheet balanced (A = L + E)", bs.totals?.balanced === true && eq(bs.totals.totalAssets, n(bs.totals.totalLiabilities) + n(bs.totals.totalEquity), 0.05), short(bs.totals));
  const fyFrom = ctx.fiscalYear ? isoDay(new Date(ctx.fiscalYear.startDate)) : null;
  const isFy = fyFrom ? await api("GET", `/accounting/reports/income-statement?dateFrom=${fyFrom}&dateTo=${TODAY}`) : null;
  const isAll = await api("GET", `/accounting/reports/income-statement?dateTo=${TODAY}`);
  const ni = [isFy?.json?.totals?.netIncome, isAll.json?.totals?.netIncome].filter((v) => v != null);
  f.check("P&L net income = Balance Sheet current earnings", ni.some((v) => eq(v, bs.currentEarnings, 0.05)), `NI(FY)=${isFy?.json?.totals?.netIncome} NI(all)=${isAll.json?.totals?.netIncome} BS currentEarnings=${bs.currentEarnings}`);
  const isRun = await api("GET", `/accounting/reports/income-statement?${range}`);
  f.check("Income Statement (RUN range) runs", isRun.ok, isRun.ok ? short(isRun.json?.totals) : `${isRun.status} ${isRun.message}`);

  const cf = await api("GET", `/accounting/reports/cash-flow?${range}`);
  const cfm = await api("GET", `/accounting/reports/cash-flow?view=movement&${range}`);
  f.check("Cash Flow runs (activities + movement views)", cf.ok && cfm.ok, `${cf.status}/${cfm.status} ${cf.ok ? short(cf.json?.totals) : cf.message}`);

  // Partner statements vs control-account balances.
  for (const [partnerId, exp] of Object.entries(ctx.expectedPartnerClosing ?? {})) {
    const st = await api("GET", `/accounting/reports/partner-statement?partnerId=${partnerId}&controlType=${exp.control}&pageSize=200`);
    if (!st.ok) {
      f.check(`statement ${exp.label}`, false, `${st.status} ${st.message}`);
      continue;
    }
    const closing = n(st.json.closingBalance);
    const mv = st.json.movements ?? [];
    // Independent recomputation from the posted JE lines of every movement.
    let fromJe = 0;
    const jeIds = [...new Set(mv.map((m) => m.journalEntryId))];
    for (const id of jeIds) {
      const je = await jeInfo(id);
      fromJe += je.lines.filter((l) => l.partnerId === partnerId && l.control === exp.control).reduce((sum, l) => sum + l.debit - l.credit, 0);
    }
    fromJe = r2(n(st.json.openingBalance) + fromJe);
    if (exp.closing != null) f.check(`statement closing = expected — ${exp.label}`, eq(closing, exp.closing), `closing ${closing} expected ${exp.closing}`);
    f.check(`statement closing = Σ partner lines on ${exp.control} control (JE)`, eq(fromJe, closing), `JE-derived ${fromJe} vs statement ${closing}`);
    const agingPath = exp.control === "RECEIVABLE" ? "ar-aging" : "ap-aging";
    const aging = await api("GET", `/accounting/reports/${agingPath}?partnerId=${partnerId}`);
    if (aging.ok) {
      const tot = n(aging.json?.totals?.total);
      f.check(`${agingPath} total = open invoice balance — ${exp.label}`, eq(tot, exp.open), `aging total ${tot} expected open ${exp.open} (statement closing ${closing})`);
    }
  }
  f.rec({ type: "Report", id: "trial-balance", name: "Trial Balance (RUN range)", url: `${webUrl("reports")}?report=trialBalance`, route: "reports", expected: { balanced: true, debit: tbRun.totals?.debitTotal } });
  f.rec({ type: "Report", id: "general-ledger", name: "General Ledger", url: `${webUrl("reports")}?report=generalLedger`, route: "reports", expected: { glEqualsTb: mismatches.length === 0 } });
  f.rec({ type: "Report", id: "balance-sheet", name: "Balance Sheet", url: `${webUrl("reports")}?report=balanceSheet`, route: "reports", expected: { balanced: bs.totals?.balanced } });
  f.rec({ type: "Report", id: "income-statement", name: "Income Statement", url: `${webUrl("reports")}?report=incomeStatement`, route: "reports" });
  f.rec({ type: "Report", id: "cash-flow", name: "Cash Flow", url: `${webUrl("reports")}?report=cashFlow`, route: "reports" });
}

// ------------------------------------------------------------------ outputs
function writeOutputs() {
  mkdirSync(OUT, { recursive: true });
  report.finishedAt = new Date().toISOString();
  report.summary = Object.fromEntries(report.flows.map((fl) => [fl.id, `${fl.status} (${fl.checks.filter((c) => c.pass).length}/${fl.checks.length})`]));
  report.failedChecks = report.flows.flatMap((fl) => fl.checks.filter((c) => !c.pass).map((c) => `${fl.id} ${c.name}: ${c.detail}`));
  report.routeVerification = routeChecked;
  writeFileSync(resolve(OUT, "data-tour-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(resolve(OUT, "demo-record-index.json"), JSON.stringify({ run: RUN, base: BASE, currency: report.functionalCurrency, records: recordIndex }, null, 2));

  const order = ["SETUP", "F1", "F2", "F3", "F4", "F5", "F6", "F7"];
  const lines = [
    `# Acceptance walkthrough — ${RUN}`,
    "",
    `Environment: ${BASE} · currency ${report.functionalCurrency ?? "?"} · generated ${report.finishedAt}`,
    "",
    "All records below are fictional demo data tagged with the RUN id. Walk them top to bottom.",
    "",
    "| Flow | Status |",
    "| --- | --- |",
    ...report.flows.map((fl) => `| ${fl.id} ${fl.name} | ${fl.status} |`),
    "",
  ];
  for (const flowId of order) {
    const recs = recordIndex.filter((r) => r.flow === flowId);
    if (!recs.length) continue;
    const fl = report.flows.find((x) => x.id === flowId);
    lines.push(`## ${flowId} ${fl?.name ?? ""}`, "");
    for (const r of recs) {
      const label = `${r.type} ${r.number ?? r.name ?? r.id}`;
      const exp = Object.keys(r.expected ?? {}).length ? ` — expect ${Object.entries(r.expected).map(([k, v]) => `${k}=${v}`).join(", ")}` : "";
      lines.push(`- ${r.url ? `[${label}](${r.url})` : label}${exp}${r.notes ? ` _(${r.notes})_` : ""}`);
      for (const je of r.journalEntries ?? []) lines.push(`  - JE [${je.number}](${webUrl("journalEntry", je.id)})`);
    }
    lines.push("");
  }
  writeFileSync(resolve(OUT, "walkthrough.md"), lines.join("\n"));
}

// ------------------------------------------------------------------ main
async function main() {
  console.log(`Data tour ${RUN}\n  web ${BASE}\n  api ${API}\n  user ${EMAIL}\n  global batch runs ${ALLOW_GLOBAL_RUNS ? "ON" : "OFF"}`);
  if (!PW) {
    report.blockers.push("BLOCKER: no password — set PW (or QA_PASSWORD in tmp/.qa.env).");
    return;
  }
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW, rememberMe: true }),
  })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }))
    .catch((e) => ({ status: 0, json: { message: e.message } }));
  token = login.json?.accessToken ?? "";
  if (!token) {
    report.blockers.push(`BLOCKER: login failed for ${EMAIL} → ${login.status} ${login.json?.code ?? login.json?.message ?? ""}`);
    return;
  }
  ctx.runDateFrom = TODAY;
  ctx.expectedPartnerClosing = {};

  const setupFlow = await runFlow("SETUP", "Master data lookups + demo products/partners/opening stock", async (f) => {
    await setup();
    f.check("functional currency resolved", Boolean(ctx.currency), ctx.currency?.code);
    f.check("demo products created (ACTIVE inventory items)", ctx.book?.status === "ACTIVE" && ctx.bookLab?.status === "ACTIVE", `${ctx.book?.sku} ${ctx.bookLab?.sku}`);
    f.check("opening stock posted for Book (100 @ 40)", Boolean(ctx.bookOpening), short(ctx.bookOpening, 120));
    f.evidence("masterData", {
      currency: ctx.currency?.code,
      warehouse: ctx.warehouse?.name,
      unit: ctx.unit?.name,
      category: ctx.category?.name,
      country: ctx.country?.code,
      receivingAccount: ctx.receivingAccount?.name,
      paymentSource: ctx.paymentSource?.name,
      journal: ctx.generalJournal?.code,
    });
    f.rec({ type: "Product", id: ctx.book.id, number: ctx.book.sku, name: ctx.book.name, route: "product", expected: { openingStock: "100 @ 40" } });
    f.rec({ type: "Product", id: ctx.bookLab.id, number: ctx.bookLab.sku, name: ctx.bookLab.name, route: "product" });
    f.rec({ type: "Customer", id: ctx.b2bCustomer.id, number: ctx.b2bCustomer.partnerNumber, name: ctx.b2bCustomer.name, route: "customer" });
    f.rec({ type: "Supplier", id: ctx.supplier.id, number: ctx.supplier.partnerNumber, name: ctx.supplier.name, route: "supplier" });
  });
  if (setupFlow.status !== "PASS" && !ctx.book) {
    for (const [id, name] of FLOWS) {
      report.flows.push({ id, name, status: "BLOCKED", checks: [], evidence: {}, records: [], error: `setup: ${setupFlow.error}` });
    }
    return;
  }
  for (const [id, name, fn] of FLOWS) await runFlow(id, name, fn);
}

const FLOWS = [
  ["F1", "Leads → store orders → Confirm & Post → invoice (idempotency, settlement, validation)", flowLeadsStoreOrders],
  ["F2", "Shipping/delivery + separate delivered-then-returned order", flowShippingAndReturn],
  ["F3", "B2B customer: quotation → order → invoice → partial/full receipt → statement", flowB2BCustomer],
  ["F4", "Supplier: RFQ → PO → invoice → partial/full payment → return → statement", flowSupplier],
  ["F5", "Inventory: opening stock, moving average, COGS, valuation, profitability", flowInventory],
  ["F6", "Duplicate invoice, manual JE lifecycle, generated-JE protection, assets, prepaid, traceability", flowOther],
  ["F7", "Reports reconciliation (TB, GL, P&L vs BS, cash flow, partner statements)", flowReports],
];

main()
  .catch((error) => {
    report.blockers.push(`fatal: ${error.message}`);
    console.error(error);
  })
  .finally(() => {
    try {
      writeOutputs();
      console.log(`\nSummary: ${JSON.stringify(report.summary)}`);
      console.log(`Report: ${resolve(OUT, "data-tour-report.json")}`);
    } catch (error) {
      console.error("could not write outputs", error);
    }
    process.exit(0);
  });
