#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R14 — API-level acceptance journeys against a LOCAL integrated build.
 *
 *   A Sessions          — 12 h absolute lifetime (rememberMe ignored), logout revokes, inactive user refused
 *   B Shipping carrier  — shipping.assign_carrier on store-order + legacy sales-order routes
 *   C Job titles        — template → inherited, DENY beats it, anti-escalation, audit, restore
 *   D Stock / cost      — ship → RESERVED, deliver → invoice + SALES_DELIVERY + COGS JE, idempotent,
 *                         traceability, missing cost → FAILED (delivery kept), repair dry run
 *   E Customers         — full-disclosure advanced lookup, scoped history, financial section gate
 *   F Company partners  — accounts, profile, agreement, preview / review / close, payments, statement
 *
 *   MSYS_NO_PATHCONV=1 API=http://localhost:3005 node scripts/acceptance/r14/r14-journeys.mjs
 *   ONLY=A,B  runs only those sections (C/D/E/F depend only on the shared setup, not on each other,
 *   except E which uses the orders created for B/D).
 *
 * Personas r14-*@oms.local; password read at runtime from tmp/r14/.r14.env (R14_PW) — never printed
 * or written. SQL (docker exec oms-postgres psql, DB oms_r14_e2e) is used for setup and read-only
 * assertions only. Evidence: specs/round14-production-readiness/evidence/journeys.json (no tokens).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ROOT = "D:/Systems/OMS";
const API = (process.env.API ?? "http://localhost:3005").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("local API only");
const DB = process.env.DB ?? "oms_r14_e2e";
const OUT = `${ROOT}/specs/round14-production-readiness/evidence`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(`${ROOT}/tmp/r14/.r14.env`, "utf8").match(/R14_PW=(.*)/)?.[1]?.trim();
if (!PW) throw new Error("R14_PW missing in tmp/r14/.r14.env");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map((s) => s.trim().toUpperCase()) : null;
const TAG = "R14J" + Date.now().toString().slice(-6);
const START = new Date().toISOString();

// ───────── reporting ─────────
const results = [];
const context = { tag: TAG, api: API, db: DB, startedAt: START };
let section = "-";
const check = (name, ok, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ section, name, ok: !!ok, detail: d.slice(0, 600) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${section}] ${name}${d ? "  -> " + d.slice(0, 300) : ""}`);
};
async function run(key, title, fn) {
  if (ONLY && !ONLY.includes(key)) return;
  section = key;
  console.log(`\n=== ${key} ${title} ===`);
  try {
    await fn();
  } catch (error) {
    check(`${title}: section completed without an exception`, false, error?.stack ?? String(error));
  }
}

// ───────── SQL (setup + read-only assertions) ─────────
const psql = (sql) =>
  execFileSync("docker", ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
  }).trim();
const rows = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`) || "[]");
const one = (sql) => rows(sql)[0] ?? null;
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// ───────── HTTP ─────────
async function call(token, method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json", "User-Agent": "r14-journeys" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  const text = await r.text();
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  return { s: r.status, j };
}
async function loginRaw(email, extra = {}) {
  return call(null, "POST", "/auth/login", { email, password: PW, ...extra });
}
async function login(email, extra = {}) {
  const r = await loginRaw(email, extra);
  if (!r.j?.accessToken) throw new Error(`login ${email} failed: ${r.s} ${JSON.stringify(r.j)?.slice(0, 200)}`);
  return r.j.accessToken;
}
const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errCode = (j) => j?.code ?? j?.message?.code ?? j?.response?.code ?? null;
const brief = (r) => `${r.s} ${JSON.stringify(r.j)?.slice(0, 220)}`;
const refused = (s) => s === 401 || s === 403 || s === 404;
const num = (v) => Number(v ?? 0);
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.005;

// ───────── personas ─────────
const EMAIL = (k) => `r14-${k}@oms.local`;
const ids = Object.fromEntries(rows(`select email, id from users where email like 'r14-%@oms.local' and deleted_at is null`).map((r) => [r.email, r.id]));
const uid = (k) => ids[EMAIL(k)];
for (const k of ["admin", "sales", "sales2", "shipping", "finance", "agent"]) if (!uid(k)) throw new Error(`persona ${k} missing`);
const T = {};
for (const k of ["admin", "sales", "sales2", "shipping", "finance", "agent"]) T[k] = await login(EMAIL(k));
const permsOf = async (token) => (await call(token, "GET", "/auth/me")).j?.permissions ?? [];

// ───────── shared fixtures ─────────
const settings = one(`select * from posting_settings limit 1`);
const currencyId = settings.functional_currency_id;
const eg = one(`select id from countries where code = 'EG' limit 1`);
const defaultWh = one(`select id from warehouses where is_active and deleted_at is null order by is_default desc, name asc, created_at asc limit 1`);
const stockSql = (extraWhere) => `
  select p.id, p.sku, p.name, p.current_cost, coalesce(p.preferred_warehouse_id, ${lit(defaultWh.id)}::uuid) as wh,
    coalesce((select sum(m.quantity) from inventory_movements m where m.product_id = p.id
       and m.warehouse_id = coalesce(p.preferred_warehouse_id, ${lit(defaultWh.id)}::uuid)
       and m.type not in ('RESERVATION','RESERVATION_RELEASE')), 0) as on_hand
  from products p
  where p.deleted_at is null and p.status = 'ACTIVE' and p.owner_agent_id is null and p.is_sellable
    and p.is_inventory_item and p.supply_method = 'PURCHASED' and ${extraWhere}
  order by on_hand desc, p.sku limit 1`;
const stocked = one(stockSql(`p.current_cost > 0`));
const noCost = one(stockSql(`p.current_cost is null`));
const service = one(`select id, sku from products where deleted_at is null and status = 'ACTIVE' and owner_agent_id is null
  and is_sellable and item_type = 'SERVICE' and not is_inventory_item order by sku limit 1`);
const kit = one(`select p.id, p.sku from products p where p.deleted_at is null and p.status = 'ACTIVE' and p.supply_method = 'KIT'
  and p.owner_agent_id is null and exists (select 1 from product_recipes r where r.product_id = p.id) limit 1`);
context.products = { stocked: stocked?.sku, noCost: noCost?.sku, service: service?.sku, kit: kit?.sku ?? null };

const QTY = 2;
const phoneDigits = String(10000000 + Math.floor(Math.random() * 89999999));
const customerPhone = `+2010${phoneDigits}`; // EG mobile, E.164
context.customerPhoneSuffix = customerPhone.slice(-4);
const shippingCompany = one(`select id from shipping_companies where deleted_at is null order by created_at limit 1`);
const order = {}; // main, noCost, other

async function createOrder(token, items, opts = {}) {
  return call(token, "POST", "/store-orders", {
    partner: { name: `${TAG} عميل اختبار`, phone: customerPhone, countryId: eg?.id, city: "Cairo", address: "R14 street 1" },
    source: "MANUAL",
    currencyId,
    paymentType: "CASH_ON_DELIVERY",
    items,
    delivery: { countryId: eg?.id, city: "Cairo", address: "R14 street 1" },
    creationIdempotencyKey: `${TAG}-${opts.key}`,
    ...(opts.duplicateResolution ? { duplicateResolution: opts.duplicateResolution } : {}),
  });
}

