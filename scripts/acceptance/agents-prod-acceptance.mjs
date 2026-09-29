#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Agents / Fulfillment Partners — PRODUCTION acceptance over HTTP only (no DB access).
 * Owner-approved 2026-09-29. Decision D1 is NOT set in Production: company-destination
 * verification, company refunds, payouts and postPending must fail CLOSED
 * (AGENT_ACCOUNTS_NOT_CONFIGURED) and are reported BLOCKED; every agent charge is recorded
 * PENDING_CONFIGURATION. Nothing here creates GL accounts, payment methods or receiving
 * accounts, and nothing grants permissions (internal persona grants are only verified).
 *
 *   node scripts/acceptance/agents-prod-acceptance.mjs            # setup (idempotent) + journeys
 *   PHASE=setup node scripts/acceptance/agents-prod-acceptance.mjs
 *
 * Credentials: QA_PASSWORD, AGENT_DEMO_PASSWORD (env or tmp/.qa.env) — never printed or written.
 * Temporary passwords returned by the API stay in memory only.
 * Env: API (default https://oms.haseb.org/api), PHASE=setup|all, SKIP_AGREEMENT=1.
 * Output: tmp/agents-acceptance/prod/prod-acceptance-<RUN>.json (+ latest.json).
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
const API = (process.env.API ?? "https://oms.haseb.org/api").replace(/\/$/, "");
const PHASE = process.env.PHASE ?? "all";
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const RUN = `${TAG}-P${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const OUT = resolve(ROOT, "tmp/agents-acceptance/prod");
mkdirSync(OUT, { recursive: true });
const QA_PW = process.env.QA_PASSWORD ?? "";
const AGENT_PW = process.env.AGENT_DEMO_PASSWORD ?? "";
if (!QA_PW || !AGENT_PW) {
  console.error("QA_PASSWORD and AGENT_DEMO_PASSWORD are required.");
  process.exit(2);
}
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (n) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const r2 = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const near = (a, b, eps = 0.011) => Math.abs(Number(a) - Number(b)) <= eps;
const key = (l) => `${RUN}-${l}`;
const mobile = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const METHODS = {
  RECONCILED: "DEMO-PDR-20260927 Tamara (QA)",
  BANK: "DEMO-PDR-20260927 Bank transfer (QA)",
  WALLET: "محافظ كاش مصر",
};
const AGENTS = [
  {
    key: "A",
    name: `وكيل تجريبي A — ${TAG}`,
    email: "agent-a.demo-agt@oms.haseb.org",
    terms: {
      productCommissionRatePercent: 10,
      serviceCommissionRatePercent: 10,
      shippingPolicy: "FLAT_FEE_PER_SHIPMENT",
      commissionEarningEvent: "DELIVERED",
      returnCommissionTreatment: "REVERSE",
      customerShippingChargeOwner: "COMPANY",
      shippingFeePerShipment: 30,
      returnFeePerShipment: 20,
      serviceFeePerOrder: 0,
      providerFeesBorneBy: "AGENT",
      allowAgentDestinations: true,
      payoutHoldDays: 0,
    },
    destinations: [
      ["RECONCILED", "COMPANY", `بوابة دفع الشركة (تسوية) — ${TAG}`],
      ["BANK", "COMPANY", `تحويل بنكي لحساب الشركة — ${TAG}`],
      ["WALLET", "AGENT", `محفظة الوكيل A — ${TAG}`],
    ],
    products: [
      { key: "PHYS", name: `منتج الوكيل A — ${TAG}`, physical: true, price: 500, qty: 200 },
      { key: "COURSE", name: `دورة رقمية للوكيل A — ${TAG}`, physical: false, price: 400, qty: 0 },
    ],
    users: [
      ["admin", "agent-a-admin.demo-agt@oms.haseb.org", "agent-a-admin.demo-agt", `مدير الوكيل A — ${TAG}`, "ADMIN", ["agent.team.manage"]],
      ["sales1", "agent-a-sales1.demo-agt@oms.haseb.org", "agent-a-sales1.demo-agt", `مبيعات الوكيل A (1) — ${TAG}`, "SALES", []],
      ["sales2", "agent-a-sales2.demo-agt@oms.haseb.org", "agent-a-sales2.demo-agt", `مبيعات الوكيل A (2) — ${TAG}`, "SALES", []],
    ],
  },
  {
    key: "B",
    name: `وكيل تجريبي B — ${TAG}`,
    email: "agent-b.demo-agt@oms.haseb.org",
    terms: {
      productCommissionRatePercent: 8,
      serviceCommissionRatePercent: 8,
      shippingPolicy: "FLAT_FEE_PER_SHIPMENT",
      commissionEarningEvent: "PAYMENT_VERIFIED",
      returnCommissionTreatment: "RETAIN",
      customerShippingChargeOwner: "AGENT",
      shippingFeePerShipment: 25,
      returnFeePerShipment: 15,
      serviceFeePerOrder: 5,
      providerFeesBorneBy: "COMPANY",
      allowAgentDestinations: false,
      payoutHoldDays: 0,
    },
    destinations: [["BANK", "COMPANY", `تحويل بنكي لحساب الشركة — ${TAG}`]],
    products: [
      { key: "PHYS", name: `منتج الوكيل B — ${TAG}`, physical: true, price: 300, qty: 100 },
      { key: "COURSE", name: `دورة رقمية للوكيل B — ${TAG}`, physical: false, price: 250, qty: 0 },
    ],
    users: [
      ["admin", "agent-b-admin.demo-agt@oms.haseb.org", "agent-b-admin.demo-agt", `مدير الوكيل B — ${TAG}`, "ADMIN", ["agent.team.manage"]],
      ["sales1", "agent-b-sales1.demo-agt@oms.haseb.org", "agent-b-sales1.demo-agt", `مبيعات الوكيل B — ${TAG}`, "SALES", []],
    ],
  },
];
/** Verified (read-only) — the grants themselves were made by the owner-approved master. */
const EXPECTED_GRANTS = {
  "qa-finance@oms.haseb.org": ["agents.view", "agents.finance.view", "agents.finance.verify", "agents.payouts.create"],
  "qa-shipping@oms.haseb.org": ["agents.view", "shipping.edit", "shipping.manage"],
};

// ───────────────────────────────────────────── http
const tokens = {};
const httpLog = [];
async function rawLogin(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, token: json.accessToken, code: json.code };
}
async function login(email) {
  if (tokens[email]) return tokens[email];
  const r = await rawLogin(email, email.includes("demo-agt") ? AGENT_PW : QA_PW);
  if (!r.token) throw new Error(`login ${email} → ${r.status} ${r.code ?? ""}`);
  tokens[email] = r.token;
  return r.token;
}
function errText(json) {
  if (!json) return "";
  const msg = Array.isArray(json.message) ? json.message.join("; ") : json.message;
  return [json.code, typeof msg === "string" ? msg : JSON.stringify(msg), json.raw].filter(Boolean).join(" ").slice(0, 400);
}
async function callT(token, method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  httpLog.push({ method, path: path.replace(/\/change-password.*/, "/change-password"), status: res.status, ...(res.status >= 400 ? { error: errText(json) } : {}) });
  return { status: res.status, ok: res.status < 300, json };
}
const call = async (email, method, path, body) => callT(await login(email), method, path, body);
class Fail extends Error {}
class Blocked extends Error {}
async function must(email, method, path, body) {
  const r = await call(email, method, path, body);
  if (!r.ok) throw new Fail(`${method} ${path} → ${r.status} ${errText(r.json)}`);
  return r.json;
}
const expect = (c, m) => {
  if (!c) throw new Fail(m);
};
const eq = (a, b, l) => expect(near(a, b), `${l}: expected ${b}, got ${a}`);
const need = (v, w) => {
  if (v === undefined || v === null) throw new Blocked(`dependency missing: ${w}`);
  return v;
};
const results = [];
/** expectBlocked: the check proves a D1-dependent action fails CLOSED → recorded BLOCKED, never PASS. */
async function step(id, title, fn, { expectBlocked = false } = {}) {
  try {
    const detail = await fn();
    const status = expectBlocked ? "BLOCKED" : "PASS";
    results.push({ id, title, status, detail: detail ?? "" });
    console.log(`${status.padEnd(7)} ${id} ${title}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
  } catch (e) {
    const status = e instanceof Blocked ? "BLOCKED" : "FAIL";
    results.push({ id, title, status, detail: e.message });
    console.log(`${status.padEnd(7)} ${id} ${title} — ${e.message.slice(0, 400)}`);
  }
}

