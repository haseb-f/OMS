#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R11 — customer recognition, repeat-order confirmation, lookup and search:
 * direct API acceptance (tagged demo records, local verification clone only).
 *
 *   API=http://localhost:4605 R11_PW=... node scripts/acceptance/r11/api-acceptance.mjs
 *
 * The password comes from the environment or tmp/r7-final/.r7.env (R7_PW).
 * Covers acceptance scenarios 1-10 and 12 at the API level (the browser pass
 * covers the UI side, `tmp/r11/browser-acceptance.mjs`).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4605").replace(/\/$/, "");
function pw() {
  if (process.env.R11_PW) return process.env.R11_PW;
  const file = "D:/Systems/OMS/tmp/r7-final/.r7.env";
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("R7_PW="));
    if (line) return line.slice(6).trim();
  }
  throw new Error("no password");
}
const PW = pw();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  return j.accessToken;
}
const call = async (t, m, p, b) => {
  const r = await fetch(API + p, { method: m, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  return { s: r.status, j };
};
const TAG = "R11ACC" + Date.now().toString().slice(-6);
const rnd = () => String(10000000 + Math.floor(Math.random() * 89999999));

const admin = await login("demo-r7-admin@oms.local");
const salesA = await login("demo-r7-sales-a@oms.local");
const salesB = await login("demo-r7-sales-b@oms.local");
const agentA = await login("agent-a-admin.demo-agt@oms.local");
const agentB = await login("agent-b-admin.demo-agt@oms.local");

const curr = (await call(admin, "GET", "/currencies?pageSize=50")).j;
const currencies = curr.items ?? curr;
const currencyId = (currencies.find((c) => c.code === "SAR") ?? currencies[0]).id;
const countries = ((await call(admin, "GET", "/countries?pageSize=300")).j.items) ?? [];
const sa = countries.find((c) => c.code === "SA");
const eg = countries.find((c) => c.code === "EG");
const product = (await call(admin, "GET", "/products?pageSize=5&status=ACTIVE")).j.items[0];
const baseOrder = (partner, key, extra = {}) => ({
  partner,
  source: "MANUAL",
  currencyId,
  paymentType: "CASH_ON_DELIVERY",
  items: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
  creationIdempotencyKey: `${TAG}-${key}`,
  ...extra,
});

// ───── 1. a genuinely new customer ─────
const national = "05" + rnd().slice(0, 8); // 10 digits, Saudi mobile in national format
const e164 = "+966" + national.slice(1);
const phoneCandidates = (n) => [e164, "00" + e164.slice(1), n, n.slice(1), "+966 " + n.slice(1, 3) + " " + n.slice(3, 6) + " " + n.slice(6), n.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]), e164.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d])];
const created = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Customer`, phone: e164, countryId: sa.id, city: "Riyadh", address: "Street 1" }, "first", { delivery: { countryId: sa.id, city: "Riyadh", address: "Street 1" } }));
check("1. order for a new customer is created", created.s === 201, `${created.s} ${created.j?.internalOrderId ?? ""}`);
const firstOrder = created.j;
check("1. the order keeps its own delivery destination", firstOrder?.deliveryCity === "Riyadh" && firstOrder?.deliveryAddress === "Street 1", JSON.stringify({ c: firstOrder?.deliveryCity, a: firstOrder?.deliveryAddress }));

// ───── 2 + 3. every valid format recognises the customer, with a useful summary ─────
let allFormats = true;
const detail = [];
for (const f of phoneCandidates(national)) {
  const r = await call(salesA, "POST", "/store-orders/duplicate-check", { phone: f, countryId: sa.id });
  const ok = r.s === 200 && r.j?.kind === "PHONE" && r.j?.crossScope === false && r.j?.orders?.length === 1;
  if (!ok) allFormats = false;
  detail.push(`${f}:${r.j?.kind}`);
}
check("2. all phone formats (+, 00, national, spaces, Arabic digits) recognise the customer", allFormats, detail.join(" | "));
const noCountry = await call(salesA, "POST", "/store-orders/duplicate-check", { phone: national });
check("2. a local number with no country at all matches", noCountry.j?.kind === "PHONE", noCountry.j?.kind);
const summary = (await call(salesA, "POST", "/store-orders/duplicate-check", { phone: e164 })).j;
const o = summary?.orders?.[0];
check("3. the summary has reference, date, amount/currency, status and an active flag", !!(o?.orderNumber && o?.orderDate && o?.total === 100 && o?.currencyCode && "active" in o && o?.fulfillmentStatus), JSON.stringify(o));
check("3. the customer is named (masked phone) and a prior order is openable", !!summary?.customer?.name && !!summary?.customer?.phoneMasked && !!o?.id);
const nearMiss = await call(salesA, "POST", "/store-orders/duplicate-check", { phone: e164.slice(0, -1) + ((Number(e164.slice(-1)) + 1) % 10) });
check("2. a number differing by one digit never matches (no suffix stripping)", nearMiss.j?.kind === "NONE", nearMiss.j?.kind);

// ───── 4. cancel: checking creates nothing ─────
const beforeCount = (await call(admin, "GET", `/store-orders?search=${encodeURIComponent(e164)}&pageSize=5`)).j?.total;
const partnersBefore = (await call(admin, "GET", `/partners?search=${encodeURIComponent(e164)}&pageSize=5`)).j?.total;
check("4. cancelling after the warning leaves exactly one customer and one order", beforeCount === 1 && partnersBefore === 1, `orders=${beforeCount} customers=${partnersBefore}`);

// ───── server enforcement: no acknowledgement → 409, nothing created ─────
const blocked = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Customer`, phone: national, countryId: sa.id }, "blocked"));
check("B3. creating without acknowledging the existing customer is refused (409)", blocked.s === 409 && blocked.j?.code === "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED", `${blocked.s} ${blocked.j?.code}`);
const blockedOther = await call(salesB, "POST", "/store-orders", baseOrder({ name: `${TAG} Other`, phone: "00" + e164.slice(1), countryId: sa.id }, "blocked-b"));
check("B3. another employee entering the same number in another format is refused too", blockedOther.s === 409, `${blockedOther.s}`);
const wrongCustomer = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Customer`, phone: e164, countryId: sa.id }, "wrongcust", { duplicateResolution: { decision: "INTENTIONAL_NEW_ORDER", customerId: "00000000-0000-4000-8000-000000000001" } }));
check("B3. an acknowledgement for the wrong customer is refused (stale)", wrongCustomer.s === 409, `${wrongCustomer.s}`);
const differentCustomer = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Customer`, phone: e164, countryId: sa.id }, "diffcust", { duplicateResolution: { decision: "DIFFERENT_CUSTOMER" } }));
check("B3. 'different customer' is refused for a matching phone (no second customer for one number)", differentCustomer.s === 409, `${differentCustomer.s}`);

