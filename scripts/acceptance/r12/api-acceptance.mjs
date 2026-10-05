#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R12 — unified advanced lookup (permissions, formats, minimal disclosure) and
 * country defaults (calling code / currency source): direct API acceptance on
 * the local verification clone (tagged demo records).
 *
 *   API=http://localhost:4705 node scripts/acceptance/r12/api-acceptance.mjs
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4705").replace(/\/$/, "");
function pw() {
  if (process.env.R12_PW) return process.env.R12_PW;
  const file = "D:/Systems/OMS/tmp/r7-final/.r7.env";
  const line = existsSync(file)
    ? readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("R7_PW="))
    : null;
  if (!line) throw new Error("no password");
  return line.slice(6).trim();
}
const PW = pw();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  return j.accessToken;
}
const call = async (t, m, p, b) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
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
const TAG = "R12ACC" + Date.now().toString().slice(-6);
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));
const toAr = (s) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

const admin = await login("demo-r7-admin@oms.local");
const salesA = await login("demo-r7-sales-a@oms.local");
const salesB = await login("demo-r7-sales-b@oms.local");
const agentA = await login("agent-a-admin.demo-agt@oms.local");
const agentB = await login("agent-b-admin.demo-agt@oms.local");

// ── country defaults: the configured source of the proposals ────────────────
const countries = (await call(admin, "GET", "/countries?pageSize=300")).j.items;
// The verification clone holds hundreds of leftover test currencies: look the real ones up by code.
const curList = [];
for (const code of ["SAR", "EGP", "AED", "USD"]) {
  const page = (await call(admin, "GET", `/currencies?search=${code}&pageSize=10`)).j;
  curList.push(...(page.items ?? page).filter((c) => c.code === code));
}
const byId = (id) => curList.find((c) => c.id === id)?.code;
const sa = countries.find((c) => c.code === "SA");
const eg = countries.find((c) => c.code === "EG");
check("countries expose defaultCurrencyId (SA → SAR)", byId(sa.defaultCurrencyId) === "SAR", byId(sa.defaultCurrencyId));
check("countries expose defaultCurrencyId (EG → EGP)", byId(eg.defaultCurrencyId) === "EGP", byId(eg.defaultCurrencyId));
const kw = countries.find((c) => c.code === "KW");
check("a country without a configured currency stays unset (asked, never guessed)", !kw.defaultCurrencyId);

// admin can maintain it; a bad id is refused; clearing works (restored afterwards)
const original = kw.defaultCurrencyId ?? null;
const bad = await call(admin, "PATCH", `/countries/${kw.id}`, { defaultCurrencyId: "00000000-0000-4000-8000-000000000000" });
check("unknown default currency refused (400)", bad.s === 400, `${bad.s}`);
const sar = curList.find((c) => c.code === "SAR");
const setOk = await call(admin, "PATCH", `/countries/${kw.id}`, { defaultCurrencyId: sar.id });
check("default currency can be set on a country", setOk.s === 200 && setOk.j?.defaultCurrencyId === sar.id, `${setOk.s}`);
const clr = await call(admin, "PATCH", `/countries/${kw.id}`, { defaultCurrencyId: "" });
check("…and cleared again", clr.s === 200 && clr.j?.defaultCurrencyId === null, `${clr.s}`);
if (original) await call(admin, "PATCH", `/countries/${kw.id}`, { defaultCurrencyId: original });

// ── fixtures: a customer owned by sales A ───────────────────────────────────
const product = (await call(admin, "GET", "/products?pageSize=5&status=ACTIVE")).j.items[0];
const sarId = sar.id;
const n = rnd();
const phone = { national: `05${n.slice(0, 8)}`, e164: `+9665${n.slice(0, 8)}` };
const seed = await call(salesA, "POST", "/store-orders", {
  partner: { name: `${TAG} Lookup Customer`, phone: phone.e164, countryId: sa.id, city: "Riyadh", address: "Seed street 1" },
  source: "MANUAL",
  currencyId: sarId,
  paymentType: "CASH_ON_DELIVERY",
  items: [{ productId: product.id, quantity: 1, unitPrice: 150 }],
  creationIdempotencyKey: `${TAG}-seed`,
});
check("setup: tagged customer + order created for sales A", seed.s === 201, `${seed.s}`);
const orderNumber = seed.j?.internalOrderId;
const orderId = seed.j?.id;