const ADMIN = "qa-admin@oms.haseb.org";
const FIN = "qa-finance@oms.haseb.org";
const SHIP = "qa-shipping@oms.haseb.org";
const ctx = { run: RUN, api: API, created: [], orders: {}, refs: {} };
const created = (type, ref) => ctx.created.push({ type, ref });
const listOf = (j) => (Array.isArray(j) ? j : j?.items ?? []);

// ───────────────────────────────────────────── setup
async function setup() {
  ctx.EGP = listOf(await must(ADMIN, "GET", "/currencies?pageSize=200")).find((c) => c.code === "EGP");
  ctx.EG = listOf(await must(ADMIN, "GET", "/countries?pageSize=1000")).find((c) => c.code === "EG");
  const ps = await must(ADMIN, "GET", "/accounting/posting-settings");
  expect(ps.functionalCurrencyId === ctx.EGP.id, "functional currency is not EGP");
  expect(!ps.agentFundsPayableAccountId && !ps.agentCommissionRevenueAccountId && !ps.agentServiceRevenueAccountId, "D1 unexpectedly configured");
  const methods = listOf(await must(ADMIN, "GET", "/payment-methods?pageSize=200"));
  ctx.methodIds = Object.fromEntries(Object.entries(METHODS).map(([k, n]) => [k, methods.find((m) => m.name === n)?.id]));
  expect(Object.values(ctx.methodIds).every(Boolean), `payment methods missing ${JSON.stringify(ctx.methodIds)}`);
  ctx.WH = listOf(await must(ADMIN, "GET", "/warehouses?pageSize=50")).find((w) => w.code === "WH-000001");
  expect(ctx.WH?.isActive, "WH-000001 missing/inactive");
  const cats = listOf(await must(ADMIN, "GET", "/product-categories?pageSize=200"));
  ctx.category = cats.find((c) => !/DEMO-/.test(c.name)) ?? cats[0];
  const units = listOf(await must(ADMIN, "GET", "/units?pageSize=50"));
  ctx.unit = units.find((u) => u.name === "وحدة") ?? units[0];
  const users = listOf(await must(ADMIN, "GET", "/users?search=qa-"));
  for (const [email, names] of Object.entries(EXPECTED_GRANTS)) {
    const u = users.find((x) => x.email === email);
    const granted = (await must(ADMIN, "GET", `/users/${u.id}/permissions`)).granted;
    const missing = names.filter((n) => !granted.includes(n));
    expect(missing.length === 0, `${email} lacks ${missing.join(", ")}`);
  }

  const existing = listOf(await must(ADMIN, "GET", `/agents?search=${encodeURIComponent(TAG)}&pageSize=50`));
  for (const spec of AGENTS) {
    let agent = existing.find((a) => a.name === spec.name);
    if (!agent) {
      agent = await must(ADMIN, "POST", "/agents", {
        name: spec.name,
        legalName: spec.name,
        contactName: `مسؤول الوكيل ${spec.key} — ${TAG}`,
        email: spec.email,
        countryId: ctx.EG.id,
        currencyId: ctx.EGP.id,
        notes: `بيانات تجريبية — ${TAG}`,
      });
      created("Agent", agent.agentNumber);
    }
    spec.id = agent.id;
    spec.agentNumber = agent.agentNumber;
    const rows = listOf(await must(ADMIN, "GET", `/agents/${agent.id}/agreements`));
    let current = rows.find((a) => ["ACTIVE", "ENDED"].includes(a.status) && a.effectiveFrom.slice(0, 10) <= TODAY && (!a.effectiveTo || a.effectiveTo.slice(0, 10) >= TODAY));
    if (!current) {
      const draft = await must(ADMIN, "POST", `/agents/${agent.id}/agreements`, { effectiveFrom: TODAY, ...spec.terms, notes: `شروط تجريبية صريحة — ${TAG}` });
      for (const [city, amount] of [["", 100], ["الإسكندرية", 150]]) {
        await must(ADMIN, "PUT", `/agents/${agent.id}/agreements/${draft.id}/shipping-rates`, { countryId: ctx.EG.id, city, amount });
      }
      current = await must(ADMIN, "POST", `/agents/${agent.id}/agreements/${draft.id}/activate`);
      created("Agreement", `${current.agreementNumber} (${spec.key})`);
    }
    spec.agreement = current.agreementNumber;
    const dests = await must(ADMIN, "GET", `/agents/${agent.id}/payment-destinations`);
    for (const [m, ownership, label] of spec.destinations) {
      if (dests.some((d) => d.paymentMethodId === ctx.methodIds[m] && d.ownership === ownership)) continue;
      await must(ADMIN, "POST", `/agents/${agent.id}/payment-destinations`, { paymentMethodId: ctx.methodIds[m], ownership, label, details: `بيانات تجريبية — ${TAG}` });
      created("Destination", `${spec.key}: ${label}`);
    }
    const prods = listOf(await must(ADMIN, "GET", `/products?search=${encodeURIComponent(TAG)}&pageSize=100`));
    for (const p of spec.products) {
      let prod = prods.find((x) => x.name === p.name);
      if (!prod) {
        prod = await must(ADMIN, "POST", "/products", {
          name: p.name,
          internalName: p.name,
          displayName: p.name,
          searchKeywords: TAG,
          categoryId: ctx.category.id,
          unitId: ctx.unit.id,
          type: p.physical ? "PURCHASE_AND_SALE" : "SERVICE",
          status: "ACTIVE",
          isSellable: true,
          isPurchasable: p.physical,
          isInventoryItem: p.physical,
          salesPrice: p.price,
          ...(p.physical ? { preferredWarehouseId: ctx.WH.id, weight: 1, width: 10, height: 10, length: 10 } : {}),
          ownerAgentId: agent.id,
        });
        created("Product", `${prod.sku} ${p.name}`);
      }
      p.id = prod.id;
      if (p.physical && p.qty > 0) {
        const mv = listOf(await must(ADMIN, "GET", `/inventory/movements?productId=${prod.id}&pageSize=5`));
        if (mv.length === 0) {
          const jeBefore = (await must(ADMIN, "GET", "/journal-entries?pageSize=1")).total;
          const m = await must(ADMIN, "POST", "/inventory/opening-balance", { productId: prod.id, warehouseId: ctx.WH.id, quantity: p.qty, notes: `استلام مخزون الوكيل ${spec.key} — ${TAG}` });
          const jeAfter = (await must(ADMIN, "GET", "/journal-entries?pageSize=1")).total;
          ctx.refs[`opening${spec.key}`] = { movement: m.movementNumber, journalEntriesBefore: jeBefore, journalEntriesAfter: jeAfter };
          expect(jeBefore === jeAfter, `opening balance changed the journal-entry total ${jeBefore} → ${jeAfter}`);
          created("InventoryMovement", `${m.movementNumber} opening ${p.qty} × ${prod.sku} @ WH-000001`);
        }
      }
    }
    const team = await must(ADMIN, "GET", `/agents/${agent.id}/users`);
    spec.userIds = {};
    for (const [ukey, email, username, fullName, agentRole, extra] of spec.users) {
      let u = team.find((x) => x.email === email);
      let temp;
      if (!u) {
        const r = await must(ADMIN, "POST", `/agents/${agent.id}/users`, { email, username, fullName, agentRole, extraPermissions: extra });
        u = r;
        temp = r.temporaryPassword;
        created("AgentUser", `${email} (${agentRole})`);
      } else if (u.mustChangePassword) {
        temp = (await must(ADMIN, "POST", `/agents/${agent.id}/users/${u.id}/reset-password`)).temporaryPassword;
      }
      if (temp) {
        const first = await rawLogin(email, temp);
        expect(first.token, `first login ${email} → ${first.status}`);
        const before = await callT(first.token, "GET", "/agent-portal/me");
        expect(before.status === 403 && JSON.stringify(before.json).includes("MUST_CHANGE_PASSWORD"), `before change /agent-portal/me → ${before.status} ${errText(before.json)}`);
        const ch = await callT(first.token, "POST", "/auth/change-password", { currentPassword: temp, newPassword: AGENT_PW });
        expect(ch.ok, `change-password ${email} → ${ch.status} ${errText(ch.json)}`);
        temp = undefined;
        ctx.refs.forcedChangeApi = (ctx.refs.forcedChangeApi ?? 0) + 1;
      }
      spec.userIds[ukey] = u.id;
      spec[`email_${ukey}`] = email;
    }
  }
  return `A=${AGENTS[0].agentNumber} (${AGENTS[0].agreement}) B=${AGENTS[1].agentNumber} (${AGENTS[1].agreement}); created ${ctx.created.length}; forced changes via API ${ctx.refs.forcedChangeApi ?? 0}`;
}

