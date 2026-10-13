#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R19 §C2 — populate the LOCAL demo DB (oms_r19_c) so every sales-report period and tab shows
 * non-zero figures for the before / after screenshots. Creates a few tagged («R19C2 demo») valid
 * company orders (today, yesterday, 3 days ago, last month; prepaid + COD; two sales employees),
 * one cancelled and one returned pickup order, and agent orders through the agent portal — all
 * through the public API (no SQL). Local verification DB only; never run against Production.
 *
 *   API=http://localhost:4725 PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env \
 *     node scripts/acceptance/r19/r19-c2-seed-demo-orders.mjs
 */
import { readFileSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4725").replace(/\/$/, "");
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local API only");
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const TAG = "R19C2 demo";
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

/** Cairo noon of the day `offset` days from today (orderDate is placed in the Cairo calendar). */
function cairoNoon(offset) {
  const now = new Date();
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 10),
  );
  return day.toISOString();
}
function lastMonthNoon(dayOfMonth) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dayOfMonth, 10),
  ).toISOString();
}

const admin = await login("admin@oms-demo.local");
const currencies = items((await call(admin, "GET", "/currencies?pageSize=50")).j);
const egp = currencies.find((c) => c.code === "EGP");
const countries = items((await call(admin, "GET", "/countries?pageSize=300")).j);
const eg = countries.find((c) => c.code === "EG");
const product = items((await call(admin, "GET", "/products?pageSize=20&status=ACTIVE")).j).find(
  (p) => p.isSellable !== false,
);
const users = items((await call(admin, "GET", "/users?pageSize=200")).j);
const sales = users.find((u) => u.email === "sales@oms-demo.local");
const sales2 = users.find((u) => u.email === "sales2@oms-demo.local");
if (!egp || !eg || !product || !sales || !sales2) throw new Error("demo master data missing");

const created = [];
async function companyOrder(key, { offset, date, employee, amount, paymentType, pickup = false }) {
  const body = {
    partner: {
      name: `${TAG} ${key}`,
      phone: phone(),
      countryId: eg.id,
      city: "Cairo",
      address: "Street 1",
    },
    source: "MANUAL",
    orderDate: date ?? cairoNoon(offset),
    employeeId: employee.id,
    currencyId: egp.id,
    paymentType,
    fulfillmentMethod: pickup ? "PICKUP" : "SHIPPING",
    notes: TAG,
    items: [{ productId: product.id, quantity: 1, unitPrice: amount }],
    delivery: pickup ? undefined : { countryId: eg.id, city: "Cairo", address: "Street 1" },
    creationIdempotencyKey: `r19c2-${RUN}-${key}`,
  };
  const r = await call(admin, "POST", "/store-orders", body);
  console.log(
    r.s === 201 ? "created" : "FAILED",
    key,
    r.s,
    r.s === 201 ? "" : JSON.stringify(r.j).slice(0, 300),
  );
  if (r.s === 201) created.push(key);
  return r.j;
}

// Today, yesterday, 3 days ago, last month — two employees, prepaid and cash on delivery.
await companyOrder("today-1", { offset: 0, employee: sales, amount: 1250, paymentType: "PREPAID" });
await companyOrder("today-2", {
  offset: 0,
  employee: sales2,
  amount: 860,
  paymentType: "CASH_ON_DELIVERY",
});
await companyOrder("today-3", {
  offset: 0,
  employee: sales,
  amount: 2400,
  paymentType: "CASH_ON_DELIVERY",
});
await companyOrder("yesterday-1", {
  offset: -1,
  employee: sales2,
  amount: 1780,
  paymentType: "PREPAID",
});
await companyOrder("yesterday-2", {
  offset: -1,
  employee: sales,
  amount: 540,
  paymentType: "CASH_ON_DELIVERY",
});
await companyOrder("week-1", {
  offset: -3,
  employee: sales2,
  amount: 3150,
  paymentType: "CASH_ON_DELIVERY",
});
await companyOrder("lastmonth-1", {
  date: lastMonthNoon(8),
  employee: sales,
  amount: 4200,
  paymentType: "PREPAID",
});
await companyOrder("lastmonth-2", {
  date: lastMonthNoon(17),
  employee: sales2,
  amount: 1975,
  paymentType: "CASH_ON_DELIVERY",
});
await companyOrder("lastmonth-3", {
  date: lastMonthNoon(24),
  employee: sales,
  amount: 980,
  paymentType: "CASH_ON_DELIVERY",
});

// A cancelled and a returned order today (pickup workflow): cancelled / returned counts > 0.
const cancelled = await companyOrder("today-cancelled", {
  offset: 0,
  employee: sales2,
  amount: 700,
  paymentType: "CASH_ON_DELIVERY",
  pickup: true,
});
if (cancelled?.id)
  console.log(
    "cancel",
    (await call(admin, "POST", `/store-orders/${cancelled.id}/pickup/CANCELLED`)).s,
  );
const returned = await companyOrder("today-returned", {
  offset: 0,
  employee: sales,
  amount: 1100,
  paymentType: "PREPAID",
  pickup: true,
});
if (returned?.id) {
  for (const code of ["READY_FOR_PICKUP", "COLLECTED", "RETURNED"]) {
    const r = await call(admin, "POST", `/store-orders/${returned.id}/pickup/${code}`);
    console.log("returned step", code, r.s, r.s >= 300 ? JSON.stringify(r.j).slice(0, 200) : "");
  }
}

// Agent portal orders (the agent's own scope) — today, yesterday and last month.
const agent = await login("agent@oms-demo.local");
const agentProducts = items((await call(agent, "GET", "/agent-portal/products?pageSize=20")).j);
const agentProduct = agentProducts[0] ?? product;
for (const [key, orderDate, paymentType, lineAmount] of [
  ["agent-today", cairoNoon(0), "CASH_ON_DELIVERY", 950],
  ["agent-yesterday", cairoNoon(-1), "PREPAID", 1320],
  ["agent-lastmonth", lastMonthNoon(12), "CASH_ON_DELIVERY", 2100],
]) {
  const body = {
    pricingMode: "SHIPPING_INCLUDED",
    lines: [{ productId: agentProduct.id ?? agentProduct.productId, quantity: 1, lineAmount }],
    agreedTotal: lineAmount,
    fulfillmentMethod: "SHIPPING",
    paymentType,
    countryId: eg.id,
    city: "Giza",
    address: "Street 2",
    orderDate,
    customer: {
      name: `${TAG} ${key}`,
      mobile: phone(),
      countryId: eg.id,
      city: "Giza",
      address: "Street 2",
    },
    notes: TAG,
    idempotencyKey: `r19c2-${RUN}-${key}`,
  };
  let r = await call(agent, "POST", "/agent-portal/orders", body);
  if (r.s === 404) r = await call(agent, "POST", "/agent-orders", body);
  console.log(
    r.s < 300 ? "created" : "FAILED",
    key,
    r.s,
    r.s < 300 ? "" : JSON.stringify(r.j).slice(0, 300),
  );
  if (r.s < 300) created.push(key);
}
console.log(`\n${created.length} demo orders created (${TAG}, run ${RUN})`);
