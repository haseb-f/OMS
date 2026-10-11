#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R17 stream A — API journey for versioned agent agreements + the COD collection fee
 * (specs/round17-refinements/README.md §2, §3 and "Numeric example"). LOCAL API ONLY.
 *
 *   API=http://localhost:3005 node scripts/acceptance/r17/r17-agreements-journey.mjs
 *
 * Personas: admin@oms-demo.local (company, agents.agreements.manage via super admin),
 * agent@oms-demo.local (agent ADMIN), agent2@oms-demo.local (agent SALES, same agent).
 * Password: MANUAL_PW from D:/Systems/OMS/tmp/r15-manual/.env (read at runtime, never printed).
 *
 * Steps (writes on the local demo database only):
 *   1  the agent's shipping agreement in force → Edit (new version from now): default ANY rate 25 +
 *      COD collection fee 10 ("v1" of the example; a fresh agreement is created when none is in force)
 *   2  O1 (COD) submitted by the agent → 35 (25 + 10)
 *   3  Edit at t2 → base 30, COD fee 12 ("v2"); the previous version closes at t2 (activeTo)
 *   4  O1 re-read → still 35 (its snapshot); O2 (COD) → 42; O3 (prepaid) → 30 (prepaid never pays the fee)
 *   5  agent / agent2 call the internal Edit API → 403 (agents never edit agreements)
 *   6  /agent-portal/me shows the tariff (base, COD fee, mode) — no carrier cost / margin keys
 * Prints a compact table; exit code 1 when any check fails.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  throw new Error("Local API only — this journey writes data and never runs against Production.");
}
const PW = readFileSync("D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!PW) throw new Error("MANUAL_PW missing in D:/Systems/OMS/tmp/r15-manual/.env");

const PERSONAS = {
  admin: "admin@oms-demo.local",
  agent: "agent@oms-demo.local",
  agent2: "agent2@oms-demo.local",
};
const tokens = {};
async function login(who) {
  if (tokens[who]) return tokens[who];
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "r17-agreements-journey" },
    body: JSON.stringify({ email: PERSONAS[who], password: PW }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.accessToken) throw new Error(`login ${who} → ${res.status} ${json.code ?? ""}`);
  if (json.mustChangePassword) throw new Error(`${who} must change the password first`);
  tokens[who] = json.accessToken;
  return tokens[who];
}
async function call(who, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await login(who)}`,
      "Content-Type": "application/json",
      "User-Agent": "r17-agreements-journey",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
async function ok(who, method, path, body) {
  const r = await call(who, method, path, body);
  if (r.status >= 300) {
    throw new Error(`${method} ${path} → ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? ""}`);
  }
  return r.json;
}

const checks = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, actual, expected, pass });
  return pass;
};
const money = (v) => (v == null ? "—" : Number(v).toFixed(2));
const LEAK = /cost|margin|carriercharge/i;
const leaked = (value, path = "") =>
  Array.isArray(value)
    ? value.flatMap((v, i) => leaked(v, `${path}[${i}]`))
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => [
          ...(LEAK.test(k) || k === "carrier" ? [`${path}.${k}`] : []),
          ...leaked(v, `${path}.${k}`),
        ])
      : [];

// ── Context ───────────────────────────────────────────────────────────────
const me = await ok("agent", "GET", "/agent-portal/me");
const agentId = me.agent.id;
const currency = me.agent.currency.code;
const base = `/agents/${agentId}/shipping-agreements`;
const products = await ok("agent", "GET", "/agent-portal/products");
const product = (products.items ?? products).find(
  (p) => p.isInventoryItem && Number(p.listPrice ?? 0) > 0 && Number(p.available ?? 0) >= 3,
);
if (!product) throw new Error("The demo agent has no sellable stocked product");
const countries = await ok("agent", "GET", "/agent-portal/countries");
const egypt = (countries.items ?? countries).find((c) => c.code === "EG");
if (!egypt) throw new Error("Egypt (EG) is not in the country list");

const tag = randomUUID().slice(0, 6).toUpperCase();
let seq = 0;
const order = async (paymentType) => {
  seq += 1;
  const created = await ok("agent", "POST", "/agent-portal/orders", {
    pricingMode: "SHIPPING_ADDED",
    lines: [{ productId: product.id, quantity: 1, lineAmount: 100 }],
    fulfillmentMethod: "SHIPPING",
    paymentType,
    countryId: egypt.id,
    city: "Cairo",
    customer: {
      name: `R17 journey ${tag} ${seq}`,
      mobile: `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      countryId: egypt.id,
    },
    idempotencyKey: `r17-journey-${tag}-${seq}`,
  });
  // The agent's charge as the portal shows it: amount + make-up (base, COD fee, mode).
  return ok("agent", "GET", `/agent-portal/orders/${created.id}`);
};
const portalOrder = (id) => ok("agent", "GET", `/agent-portal/orders/${id}`);
const fee = (o) => o.shippingPricing?.agentShippingFee ?? {};
const makeUp = (o) => [fee(o).base, fee(o).codFee, fee(o).codFeeMode, fee(o).amount];