// ── real role grants: ordinary employees (not admins) can look up ───────────
const lookup = (t, q) => call(t, "POST", "/customer-lookup/advanced", { query: q });
const forms = {
  "+966 E.164": phone.e164,
  "national 05…": phone.national,
  "00966 prefix": `00966${phone.e164.slice(4)}`,
  "spaced": `${phone.national.slice(0, 3)} ${phone.national.slice(3, 6)} ${phone.national.slice(6)}`,
  "Arabic digits": toAr(phone.national),
  "Arabic digits +966": toAr(phone.e164),
};
for (const [label, q] of Object.entries(forms)) {
  const r = await lookup(salesB, q);
  check(`ordinary employee (sales B) finds sales A's customer — ${label}`, r.s === 200 && r.j?.exists === true, `${r.s} exists=${r.j?.exists}`);
}
const asB = await lookup(salesB, phone.e164);
const m = asB.j?.matches?.[0];
check("other employee: flagged not-assigned, masked, no link", m?.notAssignedToYou === true && m?.openable === null && /•/.test(m?.maskedPhone ?? "") && /•/.test(m?.partialName ?? ""));
check("other employee: no previous-order history, no ids leaked", Array.isArray(m?.previousOrders) && m.previousOrders.length === 0 && !JSON.stringify(asB.j).includes(orderId));
const forbidden = ["address", "city", "email", "amount", "total", "payment", "agent", "employee", "owner"];
check("minimal fields only", !forbidden.some((w) => JSON.stringify(asB.j).toLowerCase().includes(w)));
const orderQ = await lookup(salesB, orderNumber);
check("order number finds the same customer (read-only for others)", orderQ.s === 200 && orderQ.j?.matches?.[0]?.reference?.number === orderNumber && orderQ.j.matches[0].openable === null);
const asA = await lookup(salesA, phone.national);
const mA = asA.j?.matches?.[0];
check("owner: assigned to you, can open, sees previous orders", mA?.notAssignedToYou === false && mA?.openable?.id === orderId && mA?.previousOrders?.some((o) => o.id === orderId));
const openB = await call(salesB, "GET", `/store-orders/${orderId}`);
check("cross-owner discovery grants no access: by-id is denied for sales B", [403, 404].includes(openB.s), `${openB.s}`);
const editB = await call(salesB, "PATCH", `/store-orders/${orderId}`, { notes: "x" });
check("…and cannot edit", [403, 404].includes(editB.s), `${editB.s}`);

// ── agents ───────────────────────────────────────────────────────────────────
const agentLookup = await lookup(agentA, phone.e164);
check("an agent user cannot use the company lookup (403)", agentLookup.s === 403, `${agentLookup.s}`);
const agentOrder = await call(agentA, "GET", `/agent-portal/orders?search=${encodeURIComponent(phone.e164)}`);
check("agent portal never exposes the company order", (agentOrder.j?.items ?? agentOrder.j?.data ?? []).length === 0, `${agentOrder.s}`);
const other = await call(agentB, "GET", `/agent-portal/orders?search=${encodeURIComponent(phone.e164)}`);
check("another agent sees nothing either", (other.j?.items ?? other.j?.data ?? []).length === 0, `${other.s}`);

// ── standard (list) search stays scoped ─────────────────────────────────────
const listB = await call(salesB, "GET", `/store-orders?search=${encodeURIComponent(phone.national)}&pageSize=20`);
check("standard list search is scoped: sales B finds nothing of sales A", listB.s === 200 && listB.j?.total === 0, `${listB.s} total=${listB.j?.total}`);
const listA = await call(salesA, "GET", `/store-orders?search=${encodeURIComponent(phone.national)}&pageSize=20`);
check("…sales A finds their own order (national format)", listA.j?.total >= 1, `total=${listA.j?.total}`);

mkdirSync("D:/Systems/OMS/specs/round12-contextual-ui/evidence", { recursive: true });
writeFileSync("D:/Systems/OMS/specs/round12-contextual-ui/evidence/api-acceptance.json", JSON.stringify({ tag: TAG, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
