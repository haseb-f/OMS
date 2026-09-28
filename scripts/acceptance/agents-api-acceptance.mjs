#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Agents / Fulfillment Partners — API lifecycle acceptance (specs/agents-fulfillment-partners,
 * brief §12). Real logins per persona over HTTP; every record is tagged DEMO-AGT-20260928.
 *
 *   node scripts/acceptance/agents-api-acceptance.mjs
 *   API=https://oms.haseb.org/api node scripts/acceptance/agents-api-acceptance.mjs
 *
 * Prerequisite: apps/api/prisma/scripts/ensure-agents-demo.ts has run against the target
 * (demo agents A/B, agreements, destinations, products + stock, users) and the internal QA
 * personas exist (ensure-qa-users.ts). Passwords come from env or tmp/.qa.env:
 *   QA_PASSWORD (qa-admin / qa-finance / qa-shipping), AGENT_DEMO_PASSWORD (demo agent users).
 * Passwords are never printed.
 *
 * Env: API (default http://localhost:3005), ONLY_SKIP_AGREEMENT=1 skips the effective-dated
 *      agreement change (it permanently ends agent A's current agreement tomorrow).
 * Output: tmp/agents-acceptance/agents-api-acceptance-<RUN>.json (+ latest.json) and a PASS/FAIL table.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
(function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1).replace(/^["']|["']$/g, "");
  }
})(resolve(ROOT, "tmp/.qa.env"));

const TAG = "DEMO-AGT-20260928";
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const RUN = `${TAG}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const OUT = resolve(ROOT, "tmp/agents-acceptance");
mkdirSync(OUT, { recursive: true });

const QA_PW = process.env.QA_PASSWORD ?? "";
const AGENT_PW = process.env.AGENT_DEMO_PASSWORD ?? "";
if (!QA_PW || !AGENT_PW) {
  console.error("QA_PASSWORD and AGENT_DEMO_PASSWORD are required (env or tmp/.qa.env).");
  process.exit(2);
}
const PERSONAS = {
  admin: ["qa-admin@oms.haseb.org", QA_PW],
  fin: ["qa-finance@oms.haseb.org", QA_PW],
  ship: ["qa-shipping@oms.haseb.org", QA_PW],
  aAdmin: ["agent-a-admin.demo-agt@oms.local", AGENT_PW],
  aS1: ["agent-a-sales1.demo-agt@oms.local", AGENT_PW],
  aS2: ["agent-a-sales2.demo-agt@oms.local", AGENT_PW],
  bAdmin: ["agent-b-admin.demo-agt@oms.local", AGENT_PW],
  bS1: ["agent-b-sales1.demo-agt@oms.local", AGENT_PW],
};

// ───────────────────────────────────────────────────────────── helpers
const r2 = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) <= eps;
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const plusDays = (n) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const key = (label) => `${RUN}-${label}`;
const mobile = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const tokens = {};
async function login(p) {
  if (tokens[p]) return tokens[p];
  const [email, password] = PERSONAS[p];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.accessToken) throw new Error(`login ${email} → ${res.status} ${json.code ?? json.message ?? ""}`);
  tokens[p] = json.accessToken;
  return tokens[p];
}
const httpLog = [];
async function call(p, method, path, body, extraHeaders = {}) {
  const token = await login(p);
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  httpLog.push({ p, method, path, status: res.status, ...(res.status >= 400 ? { error: errText(json) } : {}) });
  return { status: res.status, ok: res.status < 300, json };
}
function errText(json) {
  if (!json) return "";
  const msg = Array.isArray(json.message) ? json.message.join("; ") : json.message;
  return [json.code, typeof msg === "string" ? msg : JSON.stringify(msg), json.raw].filter(Boolean).join(" ").slice(0, 400);
}
async function must(p, method, path, body, headers) {
  const r = await call(p, method, path, body, headers);
  if (!r.ok) throw new Fail(`${method} ${path} as ${p} → ${r.status} ${errText(r.json)}`);
  return r.json;
}

class Fail extends Error {}
class Blocked extends Error {}
const expect = (cond, msg) => {
  if (!cond) throw new Fail(msg);
};
const eq = (actual, expected, label) =>
  expect(near(actual, expected), `${label}: expected ${expected}, got ${actual}`);
const need = (v, what) => {
  if (v === undefined || v === null) throw new Blocked(`dependency missing: ${what}`);
  return v;
};

const results = [];
async function step(id, title, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, status: "PASS", detail: detail ?? "", ms: Date.now() - t0 });
    console.log(`PASS    ${id} ${title}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
  } catch (e) {
    const status = e instanceof Blocked ? "BLOCKED" : "FAIL";
    results.push({ id, title, status, detail: e.message, ms: Date.now() - t0 });
    console.log(`${status.padEnd(7)} ${id} ${title} — ${e.message.slice(0, 400)}`);
  }
}

// ───────────────────────────────────────────────────────────── context
const ctx = { run: RUN, api: API, orders: {}, payouts: [], refs: {} };

const ledger = async (orderId) =>
  (await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/ledger?storeOrderId=${orderId}&pageSize=200`)).items ??
  [];
const sumType = (entries, type, field) =>
  r2(entries.filter((e) => e.entryType === type).reduce((s, e) => s + Number(e[field] ?? 0), 0));
const countType = (entries, type) => entries.filter((e) => e.entryType === type).length;
const preview = (agentId) => must("fin", "GET", `/agent-finance/agents/${agentId}/payouts/preview`);
const portalOrder = (p, id) => must(p, "GET", `/agent-portal/orders/${id}`);

async function stageProof(p, label) {
  // 1×1 PNG proof of payment
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), `proof-${label}-${RUN}.png`);
  const staged = await must(p, "POST", "/attachments/staging", form);
  return staged.id;
}
async function declare(p, orderId, fields, idemKey) {
  return must(p, "POST", `/agent-portal/orders/${orderId}/payment-declaration`, {
    paymentDate: TODAY,
    reference: `${RUN}-${fields.kind}`,
    idempotencyKey: idemKey,
    ...fields,
  });
}
async function ship(orderId, { deliver = true } = {}) {
  await must("ship", "POST", `/store-orders/${orderId}/shipments/label`, {
    fileUrl: `https://example.invalid/${RUN}-label.pdf`,
    fileName: `${RUN}-label.pdf`,
  });
  await must("ship", "POST", `/store-orders/${orderId}/shipments/ship`);
  if (deliver) await must("ship", "POST", `/store-orders/${orderId}/shipments/deliver`);
}
/** Manual provider statement line → its id (looked up by the unique provider reference). */
async function providerLine(methodId, body) {
  await must("fin", "POST", `/payment-reconciliation/methods/${methodId}/lines`, body);
  const found = await must("fin", "GET", `/payment-reconciliation/methods/${methodId}/lines?search=${encodeURIComponent(body.providerReference)}&pageSize=10`);
  const rows = Array.isArray(found) ? found : found.items;
  const line = rows.find((l) => l.providerReference === body.providerReference) ?? rows[0];
  if (!line) throw new Fail(`statement line ${body.providerReference} not found after create`);
  return line.id;
}
const customer = (label, city = "القاهرة") => ({
  name: `عميل ${label} — ${RUN}`,
  mobile: mobile(),
  countryId: ctx.EG,
  city,
  address: `عنوان تجريبي ${label} — ${TAG}`,
});