// ───────────────────────────────────────────── journeys
const A = AGENTS[0];
const B = AGENTS[1];
const ledger = async (agentId, orderId) =>
  (await must(FIN, "GET", `/agent-finance/agents/${agentId}/ledger?storeOrderId=${orderId}&pageSize=200`)).items;
const sumType = (e, t, f) => r2(e.filter((x) => x.entryType === t).reduce((s, x) => s + Number(x[f] ?? 0), 0));
const notPending = (e) => e.filter((x) => (Number(x.debit) || Number(x.credit)) && x.postingStatus !== "PENDING_CONFIGURATION");
const cust = (label, city = "القاهرة") => ({ name: `عميل ${label} — ${RUN}`, mobile: mobile(), countryId: ctx.EG.id, city, address: `عنوان تجريبي ${label} — ${TAG}` });
async function stageProof(email, label) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), `proof-${label}-${RUN}.png`);
  return (await must(email, "POST", "/attachments/staging", form)).id;
}
const declare = (email, id, fields, k) =>
  must(email, "POST", `/agent-portal/orders/${id}/payment-declaration`, { paymentDate: TODAY, reference: `${RUN}-${fields.kind}`, idempotencyKey: k, ...fields });
async function ship(orderId, deliver = true) {
  await must(SHIP, "POST", `/store-orders/${orderId}/shipments/label`, { fileUrl: `https://example.invalid/${RUN}-label.pdf`, fileName: `${RUN}-label.pdf` });
  await must(SHIP, "POST", `/store-orders/${orderId}/shipments/ship`);
  if (deliver) await must(SHIP, "POST", `/store-orders/${orderId}/shipments/deliver`);
}
const failsClosed = (r, code) => {
  expect(r.status >= 400, `expected a refusal, got ${r.status}`);
  if (code) expect(JSON.stringify(r.json).includes(code), `expected ${code}, got ${r.status} ${errText(r.json)}`);
  return `${r.status} ${errText(r.json).slice(0, 220)}`;
};