async function ensureStock(product, needed) {
  if (num(product.on_hand) >= needed) return true;
  const r = await call(T.admin, "POST", "/inventory/opening-balance", {
    productId: product.id,
    warehouseId: product.wh,
    quantity: needed - num(product.on_hand) + 5,
    unitCost: product.current_cost == null ? undefined : num(product.current_cost),
    notes: `${TAG} stock for acceptance`,
  });
  check(`setup: opening stock added for ${product.sku}`, r.s === 201 || r.s === 200, brief(r));
  return r.s < 300;
}

// ═════════════════════════ A Sessions ═════════════════════════
await run("A", "Sessions", async () => {
  const t = await login(EMAIL("sales2"), { rememberMe: true });
  const p = decode(t);
  check("token carries a server session id (sid)", typeof p.sid === "string" && p.sid.length > 0, `sid=${!!p.sid}`);
  check("token lifetime exp-iat = 12 h even with rememberMe:true", p.exp - p.iat === 12 * 3600, `${p.exp - p.iat}s`);
  const sess = one(`select expires_at, created_at, user_agent_hash from user_sessions where id = ${lit(p.sid)}`);
  check("user_sessions row exists, expires 12 h after creation, UA hashed",
    sess && Math.abs((new Date(sess.expires_at) - new Date(sess.created_at)) / 1000 - 12 * 3600) < 5 && /^[0-9a-f]{64}$/.test(sess.user_agent_hash ?? ""),
    sess ? `${sess.created_at} → ${sess.expires_at}` : "no row");
  const me = await call(t, "GET", "/auth/me");
  check("login → GET /auth/me 200", me.s === 200 && me.j?.email === EMAIL("sales2"), `${me.s}`);
  const lo = await call(t, "POST", "/auth/logout");
  check("POST /auth/logout 200", lo.s === 200 || lo.s === 201, brief(lo));
  const after = await call(t, "GET", "/auth/me");
  check("the same token after logout → 401", after.s === 401, brief(after));
  const rev = one(`select revoked_reason from user_sessions where id = ${lit(p.sid)}`);
  check("session revoked with reason LOGOUT", rev?.revoked_reason === "LOGOUT", rev?.revoked_reason);
  const other = await call(T.sales2, "GET", "/auth/me");
  check("another session of the same user is unaffected by that logout", other.s === 200, `${other.s}`);

  // Deactivated user: a throwaway copy of r14-sales2 (same password hash), deactivated then restored.
  const tmpEmail = `r14-tmp-${TAG.toLowerCase()}@oms.local`;
  const tmpId = randomUUID();
  psql(`insert into users (id, email, username, full_name, password_hash, is_super_admin, updated_at)
        select ${lit(tmpId)}, ${lit(tmpEmail)}, ${lit("r14-tmp-" + TAG.toLowerCase())}, 'R14 throwaway', password_hash, false, now()
        from users where email = ${lit(EMAIL("sales2"))}`);
  context.throwawayUser = tmpEmail;
  try {
    const tt = await login(tmpEmail);
    const ok1 = await call(tt, "GET", "/auth/me");
    check("throwaway persona: /auth/me 200 while active", ok1.s === 200, `${ok1.s}`);
    psql(`update users set is_active = false where id = ${lit(tmpId)}`);
    let s = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      s = (await call(tt, "GET", "/auth/me")).s;
      if (s === 401) break;
      await sleep(1000);
    }
    check("deactivated user's live token → 401 (≤ 15 s session cache)", s === 401, `${s} after ${Math.round((Date.now() - t0) / 1000)}s`);
    const relog = await loginRaw(tmpEmail);
    check("deactivated user cannot sign in", relog.s === 401 || relog.s === 403, `${relog.s}`);
  } finally {
    psql(`update users set is_active = true, deleted_at = now() where id = ${lit(tmpId)}`);
  }
  check("throwaway persona restored (is_active=true) and retired (deleted_at set)",
    one(`select is_active from users where id = ${lit(tmpId)}`)?.is_active === true, "");
});

// ═════════════════════════ shared order setup (B, D, E) ═════════════════════════
let setupDone = false;
async function setupOrders() {
  if (setupDone) return;
  setupDone = true;
  check("setup: a stocked company product with cost exists", !!stocked, stocked ? `${stocked.sku} cost=${stocked.current_cost} on_hand=${stocked.on_hand}` : "none");
  check("setup: a service product exists", !!service, service?.sku ?? "none");
  if (!stocked || !service) throw new Error("no fixture products");
  await ensureStock(stocked, QTY + 1);
  const r1 = await createOrder(T.sales, [
    { productId: stocked.id, quantity: QTY, unitPrice: 150 },
    { productId: service.id, quantity: 1, unitPrice: 40 },
  ], { key: "main" });
  check("setup: r14-sales creates a COD company store order (stocked ×2 + service)", r1.s === 201, brief(r1));
  order.main = r1.j;
  if (!order.main?.id) throw new Error("order not created");
  context.partnerId = order.main.partnerId;
  // Make sure it is in r14-sales's own scope.
  const emp = one(`select employee_id from store_orders where id = ${lit(order.main.id)}`);
  if (emp?.employee_id !== uid("sales")) psql(`update store_orders set employee_id = ${lit(uid("sales"))} where id = ${lit(order.main.id)}`);
  check("setup: the order is assigned to r14-sales", one(`select employee_id from store_orders where id = ${lit(order.main.id)}`)?.employee_id === uid("sales"), emp?.employee_id === uid("sales") ? "by creation" : "set via SQL");

  if (noCost) {
    await ensureStock(noCost, 2);
    const r2 = await createOrder(T.sales, [{ productId: noCost.id, quantity: 1, unitPrice: 90 }], {
      key: "nocost",
      duplicateResolution: { decision: "INTENTIONAL_NEW_ORDER", customerId: order.main.partnerId },
    });
    check("setup: second order of the same customer (missing-cost product), INTENTIONAL_NEW_ORDER", r2.s === 201 && r2.j?.partnerId === order.main.partnerId, brief(r2));
    order.noCost = r2.j;
    if (order.noCost?.id) psql(`update store_orders set employee_id = ${lit(uid("sales"))} where id = ${lit(order.noCost.id)}`);
  }
  // A third order of the same customer that belongs to ANOTHER employee (r14-sales2) — for the history scope.
  const r3 = await createOrder(T.sales, [{ productId: service.id, quantity: 1, unitPrice: 25 }], {
    key: "other",
    duplicateResolution: { decision: "INTENTIONAL_NEW_ORDER", customerId: order.main.partnerId },
  });
  check("setup: third order of the same customer, re-assigned to r14-sales2 via SQL", r3.s === 201, brief(r3));
  order.other = r3.j;
  if (order.other?.id) psql(`update store_orders set employee_id = ${lit(uid("sales2"))} where id = ${lit(order.other.id)}`);
  context.orders = Object.fromEntries(Object.entries(order).map(([k, v]) => [k, v?.internalOrderId ?? null]));
}

