// Local demo DB only: two back-dated agent orders (yesterday, last month) created by the company
// admin for the agent of agent@oms-demo.local (the agent portal always dates an order today).
import { readFileSync } from "node:fs";
const API = "http://localhost:4725";
const PW = readFileSync("D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const login = async (email) =>
  (
    await (
      await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PW }),
      })
    ).json()
  ).accessToken;
const call = async (t, m, p, b) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const items = (j) => j?.items ?? j?.data ?? j ?? [];
const admin = await login("admin@oms-demo.local");
const agentTok = await login("agent@oms-demo.local");
const me =
  (await call(agentTok, "GET", "/agent-portal/me")).j ??
  (await call(agentTok, "GET", "/auth/me")).j;
const agents = items((await call(admin, "GET", "/agents?pageSize=50")).j);
const agentId = me?.agent?.id ?? me?.agentId ?? agents.find((a) => a.code === "AG-0001")?.id;
console.log("agent", agentId ? "found" : "missing", agents.map((a) => a.code).join(","));
const eg = items((await call(admin, "GET", "/countries?pageSize=300")).j).find(
  (c) => c.code === "EG",
);
const products = items((await call(agentTok, "GET", "/agent-portal/products?pageSize=20")).j);
const product =
  products[0] ?? items((await call(admin, "GET", "/products?pageSize=5&status=ACTIVE")).j)[0];
const now = new Date();
const dates = [
  [
    "agent-yesterday-bd",
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 10)),
  ],
  ["agent-lastmonth-bd", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 14, 10))],
];
for (const [key, date] of dates) {
  const body = {
    agentId,
    pricingMode: "SHIPPING_INCLUDED",
    lines: [{ productId: product.id ?? product.productId, quantity: 1, lineAmount: 1450 }],
    agreedTotal: 1450,
    fulfillmentMethod: "SHIPPING",
    paymentType: key.includes("yesterday") ? "PREPAID" : "CASH_ON_DELIVERY",
    countryId: eg.id,
    city: "Giza",
    address: "Street 2",
    orderDate: date.toISOString(),
    customer: {
      name: `R19C2 demo ${key}`,
      mobile: `+2011${String(10000000 + Math.floor(Math.random() * 89999999))}`,
      countryId: eg.id,
    },
    notes: "R19C2 demo",
    idempotencyKey: `r19c2-${Date.now()}-${key}`,
  };
  const r = await call(admin, "POST", "/agent-orders", body);
  console.log(
    key,
    r.s,
    r.s < 300 ? (r.j?.orderDate ?? r.j?.order?.orderDate ?? "") : JSON.stringify(r.j).slice(0, 300),
  );
}