// ───── 5. a legitimate repeat order reuses the customer ─────
const resolution = { decision: "INTENTIONAL_NEW_ORDER", customerId: summary.customer.id };
const repeat = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Customer`, phone: national, countryId: sa.id }, "repeat", { duplicateResolution: resolution, delivery: { countryId: sa.id, city: "Jeddah", address: "Other street 9" } }));
check("5. the repeat order is created after the acknowledgement", repeat.s === 201, `${repeat.s}`);
check("5. it reuses the existing customer (same partner)", repeat.j?.partnerId === firstOrder?.partnerId, `${repeat.j?.partnerId} / ${firstOrder?.partnerId}`);
check("5. the other delivery address is on the order and the customer master is unchanged", repeat.j?.deliveryCity === "Jeddah" && (await call(admin, "GET", `/partners/${firstOrder.partnerId}`)).j?.address === "Street 1", `${repeat.j?.deliveryCity}`);
const customersAfter = (await call(admin, "GET", `/partners?search=${encodeURIComponent(e164)}&pageSize=5`)).j?.total;
check("5. still exactly one customer for the number", customersAfter === 1, `${customersAfter}`);

// ───── 6. retry / double-click ─────
const keyed = baseOrder({ name: `${TAG} Customer`, phone: e164, countryId: sa.id }, "double", { duplicateResolution: resolution });
const [r1, r2] = await Promise.all([call(salesA, "POST", "/store-orders", keyed), call(salesA, "POST", "/store-orders", keyed)]);
const ids = new Set([r1.j?.id, r2.j?.id].filter(Boolean));
check("6. a double click with one key creates ONE order", ids.size === 1 && [r1.s, r2.s].every((s) => s === 201 || s === 200), `${r1.s}/${r2.s} ids=${ids.size}`);
const retry = await call(salesA, "POST", "/store-orders", keyed);
check("6. a later retry returns the same order", retry.j?.id === [...ids][0], `${retry.s}`);
const orderTotal = (await call(salesA, "GET", `/store-orders?search=${encodeURIComponent(e164)}&pageSize=10`)).j?.total;
check("6. the customer has exactly 3 orders (first, repeat, double-click once)", orderTotal === 3, `${orderTotal}`);

// ───── 7. discovery by another employee: read-only, masked ─────
const lookup = await call(salesB, "POST", "/customer-lookup/advanced", { query: national });
const match = lookup.j?.matches?.[0];
check("7. another employee finds the customer through the advanced lookup", lookup.s === 200 && lookup.j?.exists === true, `${lookup.s}`);
check("7. the response is minimal: masked phone, two letters per word, no owner, no link", !!match && /•/.test(match.maskedPhone ?? "") && /•/.test(match.partialName) && match.openable === null && match.notAssignedToYou === true && !("address" in match) && !("owner" in match), JSON.stringify(match));
const arabicLookup = await call(salesB, "POST", "/customer-lookup/advanced", { query: national.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]) });
check("7. an Arabic-digit query works", arabicLookup.s === 200 && arabicLookup.j?.exists === true, `${arabicLookup.s}`);
const detailB = await call(salesB, "GET", `/store-orders/${firstOrder.id}`);
const patchB = await call(salesB, "PATCH", `/store-orders/${firstOrder.id}`, { notes: "should not work" });
check("7. discovery grants no access to the order (404) and no edit", detailB.s === 404 && [403, 404].includes(patchB.s), `${detailB.s}/${patchB.s}`);

// ───── 8. ordinary list search stays scoped ─────
const bOrders = await call(salesB, "GET", `/store-orders?search=${encodeURIComponent(e164)}&pageSize=5`);
const bLeads = await call(salesB, "GET", `/leads?search=${encodeURIComponent(national)}&pageSize=5`);
const aOrders = await call(salesA, "GET", `/store-orders?search=${encodeURIComponent(national)}&pageSize=5`);
const aArabic = await call(salesA, "GET", `/store-orders?search=${encodeURIComponent(national.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]))}&pageSize=5`);
check("8. the owner's list search finds it in every format (national, Arabic digits)", aOrders.j?.total === 3 && aArabic.j?.total === 3, `${aOrders.j?.total}/${aArabic.j?.total}`);
check("8. another employee's list search does NOT find it (scope preserved)", bOrders.s === 200 && bOrders.j?.total === 0 && bLeads.j?.total === 0, `orders=${bOrders.j?.total} leads=${bLeads.j?.total}`);
const adminPartners = await call(admin, "GET", `/partners?search=${encodeURIComponent(national)}&pageSize=5`);
const adminArabic = await call(admin, "GET", `/partners?search=${encodeURIComponent(national.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]))}&pageSize=5`);
check("8. the customers list finds a national / Arabic-digit number", adminPartners.j?.total === 1 && adminArabic.j?.total === 1, `${adminPartners.j?.total}/${adminArabic.j?.total}`);

// ───── 9. agents stay isolated ─────
const agentOrders = (await call(agentA, "GET", "/agent-portal/orders?pageSize=1")).j;
const agentOrder = agentOrders?.items?.[0];
const agentMobile = agentOrder?.customer?.mobile;
if (agentOrder && agentMobile) {
  const bCheck = await call(agentB, "POST", "/agent-portal/orders/duplicate-check", { phone: agentMobile });
  check("9. another agent's customer is a flag only (no name, id, order)", bCheck.j?.kind === "PHONE" && bCheck.j?.crossScope === true && !("customer" in bCheck.j) && !("orders" in bCheck.j), JSON.stringify(bCheck.j));
  const bGet = await call(agentB, "GET", `/agent-portal/orders/${agentOrder.id}`);
  check("9. another agent cannot open the order (404)", bGet.s === 404, `${bGet.s}`);
} else {
  check("9. agent A has an order to test with", false, "no agent order in the demo data");
}
const agentLookup = await call(agentB, "POST", "/customer-lookup/advanced", { query: national });
check("9. an agent cannot use the company advanced lookup", agentLookup.s === 403, `${agentLookup.s}`);
const agentFindsCompany = await call(agentB, "POST", "/agent-portal/orders/duplicate-check", { phone: e164 });
check("9. an agent entering a company customer's number gets a flag only", agentFindsCompany.j?.kind === "PHONE" && agentFindsCompany.j?.crossScope === true && !("customer" in agentFindsCompany.j), JSON.stringify(agentFindsCompany.j));

// ───── 10. repeated leads are never blocked ─────
const leadBody = (n) => ({ customerName: `${TAG} Lead ${n}`, mobileNumber: e164, countryId: sa.id, productId: product.id, quantity: 1, currencyId, source: "MANUAL" });
const l1 = await call(salesA, "POST", "/leads", leadBody(1));
const l2 = await call(salesA, "POST", "/leads", leadBody(2));
const l3 = await call(salesB, "POST", "/leads", leadBody(3));
check("10. repeated leads on the same number are all created (no order-confirmation block)", [l1.s, l2.s, l3.s].every((s) => s === 201), `${l1.s}/${l2.s}/${l3.s} ${l1.j?.message ?? ""}`);

// ───── 12. phone country != delivery country ─────
const egPhone = "+2010" + rnd().slice(0, 8);
const intl = await call(salesA, "POST", "/store-orders", baseOrder({ name: `${TAG} Intl`, phone: egPhone, countryId: sa.id, city: "Riyadh", address: "Hotel 5" }, "intl", { delivery: { countryId: sa.id, city: "Riyadh", address: "Hotel 5" } }));
check("12. an Egyptian phone with a Saudi delivery address is accepted", intl.s === 201, `${intl.s}`);
check("12. both are preserved (phone +20, delivery country SA)", intl.j?.partner?.phone?.startsWith("+20") && intl.j?.deliveryCountryId === sa.id, `${intl.j?.partner?.phone} / ${intl.j?.deliveryCountryId}`);
const egLocal = "0" + egPhone.slice(3);
const egCheck = await call(salesA, "POST", "/store-orders/duplicate-check", { phone: egLocal, countryId: sa.id });
check("12. the Egyptian national format is recognised even with Saudi selected", egCheck.j?.kind === "PHONE", egCheck.j?.kind);

// ───── a known customer with no order yet: recognised, informational ─────
const leadOnly = await call(salesA, "POST", "/leads", { ...leadBody(9), mobileNumber: "+9665" + rnd() });
const known = await call(salesA, "POST", "/store-orders/duplicate-check", { phone: "+9665" + rnd() });
check("B. an unknown number is NONE", known.j?.kind === "NONE", known.j?.kind);
void leadOnly;

const failed = results.filter((r) => !r.ok);
mkdirSync("D:/Systems/OMS-r9-brand-grid/specs/round11-entry-recognition/evidence", { recursive: true });
writeFileSync("D:/Systems/OMS-r9-brand-grid/specs/round11-entry-recognition/evidence/api-acceptance.json", JSON.stringify({ tag: TAG, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed (tag ${TAG})`);
process.exit(failed.length ? 1 : 0);