// ═════════════════════════ B Shipping carrier / tracking ═════════════════════════
await run("B", "Shipping carrier authorization", async () => {
  await setupOrders();
  const id = order.main.id;
  const shipState = () => one(`select count(*)::int as n, max(shipping_company_id::text) as company, max(tracking_number) as tracking
                               from shipments where store_order_id = ${lit(id)} and deleted_at is null`);
  const before = shipState();
  check("r14-sales can open its own order", (await call(T.sales, "GET", `/store-orders/${id}`)).s === 200, "");
  const sc = await call(T.sales, "POST", `/store-orders/${id}/shipments/shipping-company`, { shippingCompanyId: shippingCompany.id });
  check("r14-sales (store-orders.edit, no assign_carrier) → store-order shipping-company 403", sc.s === 403, brief(sc));
  const tn = await call(T.sales, "POST", `/store-orders/${id}/shipments/tracking-number`, { trackingNumber: `${TAG}-SALES` });
  check("r14-sales → store-order tracking-number 403", tn.s === 403, brief(tn));
  const mid = shipState();
  // A COD order enters the shipping queue at creation (handoff shipment #1, no carrier / tracking yet).
  check("DB unchanged after the refused calls (no carrier, no tracking)", JSON.stringify(before) === JSON.stringify(mid) && !mid.company && !mid.tracking, JSON.stringify(mid));

  // Legacy B2B sales-order routes.
  const legacy = one(`select id from sales_orders where deleted_at is null order by created_at desc limit 1`);
  const legacyId = legacy?.id ?? randomUUID();
  const lsBefore = legacy ? JSON.stringify(rows(`select shipping_company_id, tracking_number from shipments where sales_order_id = ${lit(legacyId)}`)) : null;
  const l1 = await call(T.sales, "POST", `/sales-orders/${legacyId}/shipping-company`, { shippingCompanyId: shippingCompany.id });
  check(`r14-sales → legacy /sales-orders/:id/shipping-company 403${legacy ? "" : " (no legacy order in DB — random id, guard runs first)"}`, l1.s === 403, brief(l1));
  const l2 = await call(T.sales, "POST", `/sales-orders/${legacyId}/tracking-number`, { trackingNumber: `${TAG}-L` });
  check(`r14-sales → legacy /sales-orders/:id/tracking-number 403${legacy ? "" : " (random id)"}`, l2.s === 403, brief(l2));
  if (legacy) {
    check("legacy sales order shipment data unchanged", JSON.stringify(rows(`select shipping_company_id, tracking_number from shipments where sales_order_id = ${lit(legacyId)}`)) === lsBefore, "");
  } else {
    const l3 = await call(T.shipping, "POST", `/sales-orders/${legacyId}/tracking-number`, { trackingNumber: `${TAG}-L` });
    check("r14-shipping passes the legacy guard (reaches the service → 404 for the random id, not 403)", l3.s !== 403 && l3.s !== 401, brief(l3));
  }

  // Agent boundary.
  const ag = await call(T.agent, "POST", `/store-orders/${id}/shipments/shipping-company`, { shippingCompanyId: shippingCompany.id });
  check("r14-agent → company order shipping-company refused", refused(ag.s), brief(ag));
  const ag2 = await call(T.agent, "POST", `/store-orders/${id}/shipments/tracking-number`, { trackingNumber: `${TAG}-AG` });
  check("r14-agent → company order tracking-number refused", refused(ag2.s), brief(ag2));
  check("DB still unchanged after agent attempts", JSON.stringify(shipState()) === JSON.stringify(before), JSON.stringify(shipState()));

  // Shipping persona succeeds.
  const ok1 = await call(T.shipping, "POST", `/store-orders/${id}/shipments/shipping-company`, { shippingCompanyId: shippingCompany.id });
  check("r14-shipping → shipping-company 200", ok1.s === 200, brief(ok1));
  const ok2 = await call(T.shipping, "POST", `/store-orders/${id}/shipments/tracking-number`, { trackingNumber: `${TAG}-TRK` });
  check("r14-shipping → tracking-number 200", ok2.s === 200, brief(ok2));
  const after = shipState();
  check("DB shows the shipping persona's carrier + tracking", after.company === shippingCompany.id && after.tracking === `${TAG}-TRK`, JSON.stringify(after));
});