async function journeys() {
  const aS1 = A.email_sales1;
  const aS2 = A.email_sales2;
  const aAdm = A.email_admin;
  const bS1 = B.email_sales1;
  const bAdm = B.email_admin;
  const me = await must(aS1, "GET", "/agent-portal/me");
  const rate = Number(me.agreement.productCommissionRatePercent) / 100;
  const shipFee = Number(me.agreement.shippingFeePerShipment);
  const retFee = Number(me.agreement.returnFeePerShipment);
  const destA = await must(aS1, "GET", "/agent-portal/payment-destinations");
  const dBank = destA.find((d) => d.method.name === METHODS.BANK);
  const dWallet = destA.find((d) => d.ownership === "AGENT");
  const dRec = destA.find((d) => d.method.name === METHODS.RECONCILED);
  const dBankB = (await must(bS1, "GET", "/agent-portal/payment-destinations"))[0];
  const pA = A.products.find((p) => p.physical).id;
  const cA = A.products.find((p) => !p.physical).id;
  const pB = B.products.find((p) => p.physical).id;
  const summaryBefore = await must(FIN, "GET", `/agent-finance/agents/${A.id}/summary?from=${TODAY}&to=${TODAY}`);
  const stockBefore = (await must(aAdm, "GET", "/agent-portal/stock")).items.find((i) => i.productId === pA);
  const bankRA = listOf(await must(ADMIN, "GET", "/receiving-accounts")).find((r) => r.code === "BANK-01");

  await step("P1.lead-convert", "Lead → convert, «الشحن يُضاف» 1,000 + 100 = 1,100 (re-convert idempotent)", async () => {
    const lead = await must(aS1, "POST", "/agent-portal/leads", { customerName: `عميل P1 — ${RUN}`, mobileNumber: mobile(), countryId: ctx.EG.id, city: "القاهرة", productId: pA, quantity: 2, fulfillmentMethod: "SHIPPING" });
    const body = { pricingMode: "SHIPPING_ADDED", lines: [{ productId: pA, quantity: 2, lineAmount: 1000 }], fulfillmentMethod: "SHIPPING", paymentType: "PREPAID", countryId: ctx.EG.id, city: "القاهرة" };
    const o = await must(aS1, "POST", `/agent-portal/leads/${lead.id}/convert`, body);
    const again = await call(aS1, "POST", `/agent-portal/leads/${lead.id}/convert`, body);
    expect(!again.ok || again.json.id === o.id, "second conversion created another order");
    eq(o.breakdown.payableTotal, 1100, "payable");
    eq(o.breakdown.shippingCharge, 100, "shipping");
    ctx.orders.P1 = o;
    ctx.refs.lead = lead.leadNumber;
    return `${lead.leadNumber} → ${o.internalOrderId} (re-convert ${again.status})`;
  });
  await step("P1.declare", "Full declaration with proof to the company bank destination (replay → one claim)", async () => {
    const o = need(ctx.orders.P1, "P1");
    const att = await stageProof(aS1, "P1");
    const k = key("P1");
    const d = await declare(aS1, o.id, { kind: "FULL", destinationId: dBank.id, stagedAttachmentIds: [att] }, k);
    const d2 = await declare(aS1, o.id, { kind: "FULL", destinationId: dBank.id }, k);
    expect(d2.payment.claims.length === 1, `claims ${d2.payment.claims.length}`);
    ctx.claimP1 = d.payment.claims[0];
    ctx.attP1 = ctx.claimP1.attachments[0]?.attachmentId;
    expect(ctx.attP1, "proof not linked");
    return `${ctx.claimP1.paymentNumber} ${ctx.claimP1.amount} ${d.payment.declaredPaymentStatus}`;
  });
  await step("D1.verify-company", "Company-destination verification (Confirm & Post) fails CLOSED", async () => {
    const r = await call(FIN, "POST", `/payments/${need(ctx.claimP1, "claim").id}/confirm`);
    const msg = failsClosed(r, "AGENT_ACCOUNTS_NOT_CONFIGURED");
    const o = await must(aS1, "GET", `/agent-portal/orders/${ctx.orders.P1.id}`);
    expect(o.payment.claims[0].financeStatus === "PENDING", `claim now ${o.payment.claims[0].financeStatus}`);
    return msg;
  }, { expectBlocked: true });
  await step("P1.ship-return", "Ship → deliver; charges PENDING_CONFIGURATION; partial return with REVERSE + return fee (replay-safe)", async () => {
    const o = need(ctx.orders.P1, "P1");
    await ship(o.id);
    let e = await ledger(A.id, o.id);
    eq(sumType(e, "SHIPPING_FEE", "debit"), shipFee, "SHIPPING_FEE");
    eq(sumType(e, "COMMISSION", "debit"), r2(rate * 1000), "COMMISSION ex-shipping");
    eq(sumType(e, "CUSTOMER_SHIPPING_RETAINED", "debit"), 100, "retained shipping");
    eq(sumType(e, "COLLECTION_RECEIVED", "credit"), 0, "no collection while verification is blocked");
    const detail = await must(aS1, "GET", `/agent-portal/orders/${o.id}`);
    const body = { lines: [{ storeOrderItemId: detail.lines[0].id, quantity: 1 }], warehouseId: ctx.WH.id, reason: `مرتجع جزئي — ${RUN}`, idempotencyKey: key("P1-ret"), shipmentId: detail.fulfillment.shipments.at(-1)?.id };
    const r1 = await must(SHIP, "POST", `/agent-returns/orders/${o.id}`, body);
    const r1b = await must(SHIP, "POST", `/agent-returns/orders/${o.id}`, body);
    expect(r1.id === r1b.id, "return replay created a second receipt");
    e = await ledger(A.id, o.id);
    eq(sumType(e, "COMMISSION_REVERSAL", "credit"), r2(rate * 500), "COMMISSION_REVERSAL");
    eq(sumType(e, "RETURN_FEE", "debit"), retFee, "RETURN_FEE");
    const np = notPending(e);
    expect(np.length === 0, `not pending: ${np.map((x) => `${x.entryType}:${x.postingStatus}`).join(",")}`);
    ctx.refs.returnP1 = r1.returnNumber;
    return `${e.length} entries all PENDING_CONFIGURATION; return ${r1.returnNumber}`;
  });
  await step("D1.refund-company", "Company-paid refund fails CLOSED", async () => {
    const r = await call(FIN, "POST", `/agent-finance/orders/${need(ctx.orders.P1, "P1").id}/refunds`, { amount: 100, paidBy: "COMPANY", payingAccountId: bankRA.id, reason: `اختبار الإغلاق — ${RUN}`, refundDate: TODAY, idempotencyKey: key("refund") });
    return failsClosed(r);
  }, { expectBlocked: true });

  await step("P2.included", "Direct order «السعر شامل الشحن» 1,000 incl. 100 ⇒ 900 + 100 (duplicate submits → one order)", async () => {
    const body = { pricingMode: "SHIPPING_INCLUDED", agreedTotal: 1000, lines: [{ productId: pA, quantity: 2 }], fulfillmentMethod: "SHIPPING", paymentType: "PREPAID", countryId: ctx.EG.id, city: "الجيزة", customer: cust("P2", "الجيزة"), idempotencyKey: key("P2") };
    const [o, o2] = await Promise.all([must(aS1, "POST", "/agent-portal/orders", body), must(aS1, "POST", "/agent-portal/orders", body)]);
    const o3 = await must(aS1, "POST", "/agent-portal/orders", body);
    expect(o.id === o2.id && o.id === o3.id, "duplicate submit created more than one order");
    eq(o.breakdown.merchandiseAmount, 900, "merchandise");
    eq(o.breakdown.payableTotal, 1000, "payable");
    ctx.orders.P2 = o;
    return `${o.internalOrderId} ${JSON.stringify(o.breakdown)}`;
  });
  await step("P2.partial-full", "Partial 400 with proof (gate refuses shipping) → full 600 (gate passes) → ship/deliver", async () => {
    const o = need(ctx.orders.P2, "P2");
    const d = await declare(aS1, o.id, { kind: "PARTIAL", amount: 400, destinationId: dRec.id, stagedAttachmentIds: [await stageProof(aS1, "P2")] }, key("P2-p"));
    expect(d.payment.declaredPaymentStatus === "PARTIALLY_PAID", d.payment.declaredPaymentStatus);
    const gate = await call(SHIP, "POST", `/store-orders/${o.id}/shipments/label`, { fileUrl: "https://example.invalid/x.pdf" });
    expect(gate.status >= 400, `label after partial → ${gate.status}`);
    const f = await declare(aS1, o.id, { kind: "FULL", destinationId: dRec.id }, key("P2-f"));
    expect(f.payment.declaredPaymentStatus === "PAID" && near(f.payment.claims[1].amount, 600), "full remainder 600");
    await ship(o.id);
    const e = await ledger(A.id, o.id);
    eq(sumType(e, "COMMISSION", "debit"), r2(rate * 900), "COMMISSION on 900");
    expect(notPending(e).length === 0, "entries not pending");
    ctx.claimsP2 = f.payment.claims.map((c) => c.paymentNumber);
    return `gate refused (${gate.status}); claims ${ctx.claimsP2.join(", ")}; delivered; ledger net ${r2(e.reduce((s, x) => s + Number(x.credit) - Number(x.debit), 0))}`;
  });
  await step("P3.cod", "COD (Alexandria 150): ships unpaid; agent late declaration refused; Finance records courier claim; sales-2 visibility", async () => {
    const o = await must(aS2, "POST", "/agent-portal/orders", { pricingMode: "SHIPPING_ADDED", lines: [{ productId: pA, quantity: 1, lineAmount: 600 }], fulfillmentMethod: "SHIPPING", paymentType: "CASH_ON_DELIVERY", countryId: ctx.EG.id, city: "الإسكندرية", customer: cust("P3", "الإسكندرية"), idempotencyKey: key("P3") });
    ctx.orders.P3 = o;
    eq(o.breakdown.payableTotal, 750, "payable");
    await ship(o.id);
    const late = await call(aS2, "POST", `/agent-portal/orders/${o.id}/payment-declaration`, { kind: "FULL", destinationId: dRec.id, paymentDate: TODAY, idempotencyKey: key("P3-late") });
    expect(late.status === 403, `late agent declaration → ${late.status}`);
    await must(FIN, "POST", `/agent-orders/${o.id}/payment-declaration`, { kind: "FULL", destinationId: dRec.id, paymentDate: TODAY, reference: `${RUN}-COD`, idempotencyKey: key("P3-fin") });
    const s1 = await call(aS1, "GET", `/agent-portal/orders/${o.id}`);
    const adm = await call(aAdm, "GET", `/agent-portal/orders/${o.id}`);
    expect(s1.status === 404 && adm.status === 200, `visibility sales1 ${s1.status} admin ${adm.status}`);
    return `${o.internalOrderId}; late 403; claim ${adm.json.payment.claims[0]?.paymentNumber} stage ${adm.json.payment.claims[0]?.stage}`;
  });
  await step("P4.pickup", "Pickup: no shipping; READY → COLLECTED handover dispatches + earns (no shipping fee)", async () => {
    const o = await must(aS1, "POST", "/agent-portal/orders", { pricingMode: "SHIPPING_ADDED", lines: [{ productId: pA, quantity: 1, lineAmount: 300 }], fulfillmentMethod: "PICKUP", paymentType: "PREPAID", customer: cust("P4"), idempotencyKey: key("P4") });
    ctx.orders.P4 = o;
    eq(o.breakdown.shippingCharge, 0, "shipping");
    await declare(aS1, o.id, { kind: "FULL", destinationId: dBank.id }, key("P4-f"));
    await must(SHIP, "POST", `/store-orders/${o.id}/pickup/READY_FOR_PICKUP`);
    await must(SHIP, "POST", `/store-orders/${o.id}/pickup/COLLECTED`);
    const e = await ledger(A.id, o.id);
    eq(sumType(e, "SHIPPING_FEE", "debit"), 0, "shipping fee");
    eq(sumType(e, "COMMISSION", "debit"), r2(rate * 300), "commission");
    return o.internalOrderId;
  });
  await step("P5.digital-wallet", "Digital course paid to the AGENT wallet: company confirm refused; Agent collections verify = memo (idempotent)", async () => {
    const o = await must(aS1, "POST", "/agent-portal/orders", { pricingMode: "SHIPPING_ADDED", lines: [{ productId: cA, quantity: 1, lineAmount: 400 }], paymentType: "PREPAID", customer: cust("P5"), idempotencyKey: key("P5") });
    ctx.orders.P5 = o;
    eq(o.breakdown.shippingCharge, 0, "digital shipping");
    const d = await declare(aS1, o.id, { kind: "FULL", destinationId: dWallet.id }, key("P5-f"));
    const claim = d.payment.claims[0];
    failsClosed(await call(FIN, "POST", `/payments/${claim.id}/confirm`), "AGENT_DESTINATION_USE_AGENT_COLLECTIONS");
    const v1 = await must(FIN, "POST", `/agent-finance/collections/${claim.id}/verify`);
    const v2 = await must(FIN, "POST", `/agent-finance/collections/${claim.id}/verify`);
    expect(v2.alreadyVerified === true, "verify not idempotent");
    const e = await ledger(A.id, o.id);
    const memo = e.find((x) => x.entryType === "COLLECTION_BY_AGENT");
    expect(memo && near(memo.memoAmount, 400) && memo.postingStatus === "NOT_APPLICABLE", `memo ${JSON.stringify(memo)}`);
    eq(sumType(e, "COMMISSION", "debit"), r2(rate * 400), "commission (earned on full verification)");
    return `${o.internalOrderId} memo 400 (${v1.alreadyVerified}/${v2.alreadyVerified})`;
  });
  await step("PB.order", "Agent B: A's wallet refused; company declaration; verification fails closed ⇒ no PAYMENT_VERIFIED earning", async () => {
    const o = await must(bS1, "POST", "/agent-portal/orders", { pricingMode: "SHIPPING_ADDED", lines: [{ productId: pB, quantity: 1, lineAmount: 300 }], fulfillmentMethod: "SHIPPING", paymentType: "PREPAID", countryId: ctx.EG.id, customer: cust("PB"), idempotencyKey: key("PB") });
    ctx.orders.PB = o;
    const w = await call(bS1, "POST", `/agent-portal/orders/${o.id}/payment-declaration`, { kind: "FULL", destinationId: dWallet.id, paymentDate: TODAY, idempotencyKey: key("PB-w") });
    expect(w.status >= 400, `wallet → ${w.status}`);
    const d = await declare(bS1, o.id, { kind: "FULL", destinationId: dBankB.id, stagedAttachmentIds: [await stageProof(bS1, "PB")] }, key("PB-f"));
    ctx.attPB = d.payment.claims[0].attachments[0]?.attachmentId;
    failsClosed(await call(FIN, "POST", `/payments/${d.payment.claims[0].id}/confirm`), "AGENT_ACCOUNTS_NOT_CONFIGURED");
    const e = (await must(FIN, "GET", `/agent-finance/agents/${B.id}/ledger?storeOrderId=${o.id}&pageSize=50`)).items;
    eq(sumType(e, "COMMISSION", "debit"), 0, "B commission without verification");
    return o.internalOrderId;
  });

  await step("SEP.api", "Separation: agent tokens → 403 on internal endpoints; internal tokens → 403 on /agent-portal; sales lacks admin views", async () => {
    const o1 = ctx.orders.P1?.id ?? randomUUID();
    const probes = [
      ["GET", "/store-orders"], ["GET", "/shipping"], ["POST", `/store-orders/${o1}/shipments/ship`], ["POST", `/store-orders/${o1}/pickup/COLLECTED`],
      ["POST", `/agent-returns/orders/${o1}`, { lines: [], warehouseId: randomUUID(), idempotencyKey: "x" }], ["GET", "/agent-finance/collections"],
      ["POST", `/agent-finance/agents/${A.id}/payouts`, { amount: 1, payingAccountId: randomUUID(), payoutDate: TODAY, reference: "x", idempotencyKey: "x" }],
      ["GET", `/agent-finance/agents/${A.id}/statement`], ["POST", `/payments/${ctx.claimP1?.id ?? randomUUID()}/confirm`], ["GET", "/payment-reconciliation/methods"],
      ["GET", "/payment-settlements"], ["GET", "/import-center/jobs"], ["GET", "/agents"], ["GET", `/agents/${A.id}`], ["GET", "/users"], ["GET", "/products"], ["GET", "/partners"], ["GET", "/leads"],
    ];
    const bad = [];
    for (const p of [aAdm, aS1]) for (const [m, path, body] of probes) {
      const r = await call(p, m, path, body);
      if (r.status !== 403) bad.push(`${p} ${m} ${path} → ${r.status}`);
    }
    for (const p of [FIN, SHIP, ADMIN]) for (const path of ["/agent-portal/me", "/agent-portal/orders"]) {
      const r = await call(p, "GET", path);
      if (r.status !== 403) bad.push(`${p} ${path} → ${r.status}`);
    }
    for (const path of ["/agent-portal/statement", "/agent-portal/payouts", "/agent-portal/stock", "/agent-portal/team"]) {
      const r = await call(aS1, "GET", path);
      if (r.status !== 403) bad.push(`sales ${path} → ${r.status}`);
    }
    expect(bad.length === 0, bad.join("; "));
    return `${probes.length * 2 + 10} probes → 403`;
  });
  await step("ISO.api", "Cross-agent isolation: records, proofs, search → 404 / empty", async () => {
    const bad = [];
    for (const [p, path] of [[aAdm, `/agent-portal/orders/${need(ctx.orders.PB, "PB").id}`], [aAdm, `/agent-portal/attachments/${need(ctx.attPB, "B proof")}/file`], [bAdm, `/agent-portal/orders/${need(ctx.orders.P1, "P1").id}`], [bAdm, `/agent-portal/attachments/${need(ctx.attP1, "A proof")}/file`]]) {
      const r = await call(p, "GET", path);
      if (r.status !== 404) bad.push(`${p} ${path} → ${r.status}`);
    }
    const s = await must(aAdm, "GET", `/agent-portal/orders?search=${encodeURIComponent(ctx.orders.PB.internalOrderId)}`);
    if (s.items.length) bad.push("B order visible via A search");
    expect(bad.length === 0, bad.join("; "));
    return "404 × 4; search scoped";
  });
  await step("D1.payout", "Payout creation fails CLOSED", async () => {
    const pv = await must(FIN, "GET", `/agent-finance/agents/${A.id}/payouts/preview`);
    const r = await call(FIN, "POST", `/agent-finance/agents/${A.id}/payouts`, { amount: 1, payingAccountId: bankRA.id, payoutDate: TODAY, reference: `${RUN}-PAYOUT`, idempotencyKey: key("payout") });
    return `preview accountsConfigured=${pv.accountsConfigured} available=${pv.available}; POST → ${failsClosed(r)}`;
  }, { expectBlocked: true });
  await step("D1.post-pending", "postPending fails CLOSED (pending entries listed)", async () => {
    const list = await must(FIN, "GET", `/agent-finance/pending-postings?agentId=${A.id}`);
    const r = await call(FIN, "POST", "/agent-finance/pending-postings/post", { agentId: A.id });
    const n = Array.isArray(list) ? list.length : list.items?.length ?? list.total ?? list.count;
    return `pending ${n}; post → ${failsClosed(r, "AGENT_ACCOUNTS_NOT_CONFIGURED")}`;
  }, { expectBlocked: true });
  await step("STM.reconcile", "Statement / summary / dashboard reconcile (opening + Σ = closing; portal = internal; deltas)", async () => {
    const day = await must(FIN, "GET", `/agent-finance/agents/${A.id}/statement?from=${TODAY}&to=${TODAY}`);
    const full = await must(FIN, "GET", `/agent-finance/agents/${A.id}/statement`);
    for (const s of [day, full]) {
      const net = r2(s.lines.reduce((a, l) => a + Number(l.credit) - Number(l.debit), 0));
      eq(r2(s.openingBalance + net), s.closingBalance, "opening + Σ = closing");
      if (s.lines.length) eq(s.lines.at(-1).balance, s.closingBalance, "running = closing");
    }
    eq(full.closingBalance, full.summary.position.balance, "closing = position balance");
    const portal = await must(aAdm, "GET", `/agent-portal/statement?from=${TODAY}&to=${TODAY}`);
    eq(portal.closingBalance, day.closingBalance, "portal closing = internal");
    const dash = await must(FIN, "GET", `/agent-finance/agents/${A.id}/dashboard`);
    const s1 = await must(FIN, "GET", `/agent-finance/agents/${A.id}/summary?from=${TODAY}&to=${TODAY}`);
    const d = (f) => r2(f(s1) - f(summaryBefore));
    eq(d((s) => s.orders.merchandiseSalesExShipping), 1000 + 900 + 600 + 300 + 400, "Δ sales ex-shipping");
    eq(d((s) => s.orders.customerShippingCharges), 350, "Δ customer shipping charges");
    eq(d((s) => s.collections.byAgent), 400, "Δ collections by agent");
    eq(d((s) => s.collections.byCompany), 0, "Δ collections by company (verification blocked)");
    eq(d((s) => s.commission.charged), r2(rate * 3200), "Δ commission = rate × base");
    ctx.refs.statement = { period: `${TODAY}..${TODAY}`, opening: day.openingBalance, closing: day.closingBalance, lines: day.lines.length, allTimeClosing: full.closingBalance };
    ctx.refs.dashboard = JSON.stringify(dash).slice(0, 300);
    return `opening ${day.openingBalance} → closing ${day.closingBalance} (${day.lines.length} lines, all charges pending); Δ sales 3200, Δ commission ${d((s) => s.commission.charged)}`;
  });
  await step("STK.stock", "Agent stock moves with fulfillment (shipped +6, returned +1, on-hand −5)", async () => {
    const after = (await must(aAdm, "GET", "/agent-portal/stock")).items.find((i) => i.productId === pA);
    eq(after.shipped - stockBefore.shipped, 6, "shipped Δ");
    eq(after.returned - stockBefore.returned, 1, "returned Δ");
    eq(after.onHand - stockBefore.onHand, -5, "on-hand Δ");
    return `onHand ${stockBefore.onHand} → ${after.onHand}`;
  });
  if (process.env.SKIP_AGREEMENT === "1") return;
  await step("AGR.effective", "Effective-dated change: A's agreement ends tomorrow; new DRAFT→ACTIVE (+2 pp) from the day after; today's order snapshots the old rate", async () => {
    const list = listOf(await must(ADMIN, "GET", `/agents/${A.id}/agreements`));
    const current = list.find((a) => ["ACTIVE", "ENDED"].includes(a.status) && a.effectiveFrom.slice(0, 10) <= TODAY && (!a.effectiveTo || a.effectiveTo.slice(0, 10) >= TODAY));
    expect(current, "no agreement in force");
    const oldRate = Number(current.productCommissionRatePercent);
    let next = list.find((a) => a.status === "ACTIVE" && a.effectiveFrom.slice(0, 10) > TODAY);
    if (!next) {
      if (current.status === "ACTIVE" && !current.effectiveTo) await must(ADMIN, "POST", `/agents/${A.id}/agreements/${current.id}/end`, { effectiveTo: plusDays(1) });
      const draft = await must(ADMIN, "POST", `/agents/${A.id}/agreements`, { ...A.terms, productCommissionRatePercent: oldRate + 2, serviceCommissionRatePercent: oldRate + 2, effectiveFrom: plusDays(2), notes: `تغيير سعر العمولة (اختبار سريان) — ${TAG}` });
      const full = await must(ADMIN, "GET", `/agents/${A.id}/agreements/${current.id}`);
      for (const r of full.shippingRates ?? []) await must(ADMIN, "PUT", `/agents/${A.id}/agreements/${draft.id}/shipping-rates`, { countryId: r.countryId ?? r.country?.id, city: r.city ?? "", amount: Number(r.amount) });
      next = await must(ADMIN, "POST", `/agents/${A.id}/agreements/${draft.id}/activate`);
      created("Agreement", `${next.agreementNumber} (A, from ${plusDays(2)})`);
    }
    const o = await must(aS1, "POST", "/agent-portal/orders", { pricingMode: "SHIPPING_ADDED", lines: [{ productId: cA, quantity: 1, lineAmount: 200 }], paymentType: "PREPAID", customer: cust("P6"), idempotencyKey: key("P6") });
    ctx.orders.P6 = o;
    const internal = await must(ADMIN, "GET", `/store-orders/${o.id}`);
    eq(internal.agentTermsSnapshot?.productCommissionRatePercent, oldRate, "snapshot rate");
    return `${current.agreementNumber} → ends ${plusDays(1)} (${oldRate}%); ${next.agreementNumber} from ${next.effectiveFrom?.slice(0, 10)} (${next.productCommissionRatePercent}%); ${o.internalOrderId} snapshot ${oldRate}%`;
  });
}