// ───────────────────────────────────────────────────────────── run
async function main() {
  console.log(`Agents API acceptance — RUN ${RUN} — API ${API}\n`);

  await step("S0", "Setup: personas log in, demo agents/terms/products/destinations resolved", async () => {
    for (const p of Object.keys(PERSONAS)) await login(p);
    const list = await must("admin", "GET", `/agents?search=${encodeURIComponent(TAG)}&pageSize=50`);
    const byKey = (k) => list.items.find((a) => a.name.startsWith(`وكيل تجريبي ${k} `));
    ctx.A = byKey("A");
    ctx.B = byKey("B");
    expect(ctx.A && ctx.B, "demo agents A/B not found — run ensure-agents-demo.ts");
    const meA = await must("aS1", "GET", "/agent-portal/me");
    const meB = await must("bS1", "GET", "/agent-portal/me");
    ctx.termsA = meA.agreement;
    ctx.termsB = meB.agreement;
    ctx.currencyId = meA.agent.currency.id;
    ctx.currency = meA.agent.currency.code;
    ctx.EG = meA.agreement.shippingRates.find((r) => r.country.code === "EG")?.country.id;
    expect(ctx.EG, "agent A agreement has no Egypt shipping rate");
    ctx.rateEG = meA.agreement.shippingRates.find((r) => r.country.code === "EG" && !r.city)?.amount;
    ctx.rateALX = meA.agreement.shippingRates.find((r) => r.city === "الإسكندرية")?.amount;
    const prodA = (await must("aS1", "GET", "/agent-portal/products?pageSize=50")).items;
    const prodB = (await must("bS1", "GET", "/agent-portal/products?pageSize=50")).items;
    ctx.pA = prodA.find((p) => p.isInventoryItem)?.id;
    ctx.cA = prodA.find((p) => !p.isInventoryItem)?.id;
    ctx.pB = prodB.find((p) => p.isInventoryItem)?.id;
    ctx.cB = prodB.find((p) => !p.isInventoryItem)?.id;
    expect(ctx.pA && ctx.cA && ctx.pB, "demo products missing");
    const destA = await must("aS1", "GET", "/agent-portal/payment-destinations");
    ctx.dRec = destA.find((d) => d.ownership === "COMPANY" && d.method.name.includes("تسوية"));
    ctx.dBank = destA.find((d) => d.ownership === "COMPANY" && !d.method.name.includes("تسوية"));
    ctx.dWallet = destA.find((d) => d.ownership === "AGENT");
    const destB = await must("bS1", "GET", "/agent-portal/payment-destinations");
    ctx.dBankB = destB.find((d) => d.ownership === "COMPANY");
    expect(ctx.dRec && ctx.dBank && ctx.dWallet && ctx.dBankB, "demo destinations missing");
    const ras = await must("admin", "GET", "/receiving-accounts");
    ctx.RA = (Array.isArray(ras) ? ras : ras.items).find((r) => r.code === `${TAG}-BANK`)?.id;
    expect(ctx.RA, "demo receiving account missing");
    const stock = await must("admin", "GET", `/agents/${ctx.A.id}/stock`);
    ctx.stockBefore = stock.items.find((i) => i.productId === ctx.pA);
    ctx.WH = ctx.stockBefore?.warehouseId;
    ctx.previewBefore = await preview(ctx.A.id);
    ctx.summaryBeforeA = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/summary?from=${TODAY}&to=${TODAY}`);
    return `A=${ctx.A.agentNumber} (${ctx.termsA.agreementNumber}, ${ctx.termsA.commissionRatePercent}%) B=${ctx.B.agentNumber} (${ctx.termsB.agreementNumber}, ${ctx.termsB.commissionRatePercent}%) currency=${ctx.currency} rates EG=${ctx.rateEG} ALX=${ctx.rateALX} available(before)=${ctx.previewBefore.available}`;
  });
  if (!ctx.A) return;
  const rateA = Number(ctx.termsA.commissionRatePercent) / 100;
  const shipFeeA = Number(ctx.termsA.shippingFeePerShipment);
  const retFeeA = Number(ctx.termsA.returnFeePerShipment);
  const retainA = ctx.termsA.customerShippingChargeOwner === "COMPANY";

  // ── O1: lead → convert (Shipping added 1,000 + 100) ─────────────────────
  await step("O1.lead", "Agent sales creates lead (agent-scoped)", async () => {
    const lead = await must("aS1", "POST", "/agent-portal/leads", {
      customerName: `عميل O1 — ${RUN}`,
      mobileNumber: mobile(),
      countryId: ctx.EG,
      city: "القاهرة",
      address: `عنوان O1 — ${TAG}`,
      productId: ctx.pA,
      quantity: 2,
      fulfillmentMethod: "SHIPPING",
    });
    ctx.leadO1 = lead;
    return `lead ${lead.leadNumber ?? lead.id}`;
  });
  await step("O1.quote", "Live quote — Shipping added: 1,000 + 100 = 1,100", async () => {
    const q = await must("aS1", "POST", "/agent-portal/orders/quote", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA, quantity: 2, lineAmount: 1000 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: ctx.EG,
      city: "القاهرة",
    });
    eq(q.breakdown.merchandiseAmount, 1000, "merchandise");
    eq(q.breakdown.shippingCharge, ctx.rateEG, "shipping");
    eq(q.breakdown.payableTotal, 1000 + ctx.rateEG, "payable");
    expect(q.shipping.source === "RATE", `shipping source ${q.shipping.source}`);
    return JSON.stringify(q.breakdown);
  });
  await step("O1.convert", "Lead → order conversion (Shipping added)", async () => {
    const lead = need(ctx.leadO1, "lead O1");
    const o = await must("aS1", "POST", `/agent-portal/leads/${lead.id}/convert`, {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA, quantity: 2, lineAmount: 1000 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: ctx.EG,
      city: "القاهرة",
      address: `عنوان O1 — ${TAG}`,
    });
    ctx.orders.O1 = o;
    eq(o.breakdown.merchandiseAmount, 1000, "merchandise");
    eq(o.breakdown.shippingCharge, ctx.rateEG, "shipping");
    eq(o.breakdown.payableTotal, 1000 + ctx.rateEG, "payable");
    expect(o.lead?.id === lead.id, "order not linked to the lead");
    const again = await call("aS1", "POST", `/agent-portal/leads/${lead.id}/convert`, {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA, quantity: 2, lineAmount: 1000 }],
      fulfillmentMethod: "SHIPPING",
      countryId: ctx.EG,
    });
    const secondId = again.json?.id;
    expect(!again.ok || secondId === o.id, `second conversion created another order (${secondId})`);
    return `${o.internalOrderId} payable ${o.breakdown.payableTotal}; re-convert → ${again.status}`;
  });
  await step("O1.declare", "Full declaration with proof to COMPANY bank destination (idempotent)", async () => {
    const o = need(ctx.orders.O1, "O1");
    const att = await stageProof("aS1", "O1");
    const k = key("O1-full");
    const d1 = await declare("aS1", o.id, { kind: "FULL", destinationId: ctx.dBank.id, stagedAttachmentIds: [att] }, k);
    const d2 = await declare("aS1", o.id, { kind: "FULL", destinationId: ctx.dBank.id }, k);
    expect(d2.payment.claims.length === 1, `replayed declaration created ${d2.payment.claims.length} claims`);
    const claim = d1.payment.claims[0];
    expect(claim.financeStatus === "PENDING", `claim status ${claim.financeStatus} (declaration ≠ verification)`);
    expect(claim.attachments.length === 1, "proof not linked");
    eq(claim.amount, 1000 + ctx.rateEG, "claim amount");
    ctx.claimO1 = claim.id;
    ctx.attO1 = claim.attachments[0].attachmentId;
    expect(d1.payment.declaredPaymentStatus === "PAID", `declared ${d1.payment.declaredPaymentStatus}`);
    return `claim ${claim.paymentNumber} ${claim.amount} proof ${ctx.attO1}`;
  });
  await step("O1.verify", "Internal Finance confirms company-destination payment (idempotent)", async () => {
    const id = need(ctx.claimO1, "claim O1");
    await must("fin", "POST", `/payments/${id}/confirm`);
    const again = await must("fin", "POST", `/payments/${id}/confirm`);
    expect(again.alreadyPosted === true, "second confirm not idempotent");
    const entries = await ledger(ctx.orders.O1.id);
    eq(sumType(entries, "COLLECTION_RECEIVED", "credit"), 1000 + ctx.rateEG, "COLLECTION_RECEIVED credit");
    expect(countType(entries, "COLLECTION_RECEIVED") === 1, "collection credited twice");
    return "COLLECTION_RECEIVED credited once";
  });
  await step("O1.invoice-blocked", "Agent order cannot generate a company sales invoice", async () => {
    const r = await call("fin", "POST", `/store-orders/${need(ctx.orders.O1, "O1").id}/generate-invoice`, {});
    expect(r.status >= 400, `generate-invoice returned ${r.status}`);
    return `${r.status} ${errText(r.json).slice(0, 80)}`;
  });
  await step("O1.ship", "Internal Shipping: label → ship → deliver; charges + commission on ledger", async () => {
    const o = need(ctx.orders.O1, "O1");
    await ship(o.id);
    await must("ship", "POST", `/store-orders/${o.id}/shipments/ship`).catch(() => null); // retry is harmless
    const entries = await ledger(o.id);
    eq(sumType(entries, "SHIPPING_FEE", "debit"), shipFeeA, "SHIPPING_FEE");
    eq(sumType(entries, "COMMISSION", "debit"), r2(rateA * 1000), "COMMISSION = rate × 1,000 (ex-shipping)");
    eq(sumType(entries, "CUSTOMER_SHIPPING_RETAINED", "debit"), retainA ? ctx.rateEG : 0, "CUSTOMER_SHIPPING_RETAINED");
    const commission = entries.find((e) => e.entryType === "COMMISSION");
    return `commission basis ${JSON.stringify(commission?.basis ?? {})}`;
  });
  await step("O1.return", "Partial return (1 of 2) with REVERSE: commission reversal + return fee; idempotent", async () => {
    const o = need(ctx.orders.O1, "O1");
    const detail = await portalOrder("aS1", o.id);
    const body = {
      lines: [{ storeOrderItemId: detail.lines[0].id, quantity: 1 }],
      warehouseId: need(ctx.WH, "warehouse"),
      reason: `مرتجع جزئي — ${RUN}`,
      idempotencyKey: key("O1-ret"),
      shipmentId: detail.fulfillment.shipments.at(-1)?.id,
    };
    const r1 = await must("ship", "POST", `/agent-returns/orders/${o.id}`, body);
    const r1b = await must("ship", "POST", `/agent-returns/orders/${o.id}`, body);
    expect(r1b.id === r1.id, "return replay created a second receipt");
    ctx.refs.returnO1 = r1.returnNumber;
    const entries = await ledger(o.id);
    const expectRev = ctx.termsA.returnCommissionTreatment === "REVERSE" ? r2(rateA * 500) : 0;
    eq(sumType(entries, "COMMISSION_REVERSAL", "credit"), expectRev, "COMMISSION_REVERSAL");
    eq(sumType(entries, "RETURN_FEE", "debit"), retFeeA, "RETURN_FEE");
    expect(countType(entries, "CUSTOMER_SHIPPING_RETAINED_REVERSAL") === 0, "retained shipping was reversed");
    return `${r1.returnNumber} merchandise ${r1.merchandiseAmount}`;
  });
  await step("O1.refund", "Refund paid by company (idempotent) → CUSTOMER_REFUND debit", async () => {
    const o = need(ctx.orders.O1, "O1");
    const body = {
      amount: 500,
      paidBy: "COMPANY",
      payingAccountId: ctx.RA,
      reason: `استرداد للعميل — ${RUN}`,
      refundDate: TODAY,
      idempotencyKey: key("O1-refund"),
    };
    await must("fin", "POST", `/agent-finance/orders/${o.id}/refunds`, body);
    await must("fin", "POST", `/agent-finance/orders/${o.id}/refunds`, body);
    const entries = await ledger(o.id);
    eq(sumType(entries, "CUSTOMER_REFUND", "debit"), 500, "CUSTOMER_REFUND (once)");
    return "refund 500 recorded once";
  });

  // ── O2: direct order, Shipping included 1,000 incl. 100 ⇒ 900 + 100 ──────
  await step("O2.create", "Direct order — Shipping included: 1,000 incl. 100 ⇒ 900 + 100 (idempotent create)", async () => {
    const k = key("O2");
    const body = {
      pricingMode: "SHIPPING_INCLUDED",
      agreedTotal: 1000,
      lines: [{ productId: ctx.pA, quantity: 2 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: ctx.EG,
      city: "الجيزة",
      customer: customer("O2", "الجيزة"),
      idempotencyKey: k,
    };
    const [o, o2] = await Promise.all([
      must("aS1", "POST", "/agent-portal/orders", body),
      must("aS1", "POST", "/agent-portal/orders", body),
    ]);
    expect(o.id === o2.id, `duplicate submit created two orders ${o.internalOrderId} / ${o2.internalOrderId}`);
    const o3 = await must("aS1", "POST", "/agent-portal/orders", body);
    expect(o3.id === o.id, "retried submit created another order");
    ctx.orders.O2 = o;
    eq(o.breakdown.merchandiseAmount, 1000 - ctx.rateEG, "merchandise");
    eq(o.breakdown.shippingCharge, ctx.rateEG, "shipping");
    eq(o.breakdown.payableTotal, 1000, "payable");
    eq(r2(o.lines.reduce((s, l) => s + l.lineAmount, 0)), 1000 - ctx.rateEG, "Σ lines = merchandise");
    return `${o.internalOrderId} ${JSON.stringify(o.breakdown)}`;
  });
  await step("O2.partial", "Partial declaration (400) never satisfies the prepaid gate; shipping blocked", async () => {
    const o = need(ctx.orders.O2, "O2");
    const d = await declare("aS1", o.id, { kind: "PARTIAL", amount: 400, destinationId: ctx.dRec.id }, key("O2-p1"));
    expect(d.payment.declaredPaymentStatus === "PARTIALLY_PAID", `declared ${d.payment.declaredPaymentStatus}`);
    eq(d.payment.remainingToDeclare, 600, "remaining");
    const r = await call("ship", "POST", `/store-orders/${o.id}/shipments/ship`);
    expect(r.status >= 400, `ship after partial declaration returned ${r.status}`);
    return `ship refused ${r.status} ${errText(r.json).slice(0, 100)}`;
  });
  await step("O2.full", "Full declaration of the remainder (600) → prepaid gate satisfied", async () => {
    const o = need(ctx.orders.O2, "O2");
    const d = await declare("aS1", o.id, { kind: "FULL", destinationId: ctx.dRec.id }, key("O2-full"));
    expect(d.payment.declaredPaymentStatus === "PAID", `declared ${d.payment.declaredPaymentStatus}`);
    expect(d.payment.claims.length === 2, `claims ${d.payment.claims.length}`);
    eq(d.payment.claims[1].amount, 600, "full = remaining");
    ctx.claimsO2 = d.payment.claims.map((c) => ({ id: c.id, amount: c.amount }));
    return d.payment.claims.map((c) => `${c.paymentNumber}=${c.amount}`).join(", ");
  });
  await step("O2.match", "Finance reconciles both claims against provider lines (fees 8 + 12); match idempotent", async () => {
    const claims = need(ctx.claimsO2, "O2 claims");
    const methodId = ctx.dRec.method.id;
    const fees = [8, 12];
    ctx.linesO2 = [];
    for (const [i, c] of claims.entries()) {
      const lineId = await providerLine(methodId, {
        providerReference: `${RUN}-O2-${i + 1}`,
        customerName: `عميل O2 — ${RUN}`,
        orderReference: ctx.orders.O2.internalOrderId,
        amount: c.amount,
        currencyId: ctx.currencyId,
        transactionDate: TODAY,
        feeAmount: fees[i],
        netAmount: r2(c.amount - fees[i]),
      });
      const body = { statementLineId: lineId, allocations: [{ paymentId: c.id, amount: c.amount }], idempotencyKey: key(`O2-m${i}`) };
      const m1 = await must("fin", "POST", `/payment-reconciliation/methods/${methodId}/matches`, body);
      const m2 = await must("fin", "POST", `/payment-reconciliation/methods/${methodId}/matches`, body);
      expect(JSON.stringify(m1.id ?? m1.matchId ?? "") === JSON.stringify(m2.id ?? m2.matchId ?? ""), "match replay differs");
      ctx.linesO2.push(lineId);
    }
    const detail = await portalOrder("aS1", ctx.orders.O2.id);
    const stages = detail.payment.claims.map((c) => c.stage);
    expect(stages.every((s) => s === "HELD_WITH_PROVIDER"), `stages ${stages}`);
    const entries = await ledger(ctx.orders.O2.id);
    eq(sumType(entries, "COLLECTION_RECEIVED", "credit"), 1000, "collections credited");
    return `stages ${stages.join(",")}`;
  });
  await step("O2.ship", "Ship + deliver O2; commission on 900 (ex-shipping)", async () => {
    const o = need(ctx.orders.O2, "O2");
    await ship(o.id);
    const entries = await ledger(o.id);
    eq(sumType(entries, "COMMISSION", "debit"), r2(rateA * (1000 - ctx.rateEG)), "COMMISSION");
    eq(sumType(entries, "SHIPPING_FEE", "debit"), shipFeeA, "SHIPPING_FEE");
    return "earned";
  });
  await step("O2.settle", "Provider settlement 1,000 − 20 fee → 980 received; provider fee borne by agent", async () => {
    const claims = need(ctx.claimsO2, "O2 claims");
    const body = {
      paymentMethodId: ctx.dRec.method.id,
      claims: claims.map((c) => ({ paymentId: c.id })),
      receivedAmount: 980,
      receivedCurrencyId: ctx.currencyId,
      receivingAccountId: ctx.RA,
      settlementDate: TODAY,
      providerReference: `${RUN}-STL`,
    };
    const pv = await must("fin", "POST", "/payment-settlements/preview", body);
    const s = await must("fin", "POST", "/payment-settlements", { ...body, idempotencyKey: key("O2-stl") });
    const s2 = await must("fin", "POST", "/payment-settlements", { ...body, idempotencyKey: key("O2-stl") });
    expect((s.id ?? s.settlement?.id) === (s2.id ?? s2.settlement?.id), "settlement replay differs");
    ctx.refs.settlement = s.settlementNumber ?? s.settlement?.settlementNumber ?? s.id;
    const entries = await ledger(ctx.orders.O2.id);
    const expectedFee = ctx.termsA.providerFeesBorneBy === "AGENT" ? 20 : 0;
    eq(sumType(entries, "PROVIDER_FEE", "debit"), expectedFee, "PROVIDER_FEE");
    const detail = await portalOrder("aS1", ctx.orders.O2.id);
    const stages = detail.payment.claims.map((c) => c.stage);
    expect(stages.every((st) => st !== "HELD_WITH_PROVIDER"), `still held: ${stages}`);
    return `${ctx.refs.settlement} fee(preview)=${pv.feeAmount ?? pv.totals?.fee ?? "?"} stages ${stages.join(",")}`;
  });

  // ── O3: COD via courier (sales 2), held with provider ──────────────────
  await step("O3.create", "COD order by sales 2 (Alexandria rate 150), ships without payment", async () => {
    const o = await must("aS2", "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA, quantity: 1, lineAmount: 600 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "CASH_ON_DELIVERY",
      countryId: ctx.EG,
      city: "الإسكندرية",
      customer: customer("O3", "الإسكندرية"),
      idempotencyKey: key("O3"),
    });
    ctx.orders.O3 = o;
    eq(o.breakdown.shippingCharge, ctx.rateALX, "city rate");
    eq(o.breakdown.payableTotal, 600 + ctx.rateALX, "payable");
    await ship(o.id);
    return `${o.internalOrderId} payable ${o.breakdown.payableTotal}`;
  });
  await step("O3.visibility", "Own-records visibility: sales 1 → 404 on sales 2's order; agent admin sees it", async () => {
    const o = need(ctx.orders.O3, "O3");
    const s1 = await call("aS1", "GET", `/agent-portal/orders/${o.id}`);
    const adm = await call("aAdmin", "GET", `/agent-portal/orders/${o.id}`);
    expect(s1.status === 404, `sales1 got ${s1.status}`);
    expect(adm.status === 200, `admin got ${adm.status}`);
    return "404 / 200";
  });
  await step("O3.collect", "COD collected by courier: agent cannot declare after dispatch; Finance records it, matches, NOT settled → held, not available", async () => {
    const o = need(ctx.orders.O3, "O3");
    const late = await call("aS2", "POST", `/agent-portal/orders/${o.id}/payment-declaration`, {
      kind: "FULL",
      destinationId: ctx.dRec.id,
      paymentDate: TODAY,
      idempotencyKey: key("O3-agent"),
    });
    expect(late.status === 403, `agent declaration after dispatch → ${late.status} (expected 403 correction rule)`);
    // Authorized internal staff record the courier collection (declaration-core correction path).
    const d = await must("fin", "POST", `/agent-orders/${o.id}/payment-declaration`, {
      kind: "FULL",
      destinationId: ctx.dRec.id,
      paymentDate: TODAY,
      reference: `${RUN}-COD`,
      idempotencyKey: key("O3-fin"),
    });
    const claims = (await portalOrder("aS2", o.id)).payment.claims;
    const claim = claims.find((c) => c.ownership === "COMPANY");
    need(claim, `COD claim (declaration response ${JSON.stringify(d).slice(0, 120)})`);
    const methodId = ctx.dRec.method.id;
    const lineId = await providerLine(methodId, {
      providerReference: `${RUN}-O3`,
      orderReference: o.internalOrderId,
      amount: claim.amount,
      currencyId: ctx.currencyId,
      transactionDate: TODAY,
      feeAmount: 0,
    });
    await must("fin", "POST", `/payment-reconciliation/methods/${methodId}/matches`, {
      statementLineId: lineId,
      allocations: [{ paymentId: claim.id, amount: claim.amount }],
      idempotencyKey: key("O3-m"),
    });
    const after = await portalOrder("aS2", o.id);
    const stage = after.payment.claims[0].stage;
    expect(stage === "HELD_WITH_PROVIDER", `stage ${stage}`);
    const entries = await ledger(o.id);
    const coll = entries.find((e) => e.entryType === "COLLECTION_RECEIVED");
    expect(coll && !coll.availableAt, `collection availableAt ${coll?.availableAt}`);
    return `agent late declaration 403; claim ${claim.paymentNumber} ${claim.amount} held with provider`;
  });

  // ── O4: pickup ─────────────────────────────────────────────────────────
  await step("O4.pickup", "Pickup order: no shipping; handover dispatches + earns (no shipping fee)", async () => {
    const o = await must("aS1", "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pA, quantity: 1, lineAmount: 300 }],
      fulfillmentMethod: "PICKUP",
      paymentType: "PREPAID",
      customer: customer("O4"),
      idempotencyKey: key("O4"),
    });
    ctx.orders.O4 = o;
    eq(o.breakdown.shippingCharge, 0, "pickup shipping");
    expect(o.breakdown.shippingChargeSource === "NONE", `source ${o.breakdown.shippingChargeSource}`);
    const d = await declare("aS1", o.id, { kind: "FULL", destinationId: ctx.dBank.id }, key("O4-full"));
    await must("fin", "POST", `/payments/${d.payment.claims[0].id}/confirm`);
    await must("ship", "POST", `/store-orders/${o.id}/pickup/READY_FOR_PICKUP`);
    await must("ship", "POST", `/store-orders/${o.id}/pickup/COLLECTED`);
    const entries = await ledger(o.id);
    eq(sumType(entries, "SHIPPING_FEE", "debit"), 0, "no shipping fee");
    eq(sumType(entries, "COMMISSION", "debit"), r2(rateA * 300), "COMMISSION");
    return `${o.internalOrderId}`;
  });

  // ── O5: digital-only course, paid to the agent's own wallet ──────────────
  await step("O5.digital", "Digital-only course: no shipping; paid to AGENT wallet → Finance verifies in Agent collections (memo)", async () => {
    const o = await must("aS1", "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.cA, quantity: 1, lineAmount: 400 }],
      paymentType: "PREPAID",
      customer: customer("O5"),
      idempotencyKey: key("O5"),
    });
    ctx.orders.O5 = o;
    eq(o.breakdown.shippingCharge, 0, "digital shipping");
    const d = await declare("aS1", o.id, { kind: "FULL", destinationId: ctx.dWallet.id }, key("O5-full"));
    const claim = d.payment.claims[0];
    expect(claim.ownership === "AGENT", `ownership ${claim.ownership}`);
    const refused = await call("fin", "POST", `/payments/${claim.id}/confirm`);
    expect(refused.status >= 400 && JSON.stringify(refused.json).includes("AGENT_DESTINATION_USE_AGENT_COLLECTIONS"), `company confirm → ${refused.status} ${errText(refused.json)}`);
    const q = await must("fin", "GET", `/agent-finance/collections?agentId=${ctx.A.id}&pageSize=100`);
    expect(q.items.some((i) => i.id === claim.id), "claim missing from Agent collections queue");
    const v1 = await must("fin", "POST", `/agent-finance/collections/${claim.id}/verify`);
    const v2 = await must("fin", "POST", `/agent-finance/collections/${claim.id}/verify`);
    expect(v2.alreadyVerified === true, "verify not idempotent");
    const entries = await ledger(o.id);
    const memo = entries.find((e) => e.entryType === "COLLECTION_BY_AGENT");
    expect(memo && Number(memo.credit) === 0 && Number(memo.debit) === 0 && near(memo.memoAmount, 400), `memo ${JSON.stringify(memo)}`);
    expect(countType(entries, "COLLECTION_RECEIVED") === 0, "agent-received money credited as company cash");
    eq(sumType(entries, "COMMISSION", "debit"), r2(rateA * 400), "COMMISSION (earned on full verification)");
    return `${o.internalOrderId} memo 400, verify replay ok (${v1.alreadyVerified}/${v2.alreadyVerified})`;
  });

  // ── Agent B: PAYMENT_VERIFIED, agent-owned shipping, service fee ─────────
  await step("B.order", "Agent B order: company destination; earning on verification; no retained shipping (owner AGENT)", async () => {
    const o = await must("bS1", "POST", "/agent-portal/orders", {
      pricingMode: "SHIPPING_ADDED",
      lines: [{ productId: ctx.pB, quantity: 1, lineAmount: 300 }],
      fulfillmentMethod: "SHIPPING",
      paymentType: "PREPAID",
      countryId: ctx.EG,
      customer: customer("B1"),
      idempotencyKey: key("B1"),
    });
    ctx.orders.B1 = o;
    const wallet = await call("bS1", "POST", `/agent-portal/orders/${o.id}/payment-declaration`, {
      kind: "FULL",
      destinationId: ctx.dWallet.id,
      paymentDate: TODAY,
      idempotencyKey: key("B1-wallet"),
    });
    expect(wallet.status >= 400, `agent B used agent A's destination → ${wallet.status}`);
    const att = await stageProof("bS1", "B1");
    const d = await declare("bS1", o.id, { kind: "FULL", destinationId: ctx.dBankB.id, stagedAttachmentIds: [att] }, key("B1-full"));
    ctx.attB1 = d.payment.claims[0].attachments[0]?.attachmentId;
    await must("fin", "POST", `/payments/${d.payment.claims[0].id}/confirm`);
    const bl = async () =>
      (await must("fin", "GET", `/agent-finance/agents/${ctx.B.id}/ledger?storeOrderId=${o.id}&pageSize=100`)).items;
    let entries = await bl();
    const rateB = Number(ctx.termsB.commissionRatePercent) / 100;
    eq(sumType(entries, "COMMISSION", "debit"), r2(rateB * 300), "B COMMISSION at verification");
    eq(sumType(entries, "SERVICE_FEE", "debit"), Number(ctx.termsB.serviceFeePerOrder), "B SERVICE_FEE");
    eq(sumType(entries, "CUSTOMER_SHIPPING_RETAINED", "debit"), 0, "B retained shipping");
    await ship(o.id);
    entries = await bl();
    eq(sumType(entries, "SHIPPING_FEE", "debit"), Number(ctx.termsB.shippingFeePerShipment), "B SHIPPING_FEE");
    return `${o.internalOrderId}`;
  });

  // ── separation / isolation ─────────────────────────────────────────────
  await step("SEP.agent-internal", "Agent tokens → 403 on internal shipping/finance/payout/import/admin endpoints", async () => {
    const o1 = ctx.orders.O1?.id ?? randomUUID();
    const probes = [
      ["GET", "/store-orders"],
      ["GET", "/shipping"],
      ["POST", `/store-orders/${o1}/shipments/ship`],
      ["POST", `/store-orders/${o1}/pickup/COLLECTED`],
      ["POST", `/agent-returns/orders/${o1}`, { lines: [], warehouseId: randomUUID(), idempotencyKey: "x" }],
      ["GET", "/agent-finance/collections"],
      ["POST", `/agent-finance/collections/${ctx.claimO1 ?? randomUUID()}/verify`],
      ["POST", `/agent-finance/agents/${ctx.A.id}/payouts`, { amount: 1, payingAccountId: ctx.RA, payoutDate: TODAY, reference: "x", idempotencyKey: "x" }],
      ["GET", `/agent-finance/agents/${ctx.A.id}/statement`],
      ["POST", `/payments/${ctx.claimO1 ?? randomUUID()}/confirm`],
      ["GET", "/payment-reconciliation/methods"],
      ["GET", "/payment-settlements"],
      ["GET", "/import-center/jobs"],
      ["GET", "/agents"],
      ["GET", `/agents/${ctx.A.id}`],
      ["GET", "/users"],
      ["GET", "/products"],
      ["GET", "/partners"],
      ["GET", "/leads"],
    ];
    const bad = [];
    for (const p of ["aAdmin", "aS1"]) {
      for (const [m, path, body] of probes) {
        const r = await call(p, m, path, body);
        if (r.status !== 403) bad.push(`${p} ${m} ${path} → ${r.status}`);
      }
    }
    expect(bad.length === 0, bad.join("; "));
    return `${probes.length * 2} probes → 403`;
  });
  await step("SEP.internal-portal", "Internal tokens → 403 on /agent-portal/*", async () => {
    const bad = [];
    for (const p of ["fin", "ship", "admin"]) {
      for (const path of ["/agent-portal/me", "/agent-portal/orders", "/agent-portal/statement"]) {
        const r = await call(p, "GET", path);
        if (r.status !== 403) bad.push(`${p} ${path} → ${r.status}`);
      }
    }
    expect(bad.length === 0, bad.join("; "));
    return "9 probes → 403";
  });
  await step("SEP.sales-perms", "Agent sales lacks statement/payouts/stock/team views (403)", async () => {
    const bad = [];
    for (const path of ["/agent-portal/statement", "/agent-portal/payouts", "/agent-portal/stock", "/agent-portal/team"]) {
      const r = await call("aS1", "GET", path);
      if (r.status !== 403) bad.push(`${path} → ${r.status}`);
    }
    expect(bad.length === 0, bad.join("; "));
    return "4 probes → 403";
  });
  await step("ISO.cross-agent", "Cross-agent isolation: A → 404 on B's order / proof; B → 404 on A's", async () => {
    const bo = need(ctx.orders.B1, "B1");
    const ao = need(ctx.orders.O1, "O1");
    const checks = [
      ["aAdmin", `/agent-portal/orders/${bo.id}`],
      ["aS1", `/agent-portal/orders/${bo.id}`],
      ["aAdmin", `/agent-portal/attachments/${need(ctx.attB1, "B proof")}/file`],
      ["bAdmin", `/agent-portal/orders/${ao.id}`],
      ["bAdmin", `/agent-portal/attachments/${need(ctx.attO1, "A proof")}/file`],
    ];
    const bad = [];
    for (const [p, path] of checks) {
      const r = await call(p, "GET", path);
      if (r.status !== 404) bad.push(`${p} ${path} → ${r.status}`);
    }
    const own = await fetch(`${API}/agent-portal/attachments/${ctx.attO1}/file`, { headers: { Authorization: `Bearer ${await login("aAdmin")}` } });
    if (own.status !== 200) bad.push(`aAdmin own proof → ${own.status}`);
    const listA = await must("aAdmin", "GET", `/agent-portal/orders?search=${encodeURIComponent(bo.internalOrderId)}`);
    if (listA.items.length) bad.push("B order found via A search");
    expect(bad.length === 0, bad.join("; "));
    return "404 × 5, own proof 200, search scoped";
  });

  // ── payouts ────────────────────────────────────────────────────────────
  await step("PAY.available", "Available balance = received & earned credits − deductions (this run's delta)", async () => {
    const pv = await preview(ctx.A.id);
    ctx.previewMid = pv;
    const rateEG = ctx.rateEG;
    const creditsAvail =
      (1000 + rateEG) + // O1 collection (non-reconciled, earned)
      1000 + // O2 collections (settled, earned)
      300 + // O4 collection
      (ctx.termsA.returnCommissionTreatment === "REVERSE" ? r2(rateA * 500) : 0);
    const debits =
      shipFeeA + r2(rateA * 1000) + (retainA ? rateEG : 0) + retFeeA + 500 + // O1
      (ctx.termsA.providerFeesBorneBy === "AGENT" ? 20 : 0) + shipFeeA + r2(rateA * (1000 - rateEG)) + (retainA ? rateEG : 0) + // O2
      shipFeeA + r2(rateA * 600) + (retainA ? ctx.rateALX : 0) + // O3 (collection held)
      r2(rateA * 300) + // O4
      r2(rateA * 400); // O5
    const expectedDelta = r2(creditsAvail - debits);
    const delta = r2(pv.available - ctx.previewBefore.available);
    eq(delta, expectedDelta, "available delta");
    const pendingDelta = r2(pv.pending - ctx.previewBefore.pending);
    eq(pendingDelta, 600 + ctx.rateALX, "pending delta (O3 held with provider)");
    return `available ${ctx.previewBefore.available} → ${pv.available} (Δ ${delta}); pending Δ ${pendingDelta}`;
  });
  await step("PAY.partial", "Partial payout (idempotent retry returns the same payout)", async () => {
    const pv = need(ctx.previewMid, "preview");
    expect(pv.available > 100, `available ${pv.available} too small`);
    const amount = r2(Math.floor(pv.available * 0.4));
    const body = { amount, payingAccountId: ctx.RA, payoutDate: TODAY, reference: `${RUN}-P1`, notes: TAG, idempotencyKey: key("P1") };
    const p1 = await must("fin", "POST", `/agent-finance/agents/${ctx.A.id}/payouts`, body);
    const p1b = await must("fin", "POST", `/agent-finance/agents/${ctx.A.id}/payouts`, body);
    expect(p1b.id === p1.id, "payout replay created a second payout");
    ctx.payouts.push(p1);
    const after = await preview(ctx.A.id);
    eq(after.available, r2(pv.available - amount), "available after partial");
    return `${p1.payoutNumber ?? p1.id} ${amount}`;
  });
  await step("PAY.concurrent", "Concurrent payouts exceeding available: exactly one succeeds", async () => {
    const pv = await preview(ctx.A.id);
    const each = r2(Math.floor(pv.available * 0.6 * 100) / 100);
    const mk = (i) =>
      call("fin", "POST", `/agent-finance/agents/${ctx.A.id}/payouts`, {
        amount: each,
        payingAccountId: ctx.RA,
        payoutDate: TODAY,
        reference: `${RUN}-C${i}`,
        idempotencyKey: key(`C${i}`),
      });
    const rs = await Promise.all([mk(1), mk(2)]);
    const ok = rs.filter((r) => r.ok);
    const ko = rs.filter((r) => !r.ok);
    expect(ok.length === 1 && ko.length === 1, `statuses ${rs.map((r) => r.status)}`);
    expect(JSON.stringify(ko[0].json).includes("PAYOUT_EXCEEDS_AVAILABLE"), `refusal ${errText(ko[0].json)}`);
    ctx.payouts.push(ok[0].json);
    return `${each} × 2 → ${rs.map((r) => r.status).join("/")}`;
  });
  await step("PAY.final", "Final payout of the remainder → available 0; overpay refused", async () => {
    const pv = await preview(ctx.A.id);
    expect(pv.available > 0, "nothing left");
    const over = await call("fin", "POST", `/agent-finance/agents/${ctx.A.id}/payouts`, {
      amount: r2(pv.available + 0.01),
      payingAccountId: ctx.RA,
      payoutDate: TODAY,
      reference: `${RUN}-OVER`,
      idempotencyKey: key("OVER"),
    });
    expect(over.status >= 400, `overpay → ${over.status}`);
    const p = await must("fin", "POST", `/agent-finance/agents/${ctx.A.id}/payouts`, {
      amount: pv.available,
      payingAccountId: ctx.RA,
      payoutDate: TODAY,
      reference: `${RUN}-FINAL`,
      idempotencyKey: key("FINAL"),
    });
    ctx.payouts.push(p);
    ctx.finalPayout = p;
    const after = await preview(ctx.A.id);
    eq(after.available, 0, "available after final");
    return `${p.payoutNumber ?? p.id} ${pv.available}`;
  });
  await step("PAY.reverse", "Payout reversal restores availability (second reversal refused)", async () => {
    const p = need(ctx.finalPayout, "final payout");
    const before = await preview(ctx.A.id);
    const rev = await must("fin", "POST", `/agent-finance/payouts/${p.id}/reverse`, { reason: `تحويل مرتد من البنك — ${RUN}` });
    expect(rev.status === "REVERSED", `status ${rev.status}`);
    const again = await call("fin", "POST", `/agent-finance/payouts/${p.id}/reverse`, { reason: "again" });
    expect(again.status >= 400, `second reversal → ${again.status}`);
    const after = await preview(ctx.A.id);
    eq(after.available, r2(before.available + Number(p.amount)), "available after reversal");
    return `${p.payoutNumber ?? p.id} reversed; available ${after.available}`;
  });
  await step("PAY.portal", "Agent admin sees payouts read-only; cannot create", async () => {
    const list = await must("aAdmin", "GET", "/agent-portal/payouts");
    const nums = (list.items ?? list).map((x) => x.payoutNumber);
    for (const p of ctx.payouts) expect(nums.includes(p.payoutNumber), `payout ${p.payoutNumber} not visible to agent admin`);
    const d = await must("aAdmin", "GET", `/agent-portal/payouts/${ctx.payouts[0].id}`);
    const create = await call("aAdmin", "POST", "/agent-portal/payouts", { amount: 1 });
    expect(create.status === 404 || create.status === 403, `agent create payout → ${create.status}`);
    return `${nums.length} visible; detail ${d.payoutNumber}; create → ${create.status}`;
  });

  // ── statement reconciliation ────────────────────────────────────────────
  await step("STM.reconcile", "Statement: opening + Σ(credit − debit) = closing; running balance; internal = portal", async () => {
    const full = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/statement`);
    const day = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/statement?from=${TODAY}&to=${TODAY}`);
    for (const s of [full, day]) {
      const net = r2(s.lines.reduce((acc, l) => acc + Number(l.credit) - Number(l.debit), 0));
      eq(r2(s.openingBalance + net), s.closingBalance, "opening + Σ = closing");
      if (s.lines.length) eq(s.lines.at(-1).balance, s.closingBalance, "last running = closing");
      eq(s.totals.credit - s.totals.debit, net, "totals");
    }
    eq(full.closingBalance, full.summary.position.balance, "closing = position balance");
    const portal = await must("aAdmin", "GET", `/agent-portal/statement?from=${TODAY}&to=${TODAY}`);
    eq(portal.closingBalance, day.closingBalance, "portal closing = internal closing");
    eq(portal.openingBalance, day.openingBalance, "portal opening = internal opening");
    ctx.refs.statement = { from: TODAY, to: TODAY, opening: day.openingBalance, closing: day.closingBalance, lines: day.lines.length };
    return `opening ${day.openingBalance} + Σ → closing ${day.closingBalance} (${day.lines.length} lines); all-time closing ${full.closingBalance}`;
  });
  await step("STM.summary", "Summary deltas: sales ex-shipping, shipping charges, collections company vs agent, commission = rate × base", async () => {
    const s0 = ctx.summaryBeforeA;
    const s1 = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/summary?from=${TODAY}&to=${TODAY}`);
    const d = (f) => r2(f(s1) - f(s0));
    const rateEG = ctx.rateEG;
    // Orders placed this run for A: O1 1000, O2 900, O3 600, O4 300, O5 400 (+ O6 later)
    eq(d((s) => s.orders.merchandiseSalesExShipping), 1000 + (1000 - rateEG) + 600 + 300 + 400, "merchandise sales ex-shipping");
    eq(d((s) => s.orders.customerShippingCharges), rateEG + rateEG + ctx.rateALX, "customer shipping charges");
    eq(d((s) => s.orders.totalOrderValue), 1000 + rateEG + 1000 + 600 + ctx.rateALX + 300 + 400, "total order value");
    eq(d((s) => s.collections.byCompany), 1000 + rateEG + 1000 + 600 + ctx.rateALX + 300, "collections by company");
    eq(d((s) => s.collections.byAgent), 400, "collections by agent");
    const base = 1000 + (1000 - rateEG) + 600 + 300 + 400;
    eq(d((s) => s.commission.base), base, "commission base");
    eq(d((s) => s.commission.charged), r2(rateA * base), "commission charged = rate × base");
    eq(d((s) => s.refunds.paidByCompany), 500, "refunds by company");
    // Cross-check summary vs ledger (all-time)
    const all = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/summary`);
    const stm = await must("fin", "GET", `/agent-finance/agents/${ctx.A.id}/statement`);
    const byType = (t, f) => r2(stm.lines.filter((l) => l.entryType === t).reduce((a, l) => a + Number(l[f]), 0));
    eq(all.commission.charged, r2(byType("COMMISSION", "debit")), "summary commission charged = ledger COMMISSION");
    eq(all.commission.reversed, r2(byType("COMMISSION_REVERSAL", "credit")), "summary commission reversed = ledger COMMISSION_REVERSAL");
    eq(all.deductions.commission, r2(byType("COMMISSION", "debit") - byType("COMMISSION_REVERSAL", "credit")), "summary net commission = ledger net");
    eq(all.deductions.shippingFees, byType("SHIPPING_FEE", "debit"), "summary shipping fees = ledger");
    eq(all.collections.byCompany, r2(byType("COLLECTION_RECEIVED", "credit") - byType("COLLECTION_REVERSAL", "debit")), "company collections = ledger");
    return `Δ sales ${d((s) => s.orders.merchandiseSalesExShipping)}, Δ shipping ${d((s) => s.orders.customerShippingCharges)}, Δ company ${d((s) => s.collections.byCompany)}, Δ agent ${d((s) => s.collections.byAgent)}, Δ commission ${d((s) => s.commission.charged)}`;
  });
  await step("STK.agent-stock", "Agent stock: shipped/returned/on-hand move with fulfillment", async () => {
    const before = need(ctx.stockBefore, "stock before");
    const after = (await must("aAdmin", "GET", "/agent-portal/stock")).items.find((i) => i.productId === ctx.pA);
    eq(after.shipped - before.shipped, 6, "shipped Δ (O1 2 + O2 2 + O3 1 + O4 1)");
    eq(after.returned - before.returned, 1, "returned Δ");
    eq(after.onHand - before.onHand, -5, "on-hand Δ");
    return `onHand ${before.onHand} → ${after.onHand}`;
  });

  // ── effective-dated agreement change ───────────────────────────────────
  if (process.env.ONLY_SKIP_AGREEMENT === "1") {
    results.push({ id: "AGR.effective", title: "Effective-dated agreement change", status: "SKIPPED", detail: "ONLY_SKIP_AGREEMENT=1" });
  } else {
    await step("AGR.effective", "End A's agreement tomorrow, new DRAFT→ACTIVE from the day after (+2 pp); today's order snapshots the old rate", async () => {
      const list = await must("admin", "GET", `/agents/${ctx.A.id}/agreements`);
      const rows = Array.isArray(list) ? list : list.items;
      const current = rows.find((a) => ["ACTIVE", "ENDED"].includes(a.status) && a.effectiveFrom.slice(0, 10) <= TODAY && (!a.effectiveTo || a.effectiveTo.slice(0, 10) >= TODAY));
      expect(current, "no agreement in force today");
      const oldRate = Number(current.commissionRatePercent);
      const future = rows.find((a) => a.status === "ACTIVE" && a.effectiveFrom.slice(0, 10) > TODAY);
      let next = future;
      if (!future) {
        if (current.status === "ACTIVE" && !current.effectiveTo) {
          await must("admin", "POST", `/agents/${ctx.A.id}/agreements/${current.id}/end`, { effectiveTo: plusDays(1) });
        }
        const terms = {
          effectiveFrom: plusDays(2),
          commissionRatePercent: oldRate + 2,
          commissionEarningEvent: current.commissionEarningEvent,
          returnCommissionTreatment: current.returnCommissionTreatment,
          customerShippingChargeOwner: current.customerShippingChargeOwner,
          providerFeesBorneBy: current.providerFeesBorneBy,
          shippingFeePerShipment: Number(current.shippingFeePerShipment),
          returnFeePerShipment: Number(current.returnFeePerShipment),
          serviceFeePerOrder: Number(current.serviceFeePerOrder),
          allowAgentDestinations: current.allowAgentDestinations,
          payoutHoldDays: current.payoutHoldDays,
          notes: `تغيير سعر العمولة (اختبار سريان) — ${RUN}`,
        };
        next = await must("admin", "POST", `/agents/${ctx.A.id}/agreements`, terms);
        for (const r of current.shippingRates ?? []) {
          await must("admin", "PUT", `/agents/${ctx.A.id}/agreements/${next.id}/shipping-rates`, {
            countryId: r.countryId ?? r.country?.id,
            city: r.city ?? "",
            amount: Number(r.amount),
          });
        }
        // An overlapping draft must be refused on activation.
        const overlap = await must("admin", "POST", `/agents/${ctx.A.id}/agreements`, { ...terms, effectiveFrom: TODAY, notes: `تداخل — ${RUN}` });
        const ov = await call("admin", "POST", `/agents/${ctx.A.id}/agreements/${overlap.id}/activate`);
        expect(ov.status === 409, `overlapping activation → ${ov.status} ${errText(ov.json)}`);
        next = await must("admin", "POST", `/agents/${ctx.A.id}/agreements/${next.id}/activate`);
      }
      const o = await must("aS1", "POST", "/agent-portal/orders", {
        pricingMode: "SHIPPING_ADDED",
        lines: [{ productId: ctx.cA, quantity: 1, lineAmount: 200 }],
        paymentType: "PREPAID",
        customer: customer("O6"),
        idempotencyKey: key("O6"),
      });
      ctx.orders.O6 = o;
      const internal = await must("admin", "GET", `/store-orders/${o.id}`);
      const snap = internal.agentTermsSnapshot;
      expect(snap, "internal order has no agentTermsSnapshot");
      eq(snap.commissionRatePercent, oldRate, "snapshot rate");
      expect(snap.agreementId === current.id, `snapshot agreement ${snap.agreementNumber}`);
      return `${current.agreementNumber} ends ${plusDays(1)} (${oldRate}%); ${next.agreementNumber} from ${next.effectiveFrom?.slice(0, 10)} (${next.commissionRatePercent}%); ${o.internalOrderId} snapshot ${snap.commissionRatePercent}%`;
    });
  }
}