// ═════════════════════════ C Job-title templates ═════════════════════════
await run("C", "Job-title permission templates", async () => {
  const PERM = "customers.lookup_advanced";
  const s2 = uid("sales2");
  const original = (await call(T.admin, "GET", `/users/${s2}/permission-overrides`)).j;
  const salesOriginal = (await call(T.admin, "GET", `/users/${uid("sales")}/permission-overrides`)).j;
  check("admin reads r14-sales2's permission panel", Array.isArray(original?.grants), JSON.stringify(original)?.slice(0, 200));
  check(`r14-sales2 does not hold ${PERM} before`, !(await permsOf(T.sales2)).includes(PERM), "");
  const origTitle = one(`select job_title_id from users where id = ${lit(s2)}`)?.job_title_id ?? null;
  const jt = await call(T.admin, "POST", "/job-titles", { name: `${TAG} قالب صلاحيات`, nameEn: `${TAG} template` });
  check("admin creates a job title", jt.s === 201, brief(jt));
  const jtId = jt.j?.id;
  context.jobTitle = jt.j?.name;
  try {
    const pv = await call(T.admin, "POST", `/job-titles/${jtId}/permissions/preview`, { permissionNames: [PERM] });
    check("template impact preview lists the added permission (writes nothing)", pv.s === 200 && pv.j?.added?.includes(PERM) && one(`select count(*)::int n from job_title_permissions where job_title_id = ${lit(jtId)}`).n === 0, brief(pv));
    const sv = await call(T.admin, "PUT", `/job-titles/${jtId}/permissions`, { permissionNames: [PERM] });
    check("template saved", sv.s === 200 && sv.j?.permissions?.some?.((p) => (p.name ?? p) === PERM), brief(sv));

    const as = await call(T.admin, "PATCH", `/users/${s2}`, { jobTitleId: jtId });
    check("title assigned to r14-sales2", as.s === 200 && as.j?.jobTitleId === jtId, brief(as));
    check("review flag set after the title change", one(`select permissions_review_required r from users where id = ${lit(s2)}`).r === true, "");
    check(`/auth/me of r14-sales2 now includes ${PERM}`, (await permsOf(T.sales2)).includes(PERM), "");
    const panel = (await call(T.admin, "GET", `/users/${s2}/permission-overrides`)).j;
    check("panel: source = inherited (template), not an individual grant", panel?.inherited?.includes(PERM) && !panel?.grants?.includes(PERM) && panel?.effective?.includes(PERM), JSON.stringify({ inherited: panel?.inherited, grants: panel?.grants }));
    const lk = await call(T.sales2, "POST", "/customer-lookup/advanced", { query: "+201000000000" });
    check("inherited permission is enforced by the API (lookup no longer 403)", lk.s !== 403, `${lk.s}`);

    const dn = await call(T.admin, "PUT", `/users/${s2}/permission-overrides`, { grants: original.grants, denies: [PERM] });
    check("individual DENY saved", dn.s === 200 && dn.j?.denies?.includes(PERM), brief(dn));
    check(`DENY beats the inherited grant (/auth/me excludes ${PERM})`, !(await permsOf(T.sales2)).includes(PERM), "");
    const lk2 = await call(T.sales2, "POST", "/customer-lookup/advanced", { query: "+201000000000" });
    check("…and the API refuses the lookup again (403)", lk2.s === 403, `${lk2.s}`);
    const rm = await call(T.admin, "PUT", `/users/${s2}/permission-overrides`, { grants: original.grants, denies: [] });
    check("DENY removed → inherited again", rm.s === 200 && (await permsOf(T.sales2)).includes(PERM), brief(rm));
    check("saving the panel cleared the review flag", one(`select permissions_review_required r from users where id = ${lit(s2)}`).r === false, "");

    // Escalation.
    const gm = await call(T.admin, "PUT", `/users/${s2}/permission-overrides`, { grants: [...original.grants, "users.manage_permissions"], denies: [] });
    check("admin grants users.manage_permissions to r14-sales2 individually", gm.s === 200 && gm.j?.grants?.includes("users.manage_permissions"), brief(gm));
    const salesBefore = JSON.stringify(rows(`select permission_id, effect from user_permissions where user_id = ${lit(uid("sales"))} order by permission_id`));
    const esc = await call(T.sales2, "PUT", `/users/${uid("sales")}/permission-overrides`, { grants: [...salesOriginal.grants, "shipping.edit"], denies: [] });
    check("r14-sales2 granting shipping.edit (not held) to r14-sales → 403 PERMISSION_ESCALATION", esc.s === 403 && errCode(esc.j) === "PERMISSION_ESCALATION", brief(esc));
    check("r14-sales's rows unchanged", JSON.stringify(rows(`select permission_id, effect from user_permissions where user_id = ${lit(uid("sales"))} order by permission_id`)) === salesBefore, "");
    const legacyEsc = await call(T.sales2, "POST", `/users/${uid("sales")}/permissions`, { permissionNames: [...salesOriginal.grants, "shipping.edit"] });
    check("legacy full-list save by r14-sales2 (adds shipping.edit) → 403 PERMISSION_ESCALATION", legacyEsc.s === 403 && errCode(legacyEsc.j) === "PERMISSION_ESCALATION", brief(legacyEsc));
    const self = await call(T.sales2, "PUT", `/users/${s2}/permission-overrides`, { grants: [...original.grants, "users.manage_permissions", "shipping.edit"], denies: [] });
    check("self-edit → 403 PERMISSION_ESCALATION", self.s === 403 && errCode(self.j) === "PERMISSION_ESCALATION", brief(self));

    const audit = rows(`select type, entity_type from master_data_activity_logs where created_at >= ${lit(START)}::timestamptz - interval '5 minutes'
                        and entity_id in (${lit(s2)}, ${lit(jtId)}) and type in ('USER_PERMISSIONS','JOB_TITLE_PERMISSIONS','USER_JOB_TITLE')`);
    const types = new Set(audit.map((a) => a.type));
    check("audit rows: JOB_TITLE_PERMISSIONS, USER_JOB_TITLE, USER_PERMISSIONS", types.has("JOB_TITLE_PERMISSIONS") && types.has("USER_JOB_TITLE") && types.has("USER_PERMISSIONS"), JSON.stringify([...types]));
  } finally {
    // Restore: title back, overrides back (clears the review flag), template emptied, title archived.
    const back = await call(T.admin, "PATCH", `/users/${s2}`, { jobTitleId: origTitle });
    if (back.s !== 200) psql(`update users set job_title_id = ${lit(origTitle)} where id = ${lit(s2)}`);
    await call(T.admin, "PUT", `/users/${s2}/permission-overrides`, { grants: original.grants, denies: original.denies ?? [] });
    if (jtId) {
      await call(T.admin, "PUT", `/job-titles/${jtId}/permissions`, { permissionNames: [] });
      await call(T.admin, "POST", `/job-titles/${jtId}/archive`);
    }
    const now = (await call(T.admin, "GET", `/users/${s2}/permission-overrides`)).j;
    check("state restored (r14-sales2 grants/denies/title as before, no review flag)",
      JSON.stringify([...now.grants].sort()) === JSON.stringify([...original.grants].sort()) && (now.denies ?? []).length === (original.denies ?? []).length &&
        one(`select job_title_id, permissions_review_required r from users where id = ${lit(s2)}`).job_title_id === origTitle && now.permissionsReviewRequired === false,
      JSON.stringify({ grants: now.grants, denies: now.denies, review: now.permissionsReviewRequired }));
  }
});