// ── 1. v1: default 25 + COD fee 10 ────────────────────────────────────────
const terms = (amount, fee) => ({
  rates: [{ service: "ANY", amount, codFee: "ADDED" }],
  codCollectionFee: fee,
  notes: `R17 journey ${tag}`,
});
let list = await ok("admin", "GET", base);
let v1;
if (list.inForceId) {
  v1 = await ok("admin", "POST", `${base}/${list.inForceId}/versions`, terms(25, 10));
} else {
  const today = new Date().toISOString().slice(0, 10);
  const draft = await ok("admin", "POST", base, { effectiveFrom: today, ...terms(25, 10) });
  v1 = await ok("admin", "POST", `${base}/${draft.id}/activate`, {});
}

// ── 2. O1 (COD) at t1 ─────────────────────────────────────────────────────
const o1 = await order("CASH_ON_DELIVERY");

// ── 3. Edit at t2: 30 + 12 ───────────────────────────────────────────────
const v2 = await ok("admin", "POST", `${base}/${v1.id}/versions`, terms(30, 12));
const v1After = await ok("admin", "GET", `${base}/${v1.id}`);
list = await ok("admin", "GET", base);

// ── 4. O1 unchanged; O2 (COD) 42; O3 (prepaid) 30 ────────────────────────
const o2 = await order("CASH_ON_DELIVERY");
const o3 = await order("PREPAID");
const o1After = await portalOrder(o1.id);

// ── 5. Agents never edit agreements ──────────────────────────────────────
const deniedAgent = await call("agent", "POST", `${base}/${v2.id}/versions`, terms(1, 1));
const deniedAgent2 = await call("agent2", "POST", `${base}/${v2.id}/versions`, terms(1, 1));

// ── 6. Portal /me — the agent's tariff only ───────────────────────────────
const meAfter = await ok("agent", "GET", "/agent-portal/me");

// ── Checks ────────────────────────────────────────────────────────────────
check("v2 supersedes v1", v2.supersedes?.id, v1.id);
check("v1 closed at the save instant of v2", v1After.activeTo, v2.activeFrom);
check("in force now = v2", list.inForceId, v2.id);
check("O1 COD (v1) = 25 + 10", makeUp(o1), [25, 10, "ADDED", 35]);
check("O1 after the edit (snapshot)", makeUp(o1After), [25, 10, "ADDED", 35]);
check("O1 customer shipping unchanged", o1After.shippingPricing?.customerShipping, 35);
check("O2 COD (v2) = 30 + 12", makeUp(o2), [30, 12, "ADDED", 42]);
check("O3 prepaid (v2) = 30, no fee", makeUp(o3), [30, 0, "NONE", 30]);
check("agent ADMIN → internal Edit API", deniedAgent.status, 403);
check("agent SALES → internal Edit API", deniedAgent2.status, 403);
check("portal tariff: v2 ANY 30, COD 42", meAfter.shippingAgreement?.rates?.map((r) => [r.service, r.amount, r.codFee, r.codAmount]), [["ANY", 30, "ADDED", 42]]);
check("portal: no cost / margin keys", leaked(meAfter), []);

// ── Report ────────────────────────────────────────────────────────────────
const rowsOut = [
  ["O1", "COD", `v${v1.versionNumber} ${v1.agreementNumber}`, "25 + 10", money(fee(o1).amount), money(fee(o1After).amount), "35.00"],
  ["O2", "COD", `v${v2.versionNumber} ${v2.agreementNumber}`, "30 + 12", money(fee(o2).amount), "", "42.00"],
  ["O3", "PREPAID", `v${v2.versionNumber} ${v2.agreementNumber}`, "30", money(fee(o3).amount), "", "30.00"],
];
console.log(`R17 agreements journey — ${API} — agent ${me.agent.agentNumber} (${currency}), product ${product.sku ?? product.id}`);
console.log(`v1 ${v1.agreementNumber} activeFrom ${v1.activeFrom} → activeTo ${v1After.activeTo}`);
console.log(`v2 ${v2.agreementNumber} activeFrom ${v2.activeFrom}`);
console.table(
  rowsOut.map(([o, pay, version, terms, at, later, expected]) => ({
    order: o,
    payment: pay,
    version,
    terms,
    charge: at,
    "after edit": later,
    expected,
  })),
);
console.table(checks.map((c) => ({ check: c.name, result: c.pass ? "PASS" : "FAIL", actual: JSON.stringify(c.actual) })));
const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `FAILED ${failed.length}/${checks.length}` : `PASS ${checks.length}/${checks.length}`);
process.exit(failed.length ? 1 : 0);
