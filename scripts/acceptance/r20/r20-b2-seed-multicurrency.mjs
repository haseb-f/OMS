#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R20 §B2 — LOCAL demo DB only (oms_r20_b): a few tagged («R20B2 demo») multi-currency company
 * orders so two adjacent employee cards (sales, sales2) carry realistic SAR / USD / AED figures
 * next to EGP across the five periods, plus one large amount — all through the public API (no
 * SQL). Never run against Production.
 *
 *   API=http://localhost:4815 PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env \
 *     node scripts/acceptance/r20/r20-b2-seed-multicurrency.mjs
 */
import { readFileSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4815").replace(/\/$/, "");
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local API only");
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const TAG = "R20B2 demo";
const RUN = Date.now().toString().slice(-6);

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login ${email}: ${r.status}`);
  return j.accessToken;
}
const call = async (token, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {
    /* empty */
  }
  return { s: r.status, j };
};
const items = (j) => j?.items ?? j?.data ?? j ?? [];
const phone = () => `+2010${String(10000000 + Math.floor(Math.random() * 89999999))}`;
/** Cairo noon `offset` days from today. */
function cairoNoon(offset) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 10),
  ).toISOString();
}
function lastMonthNoon(dayOfMonth) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dayOfMonth, 10),
  ).toISOString();
}

const admin = await login("admin@oms-demo.local");
const currencies = items((await call(admin, "GET", "/currencies?pageSize=50")).j);
const cur = Object.fromEntries(currencies.map((c) => [c.code, c]));
const countries = items((await call(admin, "GET", "/countries?pageSize=300")).j);
const eg = countries.find((c) => c.code === "EG");
const product = items((await call(admin, "GET", "/products?pageSize=20&status=ACTIVE")).j).find(
  (p) => p.isSellable !== false,
);
const users = items((await call(admin, "GET", "/users?pageSize=200")).j);
const sales = users.find((u) => u.email === "sales@oms-demo.local");
const sales2 = users.find((u) => u.email === "sales2@oms-demo.local");
for (const code of ["EGP", "SAR", "USD", "AED"]) if (!cur[code]) throw new Error(`no ${code}`);
if (!eg || !product || !sales || !sales2) throw new Error("demo master data missing");

let ok = 0;
async function order(key, { date, employee, currency, amount }) {
  const body = {
    partner: {
      name: `${TAG} ${key}`,
      phone: phone(),
      countryId: eg.id,
      city: "Cairo",
      address: "Street 1",
    },
    source: "MANUAL",
    orderDate: date,
    employeeId: employee.id,
    currencyId: cur[currency].id,
    paymentType: "PREPAID",
    fulfillmentMethod: "SHIPPING",
    notes: TAG,
    items: [{ productId: product.id, quantity: 1, unitPrice: amount }],
    delivery: { countryId: eg.id, city: "Cairo", address: "Street 1" },
    creationIdempotencyKey: `r20b2-${RUN}-${key}`,
  };
  const r = await call(admin, "POST", "/store-orders", body);
  console.log(r.s === 201 ? "created" : "FAILED", key, r.s, r.s === 201 ? "" : JSON.stringify(r.j).slice(0, 300));
  if (r.s === 201) ok += 1;
}

const plan = [
  ["s-today-sar", cairoNoon(0), sales, "SAR", 1450],
  ["s-today-usd", cairoNoon(0), sales, "USD", 320.5],
  ["s-yesterday-aed", cairoNoon(-1), sales, "AED", 2750],
  ["s-week-sar", cairoNoon(-4), sales, "SAR", 1250000],
  ["s-lastmonth-usd", lastMonthNoon(14), sales, "USD", 899.99],
  ["s2-today-aed", cairoNoon(0), sales2, "AED", 640],
  ["s2-yesterday-sar", cairoNoon(-1), sales2, "SAR", 3100],
  ["s2-yesterday-usd", cairoNoon(-1), sales2, "USD", 75],
  ["s2-week-egp", cairoNoon(-5), sales2, "EGP", 18250],
  ["s2-lastmonth-sar", lastMonthNoon(9), sales2, "SAR", 4380],
  ["s2-lastmonth-aed", lastMonthNoon(21), sales2, "AED", 1999],
];
for (const [key, date, employee, currency, amount] of plan) {
  await order(key, { date, employee, currency, amount });
}
console.log(`created ${ok} / ${plan.length} tagged («${TAG}») orders`);