// ═════════════════════════ D Stock / cost recognition ═════════════════════════
await run("D", "Order → stock → COGS recognition", async () => {
  await setupOrders();
  const id = order.main.id;
  const stock = async (p) => (await call(T.admin, "GET", `/inventory/stock?productId=${p.id}&warehouseId=${p.wh}`)).j;
  const recog = (oid) => one(`select recognition_status, recognition_error from store_orders where id = ${lit(oid)}`);
  const s0 = await stock(stocked);
  check("stock API readable (on-hand before)", typeof s0?.onHand === "number", JSON.stringify(s0));

  const sh = await call(T.shipping, "POST", `/store-orders/${id}/shipments/ship`);
  check("r14-shipping marks the order shipped", sh.s === 200, brief(sh));
  const resv = rows(`select type, quantity, product_id from inventory_movements where reference_type = 'STORE_ORDER' and reference_id = ${lit(id)}`);
  const reserved = resv.filter((m) => m.type === "RESERVATION" && m.product_id === stocked.id).reduce((a, m) => a + num(m.quantity), 0);
  check(`shipped → RESERVATION movement for the stocked line (qty ${QTY})`, reserved === QTY, JSON.stringify(resv));
  check("no reservation for the service line", !resv.some((m) => m.product_id === service.id), "");
  check("recognitionStatus RESERVED after shipping", recog(id)?.recognition_status === "RESERVED", JSON.stringify(recog(id)));
  const s1 = await stock(stocked);
  check("on-hand unchanged by the reservation; reserved +qty", s1.onHand === s0.onHand && num(s1.reserved) === num(s0.reserved) + QTY, JSON.stringify(s1));

  const costAtDelivery = num(one(`select current_cost from products where id = ${lit(stocked.id)}`).current_cost);
  const dl = await call(T.shipping, "POST", `/store-orders/${id}/shipments/deliver`);
  check("r14-shipping marks the order delivered", dl.s === 200, brief(dl));
  const invs = rows(`select id, invoice_number, status, grand_total from sales_invoices where store_order_id = ${lit(id)} and deleted_at is null and status <> 'CANCELLED'`);
  check("exactly one sales invoice, CONFIRMED", invs.length === 1 && invs[0].status === "CONFIRMED", JSON.stringify(invs));
  const inv = invs[0];
  context.invoice = inv?.invoice_number;
  if (inv) {
    // Product tax (if configured on the product) is added by the invoice, as the pre-R14 generateInvoice did.
    const tot = one(`select subtotal, tax_total, grand_total from sales_invoices where id = ${lit(inv.id)}`);
    check("invoice subtotal = order lines (2×150 + 40 = 340); grand = subtotal + product tax", near(tot.subtotal, 340) && near(tot.grand_total, num(tot.subtotal) + num(tot.tax_total)), JSON.stringify(tot));
    context.invoiceTotals = tot;
    const mv = rows(`select product_id, quantity, warehouse_id from inventory_movements where type = 'SALES_DELIVERY' and idempotency_key like ${lit(`SALES_INVOICE:${inv.id}:%`)}`);
    check(`SALES_DELIVERY movement for the stocked line only (−${QTY} in its warehouse)`,
      mv.length === 1 && mv[0].product_id === stocked.id && num(mv[0].quantity) === -QTY && mv[0].warehouse_id === stocked.wh, JSON.stringify(mv));
    const s2 = await stock(stocked);
    check(`on-hand reduced by ${QTY}; reservation released`, s2.onHand === s0.onHand - QTY && num(s2.reserved) === num(s0.reserved), JSON.stringify({ before: s0, after: s2 }));
    const je = rows(`select e.id, e.entry_number, e.total_debit, e.total_credit from journal_entries e where e.source_type = 'SALES_INVOICE'
                     and e.source_id = ${lit(inv.id)} and e.status = 'POSTED' and e.reversal_of_entry_id is null and e.deleted_at is null`);
    check("one posted SALES_INVOICE journal entry", je.length === 1, JSON.stringify(je));
    if (je[0]) {
      const lines = rows(`select l.debit, l.credit, a.account_type, l.account_id from journal_entry_lines l join chart_of_accounts a on a.id = l.account_id where l.journal_entry_id = ${lit(je[0].id)}`);
      const dr = lines.reduce((a, l) => a + num(l.debit), 0);
      const cr = lines.reduce((a, l) => a + num(l.credit), 0);
      check("journal balanced", near(dr, cr) && dr > 0, `Dr ${dr} / Cr ${cr}`);
      const expectedCogs = Math.round(QTY * costAtDelivery * 100) / 100;
      const cogsDr = lines.filter((l) => l.account_type === "EXPENSE").reduce((a, l) => a + num(l.debit), 0);
      const invCr = lines.filter((l) => l.account_type === "ASSET").reduce((a, l) => a + num(l.credit), 0);
      check(`COGS debit = qty × cost = ${QTY} × ${costAtDelivery} = ${expectedCogs}`, near(cogsDr, expectedCogs), `COGS Dr ${cogsDr}`);
      check("inventory credited by the same amount", near(invCr, expectedCogs), `ASSET Cr ${invCr}`);
      const revCr = lines.filter((l) => l.account_type === "REVENUE" || l.account_type === "INCOME").reduce((a, l) => a + num(l.credit), 0);
      check("revenue credited 340 (Dr AR / Cr revenue)", near(revCr, 340), `revenue Cr ${revCr}`);
      context.salesJournal = je[0].entry_number;
    }
    check("recognitionStatus RECOGNIZED", recog(id)?.recognition_status === "RECOGNIZED", JSON.stringify(recog(id)));

    // Idempotency.
    const again = await call(T.shipping, "POST", `/store-orders/${id}/shipments/deliver`);
    const again2 = await call(T.shipping, "POST", `/store-orders/${id}/shipments/shipping-status`, {
      shippingStatusId: one(`select id from shipping_statuses where code = 'DELIVERED' and deleted_at is null limit 1`)?.id,
    });
    const invs2 = rows(`select id from sales_invoices where store_order_id = ${lit(id)} and deleted_at is null and status <> 'CANCELLED'`);
    const mv2 = rows(`select id from inventory_movements where type = 'SALES_DELIVERY' and idempotency_key like ${lit(`SALES_INVOICE:${inv.id}:%`)}`);
    const je2 = rows(`select id from journal_entries where source_type = 'SALES_INVOICE' and source_id = ${lit(inv.id)} and status = 'POSTED' and reversal_of_entry_id is null`);
    check("repeated delivered calls → no duplicate invoice / movement / journal", invs2.length === 1 && mv2.length === 1 && je2.length === 1,
      `deliver again ${again.s}, status DELIVERED ${again2.s}; invoices ${invs2.length}, movements ${mv2.length}, JEs ${je2.length}`);
    const ri = await call(T.admin, "POST", `/store-orders/${id}/generate-invoice`);
    check("manual retry (generate-invoice) on a recognised order does not duplicate", rows(`select id from sales_invoices where store_order_id = ${lit(id)} and deleted_at is null and status <> 'CANCELLED'`).length === 1, `${ri.s} ${errCode(ri.j) ?? ""}`);

    // Traceability.
    const tr = await call(T.admin, "GET", `/traceability/store_order/${id}`);
    const g = (k) => tr.j?.groups?.find((x) => x.key === k);
    check("traceability: order → invoice (DOCUMENTS)", tr.s === 200 && g("DOCUMENTS")?.items?.some((i) => i.id === inv.id), brief(tr));
    check("traceability: stock movements FOUND (delivery + reservation)", g("STOCK_MOVEMENTS")?.state === "FOUND" && (g("STOCK_MOVEMENTS")?.items?.length ?? 0) >= 2, JSON.stringify(g("STOCK_MOVEMENTS"))?.slice(0, 300));
    check("traceability: journal entries include the SALES_INVOICE JE", g("JOURNAL_ENTRIES")?.items?.some((i) => i.number === context.salesJournal), JSON.stringify(g("JOURNAL_ENTRIES")?.items?.map((i) => i.sourceType ?? i.kind)));
  }
  if (kit) check("kit line: a KIT product with a recipe exists — not exercised by this run", true, kit.sku);
  else check("kit line: no KIT product with a recipe in this DB — skipped (data)", true, "");

  // Missing cost.
  if (order.noCost?.id) {
    const nid = order.noCost.id;
    const sh2 = await call(T.shipping, "POST", `/store-orders/${nid}/shipments/ship`);
    check("missing-cost order shipped", sh2.s === 200, brief(sh2));
    const dl2 = await call(T.shipping, "POST", `/store-orders/${nid}/shipments/deliver`);
    check("missing-cost order: delivery call succeeds (status never lost)", dl2.s === 200, brief(dl2));
    const st = one(`select s.status from shipments s where s.store_order_id = ${lit(nid)} and s.deleted_at is null order by s.created_at desc limit 1`);
    check("shipment saved as DELIVERED", st?.status === "DELIVERED", JSON.stringify(st));
    const r = recog(nid);
    check("recognitionStatus FAILED with code MISSING_COST", r?.recognition_status === "FAILED" && r?.recognition_error?.code === "MISSING_COST", JSON.stringify(r));
    check("no invoice created for the missing-cost order", rows(`select id from sales_invoices where store_order_id = ${lit(nid)} and deleted_at is null and status <> 'CANCELLED'`).length === 0, "");
    const tr2 = await call(T.admin, "GET", `/traceability/store_order/${nid}`);
    const failed = tr2.j?.groups?.filter((x) => x.state === "FAILED") ?? [];
    check("traceability shows a FAILED group with the reason", failed.some((f) => f.reason?.code === "MISSING_COST"), JSON.stringify(failed.map((f) => [f.key, f.reason?.code])));
  } else check("missing-cost scenario: no stocked company product without cost in this DB — skipped (data)", false, "");

  const rp = await call(T.admin, "POST", "/store-orders/recognition-repair", { dryRun: true });
  const list = rp.j?.orders ?? rp.j?.items ?? rp.j?.candidates ?? (Array.isArray(rp.j) ? rp.j : null);
  check("repair dry run (admin) returns a list", rp.s === 200 && Array.isArray(list), `${rp.s} keys=${Object.keys(rp.j ?? {}).join(",")} n=${list?.length}`);
  if (order.noCost?.id && Array.isArray(list)) {
    const hit = list.find((o) => o.storeOrderId === order.noCost.id || o.id === order.noCost.id || o.orderId === order.noCost.id);
    check("dry run lists the missing-cost order with a blocker", !!hit, JSON.stringify(hit)?.slice(0, 300));
  }
  // store-orders.edit implies store-orders.generate_invoice (catalog implication) → dry run allowed; apply = super admin only.
  const rpSales = await call(T.sales, "POST", "/store-orders/recognition-repair", { dryRun: true });
  check("repair dry run allowed to r14-sales (generate_invoice implied by store-orders.edit)", rpSales.s === 200, `${rpSales.s}`);
  const apSales = await call(T.sales, "POST", "/store-orders/recognition-repair", { dryRun: false, orderIds: order.noCost?.id ? [order.noCost.id] : [] });
  check("repair APPLY refused to r14-sales (super admin only)", apSales.s === 403, brief(apSales));
});