try {
  await main();
} catch (e) {
  results.push({ id: "FATAL", title: "runner", status: "FAIL", detail: e.stack ?? String(e) });
  console.error(e);
}

// ───────────────────────────────────────────────────────────── report
const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
const refs = {
  run: RUN,
  agents: { A: ctx.A?.agentNumber, B: ctx.B?.agentNumber },
  agreements: { A: ctx.termsA?.agreementNumber, B: ctx.termsB?.agreementNumber },
  orders: Object.fromEntries(Object.entries(ctx.orders).map(([k, o]) => [k, o.internalOrderId])),
  lead: ctx.leadO1?.leadNumber,
  payouts: ctx.payouts.map((p) => ({ number: p.payoutNumber, amount: Number(p.amount), status: p.status })),
  ...ctx.refs,
};
console.log("\n| # | Check | Result |\n|---|---|---|");
for (const r of results) console.log(`| ${r.id} | ${r.title} | ${r.status} |`);
console.log(`\nSummary ${JSON.stringify(counts)}`);
console.log(`Sample references ${JSON.stringify(refs)}`);
const report = { tour: "agents-api-acceptance", run: RUN, api: API, finishedAt: new Date().toISOString(), summary: counts, refs, results, http: httpLog };
const file = resolve(OUT, `agents-api-acceptance-${RUN}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, "latest.json"), JSON.stringify(report, null, 2));
console.log(`Evidence: ${file}`);
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