async function main() {
  console.log(`Agents PRODUCTION acceptance — ${RUN} — ${API}\n`);
  await step("SETUP", "Tagged demo setup through real endpoints (agents, agreements, rates, destinations, products, opening stock, agent users + forced change)", setup);
  if (!A.id || !B.id || !A.email_sales1 || PHASE === "setup") return;
  await journeys();
}
try {
  await main();
} catch (e) {
  results.push({ id: "FATAL", title: "runner", status: "FAIL", detail: e.stack ?? String(e) });
  console.error(e);
}
const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
const refs = {
  agents: { A: A.agentNumber, B: B.agentNumber },
  agreements: { A: A.agreement, B: B.agreement },
  orders: Object.fromEntries(Object.entries(ctx.orders).map(([k, o]) => [k, o.internalOrderId])),
  ...ctx.refs,
};
console.log("\n| # | Check | Result |\n|---|---|---|");
for (const r of results) console.log(`| ${r.id} | ${r.title} | ${r.status} |`);
console.log(`\nSummary ${JSON.stringify(counts)}\nRefs ${JSON.stringify(refs)}\nCreated ${JSON.stringify(ctx.created)}`);
const report = { tour: "agents-prod-acceptance", run: RUN, api: API, finishedAt: new Date().toISOString(), summary: counts, refs, created: ctx.created, results, http: httpLog };
writeFileSync(resolve(OUT, `prod-acceptance-${RUN}.json`), JSON.stringify(report, null, 2));
writeFileSync(resolve(OUT, "latest.json"), JSON.stringify(report, null, 2));
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