// ═════════════════════════ E Customers ═════════════════════════
await run("E", "Customer discovery and history", async () => {
  await setupOrders();
  const lk = await call(T.sales, "POST", "/customer-lookup/advanced", { query: customerPhone });
  const m = lk.j?.matches?.find((x) => x.disclosure?.phone === customerPhone) ?? lk.j?.matches?.[0];
  check("r14-sales advanced lookup by phone → 200, match found", lk.s === 200 && lk.j?.exists === true && !!m, brief(lk));
  check("disclosure: full E.164 phone + full name", m?.disclosure?.phone === customerPhone && (m?.disclosure?.name ?? "").includes(TAG), JSON.stringify({ phone: m?.disclosure?.phone?.slice(-4), name: !!m?.disclosure?.name }));
  check("disclosure: latest order number, date, product summary, coarse status",
    !!m?.disclosure?.latestOrder?.number && /^\d{4}-\d{2}-\d{2}$/.test(m?.disclosure?.latestOrder?.orderDate ?? "") && !!m?.disclosure?.latestOrder?.productSummary && !!m?.disclosure?.latestOrder?.status,
    JSON.stringify(m?.disclosure?.latestOrder));
  check("disclosure: placed-order count (3 orders, none cancelled)", m?.disclosure?.placedOrders === 3, `${m?.disclosure?.placedOrders}`);
  const audit = one(`select outcome_detail from global_lookup_audits where user_id = ${lit(uid("sales"))} order by created_at desc limit 1`);
  check("lookup audited with FULL_DISCLOSURE", audit?.outcome_detail === "FULL_DISCLOSURE", JSON.stringify(audit));
  const l2 = await call(T.sales2, "POST", "/customer-lookup/advanced", { query: customerPhone });
  check("r14-sales2 (no lookup_advanced) → 403", l2.s === 403, `${l2.s}`);
  const la = await call(T.agent, "POST", "/customer-lookup/advanced", { query: customerPhone });
  check("r14-agent → refused", refused(la.s), `${la.s}`);

  const pid = order.main.partnerId;
  const h = await call(T.sales, "GET", `/customers/${pid}/history`);
  const listed = (h.j?.orders ?? []).map((o) => o.id);
  check("history (r14-sales) 200", h.s === 200, brief(h));
  check("history lists the in-scope orders", listed.includes(order.main.id) && (!order.noCost || listed.includes(order.noCost.id)), JSON.stringify(h.j?.orders?.map((o) => o.number)));
  // r14-sales holds shipping.view: by the R7 by-id rule it can open every order that is in the shipping queue
  // (a COD order gets its handoff shipment at creation) — so r14-sales2's order is openable and listed, not counted.
  const otherHasShipment = one(`select count(*)::int n from shipments where store_order_id = ${lit(order.other?.id)}`)?.n > 0;
  check("r14-sales: r14-sales2's order is listed only because shipping.view opens shipping-queue orders (else counted)",
    otherHasShipment ? listed.includes(order.other?.id) && h.j?.otherOrdersCount === 0 : !listed.includes(order.other?.id) && h.j?.otherOrdersCount >= 1,
    `otherHasShipment=${otherHasShipment} otherOrdersCount=${h.j?.otherOrdersCount}`);
  const h2 = await call(T.sales2, "GET", `/customers/${pid}/history`);
  const listed2 = (h2.j?.orders ?? []).map((o) => o.id);
  check("history (r14-sales2, own scope only): lists only its own order, counts the 2 others",
    h2.s === 200 && listed2.length === 1 && listed2[0] === order.other?.id && h2.j?.otherOrdersCount === 2 && !h2.j?.financials,
    `${h2.s} listed=${JSON.stringify(h2.j?.orders?.map((o) => o.number))} other=${h2.j?.otherOrdersCount}`);
  check("history summary placed = 3", h.j?.summary?.placedOrders === 3, JSON.stringify(h.j?.summary));
  check("no financial section for r14-sales", h.j?.financials === null || h.j?.financials === undefined, JSON.stringify(h.j?.financials)?.slice(0, 100));
  const hf = await call(T.finance, "GET", `/customers/${pid}/history`);
  check("r14-finance history 200 with the financial section", hf.s === 200 && hf.j?.financials && typeof hf.j.financials.outstandingBalance === "number" && Array.isArray(hf.j.financials.payments), brief(hf));
  const ha = await call(T.agent, "GET", `/customers/${pid}/history`);
  check("r14-agent → history refused", refused(ha.s), `${ha.s}`);
});

// ═════════════════════════ F Company partners ═════════════════════════
await run("F", "Company partners and profit sharing", async () => {
  // Accounts (admin): create dedicated equity + liability accounts if unset.
  let st = one(`select partner_profit_distribution_account_id d, partner_profit_payable_account_id p from posting_settings limit 1`);
  if (!st.d || !st.p) {
    const eqParent = one(`select id from chart_of_accounts where deleted_at is null and account_type = 'EQUITY' and not allows_posting order by level, code limit 1`);
    const liParent = one(`select id from chart_of_accounts where deleted_at is null and account_type = 'LIABILITY' and not allows_posting order by level, code limit 1`);
    const mk = async (name, accountType, parentAccountId) => {
      const r = await call(T.admin, "POST", "/chart-of-accounts", { name, accountType, parentAccountId, allowsPosting: true, accountKind: "POSTING" });
      check(`admin creates ${accountType} account "${name}"`, r.s === 201, brief(r));
      return r.j?.id;
    };
    const d = st.d ?? (await mk(`${TAG} توزيعات أرباح الشركاء`, "EQUITY", eqParent?.id));
    const p = st.p ?? (await mk(`${TAG} أرباح الشركاء المستحقة`, "LIABILITY", liParent?.id));
    const r = await call(T.admin, "PATCH", "/accounting/posting-settings", { partnerProfitDistributionAccountId: d, partnerProfitPayableAccountId: p });
    check("admin sets the two partner posting accounts", r.s === 200, brief(r));
    st = one(`select partner_profit_distribution_account_id d, partner_profit_payable_account_id p from posting_settings limit 1`);
  } else check("partner posting accounts already configured", true, "");
  const acc = rows(`select id, account_type from chart_of_accounts where id in (${lit(st.d)}, ${lit(st.p)})`);
  check("distribution = EQUITY, payable = LIABILITY", acc.find((a) => a.id === st.d)?.account_type === "EQUITY" && acc.find((a) => a.id === st.p)?.account_type === "LIABILITY", JSON.stringify(acc));

  // Profiles (finance). Reuse profiles of a previous run when present.
  let profiles = (await call(T.finance, "GET", "/company-partners/profiles")).j;
  profiles = Array.isArray(profiles) ? profiles : profiles?.items ?? [];
  const mine = profiles.filter((p) => (p.notes ?? "").startsWith("R14J"));
  const partnerIds = mine.map((p) => p.partnerId);
  if (partnerIds.length < 2) {
    const cands = (await call(T.finance, "GET", "/company-partners/profiles/candidates")).j;
    const list = (Array.isArray(cands) ? cands : cands?.items ?? []).filter((c) => !partnerIds.includes(c.id ?? c.partnerId));
    check("candidates picker lists existing partners", list.length >= 2 - partnerIds.length, `${list.length}`);
    for (const c of list.slice(0, 2 - partnerIds.length)) {
      const r = await call(T.finance, "POST", "/company-partners/profiles", { partnerId: c.id ?? c.partnerId, notes: `${TAG} acceptance partner` });
      check("r14-finance creates a company partner profile from an existing partner", r.s === 201, brief(r));
      if (r.j) partnerIds.push(r.j.partnerId ?? r.j.id ?? c.id);
    }
  } else check("reusing the two partner profiles of a previous run", true, "");
  const [pA, pB] = partnerIds;
  context.partners = [pA, pB];
  const agreementsOf = async (pid) => {
    const r = (await call(T.finance, "GET", `/company-partners/agreements?partnerId=${pid}`)).j;
    return Array.isArray(r) ? r : r?.items ?? [];
  };
  for (const [pid, pct] of [[pA, 30], [pB, 20]]) {
    const existing = (await agreementsOf(pid)).find((a) => a.status === "ACTIVE");
    if (existing) {
      check(`agreement already active for partner (${existing.profitSharePercent}%)`, true, "");
      continue;
    }
    const r = await call(T.finance, "POST", "/company-partners/agreements", {
      partnerId: pid, profitSharePercent: pct, basis: "NET_PROFIT", effectiveFrom: "2026-09-01", frequency: "MONTHLY",
    });
    check(`agreement ${pct}% NET_PROFIT MONTHLY from 2026-09-01 (ACTIVE)`, r.s === 201 && r.j?.status === "ACTIVE", brief(r));
  }

  const listPeriods = async () => {
    const r = (await call(T.finance, "GET", "/company-partners/periods")).j;
    return Array.isArray(r) ? r : r?.items ?? [];
  };
  /** Preview → save review → close one monthly window; returns { period, preview, net }. */
  async function closeMonth(label, FROM, TO) {
    const pv = await call(T.finance, "GET", `/company-partners/periods/preview?from=${FROM}&to=${TO}`);
    check(`${label}: preview → 200`, pv.s === 200 && !!pv.j?.figures, brief(pv));
    const net = num(pv.j?.figures?.netProfit);
    const entA = num(pv.j?.partners?.find((p) => p.partnerId === pA)?.amount);
    const entB = num(pv.j?.partners?.find((p) => p.partnerId === pB)?.amount);
    const expA = net > 0 ? Math.round(net * 30) / 100 : 0;
    const expB = net > 0 ? Math.round(net * 20) / 100 : 0;
    check(`${label}: entitlement A = 30% × max(net, 0), B = 20% (net ${net})`, Math.abs(entA - expA) <= 0.01 && Math.abs(entB - expB) <= 0.01, `A ${entA}/${expA} B ${entB}/${expB}`);
    let period = (await listPeriods()).find((p) => String(p.periodFrom).startsWith(FROM) && String(p.periodTo).startsWith(TO));
    if (!period || period.status !== "CLOSED") {
      const sv = await call(T.finance, "POST", "/company-partners/periods", { periodFrom: FROM, periodTo: TO });
      check(`${label}: save review (PREVIEW period with snapshot)`, (sv.s === 201 || sv.s === 200) && sv.j?.status === "PREVIEW", brief(sv));
      period = sv.j;
      const cl = await call(T.finance, "POST", `/company-partners/periods/${period?.id}/close`);
      const expectJe = expA + expB > 0;
      check(`${label}: close → CLOSED${expectJe ? " with a journal entry" : " (zero entitlement → no journal entry)"}`,
        (cl.s === 201 || cl.s === 200) && cl.j?.status === "CLOSED" && (!!cl.j?.journalEntryId === expectJe), brief(cl));
      period = cl.j ?? period;
    } else check(`${label}: already closed by a previous run — reusing it`, true, period.id);
    const jeId = period?.journalEntryId ?? one(`select journal_entry_id from partner_profit_periods where id = ${lit(period?.id)}`)?.journal_entry_id;
    if (jeId) {
      const lines = rows(`select account_id, debit, credit, partner_id from journal_entry_lines where journal_entry_id = ${lit(jeId)}`);
      const dr = lines.reduce((a, l) => a + num(l.debit), 0), cr = lines.reduce((a, l) => a + num(l.credit), 0);
      check(`${label}: close JE balanced, only on the two partner accounts`, near(dr, cr) && dr > 0 && lines.every((l) => l.account_id === st.d || l.account_id === st.p),
        `Dr ${dr} Cr ${cr} accounts=${[...new Set(lines.map((l) => (l.account_id === st.d ? "EQ" : l.account_id === st.p ? "LIAB" : "OTHER")))]}`);
      const crA = lines.filter((l) => l.account_id === st.p && l.partner_id === pA).reduce((a, l) => a + num(l.credit), 0);
      const crB = lines.filter((l) => l.account_id === st.p && l.partner_id === pB).reduce((a, l) => a + num(l.credit), 0);
      const drEq = lines.filter((l) => l.account_id === st.d).reduce((a, l) => a + num(l.debit), 0);
      check(`${label}: Dr distribution (equity) ${expA + expB} / Cr payable per partner (A ${expA}, B ${expB}) with the partner dimension`,
        near(drEq, expA + expB) && near(crA, expA) && near(crB, expB), JSON.stringify({ drEq, crA, crB }));
      const je = one(`select status, to_char(entry_date, 'YYYY-MM-DD') d from journal_entries where id = ${lit(jeId)}`);
      check(`${label}: JE POSTED, dated the period end`, je?.status === "POSTED" && je?.d === TO, JSON.stringify(je));
    }
    const cl2 = await call(T.finance, "POST", `/company-partners/periods/${period?.id}/close`);
    check(`${label}: close again → refused (409)`, cl2.s === 409, brief(cl2));
    return { period, net, expA, expB };
  }

  // As specified: September 2026 (on this DB a loss month → zero entitlement, nothing posted).
  const sep = await closeMonth("September 2026", "2026-09-01", "2026-09-30");
  context.september = { netProfit: sep.net, entitlementA: sep.expA, entitlementB: sep.expB };

  // A profitable window for the posting / payment checks: December 2026 (empty month) with a tagged
  // revenue journal (Dr bank / Cr sales revenue 10 000) posted by admin through the journal-entries API.
  // (November 2026 was closed at zero by an earlier run of this script whose seed journal stayed DRAFT.)
  const SEED_REF = "R14J-PARTNER-SEED";
  const bank = settings.bank_account_id;
  const gj = one(`select id from journals where type = 'GENERAL' and is_active and deleted_at is null order by created_at limit 1`);
  const seedSpec = {
    entryDate: "2026-12-10",
    journalId: gj?.id,
    description: "R14 acceptance — partner profit seed revenue (test data)",
    referenceNumber: SEED_REF,
    currencyId,
    lines: [
      { accountId: bank, debit: 10000, description: "R14 acceptance seed" },
      { accountId: settings.sales_revenue_account_id, credit: 10000, description: "R14 acceptance seed" },
    ],
  };
  let seed = one(`select id, status from journal_entries where reference_number = ${lit(SEED_REF)} and deleted_at is null order by created_at desc limit 1`);
  if (seed?.status !== "POSTED") {
    if (seed) {
      const up = await call(T.admin, "PATCH", `/journal-entries/${seed.id}`, seedSpec);
      check("setup: draft seed journal re-dated to December with the general journal", up.s === 200, brief(up));
    } else {
      const je = await call(T.admin, "POST", "/journal-entries", seedSpec);
      check("setup: admin creates the December seed revenue journal", je.s === 201, brief(je));
      seed = { id: je.j?.id };
    }
    const po = await call(T.admin, "POST", `/journal-entries/${seed.id}/post`);
    check("setup: seed journal posted", po.s === 200 || po.s === 201, brief(po));
  } else check("setup: December seed revenue journal already posted (previous run)", true, "");
  const seeded = one(`select to_char(entry_date, 'YYYY-MM') m, status from journal_entries where reference_number = ${lit(SEED_REF)} and deleted_at is null order by created_at desc limit 1`);
  if (seeded?.status === "POSTED" && seeded.m === "2026-12") {
    const dec = await closeMonth("December 2026 (seeded profit)", "2026-12-01", "2026-12-31");
    context.december = { netProfit: dec.net, entitlementA: dec.expA, entitlementB: dec.expB };
  } else check("December 2026 not closed: the seed journal is not posted", false, JSON.stringify(seeded));

  // Payments and statement (all-time balances; statement range Sep → Dec).
  const stmt = async (pid) => (await call(T.finance, "GET", `/company-partners/profiles/${pid}/statement?from=2026-09-01&to=2026-12-31`)).j;
  const sA0 = await stmt(pA);
  const payableA0 = num(sA0?.balance?.payable);
  check("statement A: approved = Σ closed entitlements in range; payable = approved − paid (advance 0)",
    near(sA0?.approved?.total, num(sA0?.approved?.periods?.reduce((a, p) => a + num(p.total), 0))) &&
      near(num(sA0?.balance?.approved) - num(sA0?.balance?.paid), num(sA0?.balance?.payable) - num(sA0?.balance?.advance)),
    JSON.stringify({ approved: sA0?.approved?.total, balance: sA0?.balance }));
  if (payableA0 > 1) {
    const amt = Math.round((payableA0 / 2) * 100) / 100;
    const p1 = await call(T.finance, "POST", "/company-partners/payments", { partnerId: pA, amount: amt, date: "2026-12-31", financialAccountId: bank, reference: `${TAG}-A` });
    check(`payment ${amt} to A (< payable ${payableA0}) recorded with a JE`, p1.s === 201 && !!p1.j?.journalEntryId, brief(p1));
    const sA1 = await stmt(pA);
    check("A: remaining payable = before − payment, no advance", near(sA1?.balance?.payable, payableA0 - amt) && num(sA1?.balance?.advance) === 0, JSON.stringify(sA1?.balance));
    if (p1.j?.journalEntryId) {
      const l = rows(`select account_id, debit, credit, partner_id from journal_entry_lines where journal_entry_id = ${lit(p1.j.journalEntryId)}`);
      check("payment JE: Dr payable (partner A) / Cr bank, balanced",
        l.some((x) => x.account_id === st.p && near(x.debit, amt) && x.partner_id === pA) && l.some((x) => x.account_id === bank && near(x.credit, amt)), JSON.stringify(l));
    }
  } else check("payable of A > 0 to test a partial payment", false, `payable ${payableA0}`);
  const sB0 = await stmt(pB);
  const payB = num(sB0?.balance?.payable), advB = num(sB0?.balance?.advance);
  const over = Math.round((payB + 500) * 100) / 100;
  const p2 = await call(T.finance, "POST", "/company-partners/payments", { partnerId: pB, amount: over, date: "2026-12-31", financialAccountId: bank, reference: `${TAG}-B` });
  check(`overpayment ${over} to B (payable ${payB}) recorded`, p2.s === 201, brief(p2));
  const sB1 = await stmt(pB);
  check("B: overpayment → advance grows by 500, payable 0", near(sB1?.balance?.advance, advB + 500) && num(sB1?.balance?.payable) === 0, JSON.stringify(sB1?.balance));
  check("B statement consistent: approved − paid = payable − advance",
    near(num(sB1?.balance?.approved) - num(sB1?.balance?.paid), num(sB1?.balance?.payable) - num(sB1?.balance?.advance)), JSON.stringify(sB1?.balance));
  for (const [nm, pid, s] of [["A", pA, await stmt(pA)], ["B", pB, sB1]]) {
    const gl = one(`select coalesce(sum(l.credit - l.debit), 0) as bal from journal_entry_lines l join journal_entries e on e.id = l.journal_entry_id
                    where l.account_id = ${lit(st.p)} and l.partner_id = ${lit(pid)} and e.status = 'POSTED'`);
    check(`payable GL balance of partner ${nm} = statement payable − advance`, near(gl?.bal, num(s?.balance?.payable) - num(s?.balance?.advance)), `GL ${gl?.bal} vs ${JSON.stringify(s?.balance)}`);
  }
  const ps = await call(T.sales, "GET", "/company-partners/profiles");
  check("r14-sales (no company-partners.*) → 403", ps.s === 403, `${ps.s}`);
});

// ───────── evidence ─────────
const bySection = {};
for (const r of results) {
  bySection[r.section] ??= { pass: 0, fail: 0 };
  bySection[r.section][r.ok ? "pass" : "fail"]++;
}
const summary = { pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, bySection };
writeFileSync(`${OUT}/journeys.json`, JSON.stringify({ ...context, finishedAt: new Date().toISOString(), summary, results }, null, 2));
console.log(`\n${summary.pass} PASS / ${summary.fail} FAIL`, JSON.stringify(bySection));
console.log(`evidence: ${OUT}/journeys.json`);
process.exitCode = summary.fail ? 1 : 0;
