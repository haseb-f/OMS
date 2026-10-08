#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R15 — API-level acceptance journeys against a LOCAL integrated build (never Production).
 *
 *   S    Setup            — personas sign in; sales team, agent (+ commission / shipping agreements, users,
 *                           catalog), carrier with a COD method, bank method, fresh stocked product — all via the API
 *   J4   Order entry      — agent portal quote/create vs company POST /store-orders; catalog ownership; duplicate check
 *   J1   Overviews        — company /agents-overview + /agents/:id/overview (money only with agents.finance.view);
 *                           agent portal dashboard admin (team) vs sales (own); no cost/margin/cogs/carrier keys
 *   J2   Imports          — company + agent XLSX imports (leads, store orders), payment = PENDING declaration only,
 *                           re-import skipped; Google Sheets connection ownership (fake spreadsheet ids)
 *   J3   Import refusals  — no import key → 403, other user → 404, Owner / Agent columns never override
 *   J5   Shipping agrmt   — draft → rates → activate (overlap refused, replaceFrom) → priced order → carrier → CONFIRMED
 *                           → deactivate → AGENT_SHIPPING_AGREEMENT_MISSING; old order unchanged
 *   J6   Partner portal   — login created through the API, typ partner, self-scoped portal, isolation, disabled → 401
 *   J7   Stock lifecycle  — reserve / SHORT / transit / deliver (COGS) / partial / receive-back / damaged / cancel in transit
 *   J8   Collections      — prepaid (declaration ≠ cash, verify → advance), COD via carrier (expected claim, match → receipt)
 *   J9   Prepaid return   — return request → receive & inspect (credit note) → refund due → refund once; RETURN_PENDING
 *   J10  Idempotency      — repeated / concurrent delivery + dispatch, concurrent refunds, import replay, create replay
 *   J11  Report scope     — /sales-reports/performance, /sales/performance, agent reports per persona
 *
 *   node scripts/acceptance/r15/seed-personas.mjs                     # once (idempotent)
 *   MSYS_NO_PATHCONV=1 API=http://localhost:4505 node scripts/acceptance/r15/r15-journeys.mjs
 *   ONLY=J7,J8 …   runs only those journeys (S always runs; J1's leak sweep covers what ran)
 *
 * Personas r15-*@oms.local; password read at runtime from tmp/r15/.r15.env (R15_PW) — never printed or
 * written. SQL (docker exec oms-postgres psql, DB oms_r15_e2e) is used for read-only assertions and for setup
 * that has no API locally (sheet-connection / sync-source rows bound to fake spreadsheet ids).
 * Evidence: specs/round15-completion/evidence/journeys.json (no tokens, no passwords).
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ROOT = "D:/Systems/OMS";
const API = (process.env.API ?? "http://localhost:4505").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error("local API only");
const DB = process.env.DB ?? "oms_r15_e2e";
if (!/^oms_r15_/.test(DB)) throw new Error("R15 verification databases only");
const OUT = `${ROOT}/specs/round15-completion/evidence`;
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(`${ROOT}/tmp/r15/.r15.env`, "utf8")
  .match(/R15_PW=(.*)/)?.[1]
  ?.trim();
if (!PW) throw new Error("R15_PW missing in tmp/r15/.r15.env (run seed-personas.mjs)");
const require = createRequire(`${ROOT}/apps/api/package.json`);
const ExcelJS = require("exceljs");
const ONLY = process.env.ONLY
  ? process.env.ONLY.split(",").map((s) => s.trim().toUpperCase())
  : null;
const TAG = "R15J" + Date.now().toString().slice(-6);
const tagLower = TAG.toLowerCase();
const START = new Date().toISOString();

// ───────── reporting ─────────
const results = [];
const defects = [];
const context = { tag: TAG, api: API, db: DB, startedAt: START };
let section = "-";
const check = (name, ok, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ section, name, ok: !!ok, detail: (d ?? "").slice(0, 900) });
  console.log(`${ok ? "PASS" : "FAIL"}  [${section}] ${name}${d ? "  -> " + d.slice(0, 400) : ""}`);
  return !!ok;
};
const info = (name, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ section, name, ok: true, info: true, detail: (d ?? "").slice(0, 900) });
  console.log(`INFO  [${section}] ${name}${d ? "  -> " + d.slice(0, 400) : ""}`);
};
async function run(key, title, fn) {
  if (ONLY && key !== "S" && !ONLY.includes(key)) return;
  section = key;
  console.log(`\n=== ${key} ${title} ===`);
  try {
    await fn();
  } catch (error) {
    check(`${title}: section completed without an exception`, false, `${error?.stack ?? String(error)} cause=${error?.cause?.code ?? ""} ${error?.cause?.message ?? ""}`);
  }
}

// ───────── SQL (setup + read-only assertions) ─────────
const psql = (sql) =>
  execFileSync(
    "docker",
    ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
const rows = (sql) =>
  JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`) || "[]");
const one = (sql) => rows(sql)[0] ?? null;
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const inList = (arr) => (arr.length ? arr.map(lit).join(",") : "NULL");

// ───────── HTTP ─────────
const agentTokens = new Set();
const partnerTokens = new Set();
const agentResponses = []; // every JSON body an agent token received (leak sweep, J1)
const networkRetries = [];
/** fetch with one retry when the socket was closed before a response (undici keep-alive race on a reused socket). */
async function fetchRetry(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    const code = error?.cause?.code ?? "";
    if (!/UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED/.test(code)) throw error;
    networkRetries.push(`${init?.method ?? "GET"} ${url.replace(API, "")} ${code}`);
    await sleep(300);
    return fetch(url, init);
  }
}
async function call(token, method, path, body, headers = {}) {
  const r = await fetchRetry(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      "User-Agent": "r15-journeys",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  const text = await r.text();
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  if (token && agentTokens.has(token)) agentResponses.push({ method, path, status: r.status, body: j });
  return { s: r.status, j };
}
async function upload(token, path, buffer, filename) {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );
  const r = await fetchRetry(API + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "User-Agent": "r15-journeys" },
    body: fd,
  });
  const text = await r.text();
  let j = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = text;
  }
  if (agentTokens.has(token)) agentResponses.push({ method: "POST", path, status: r.status, body: j });
  return { s: r.status, j };
}
async function loginRaw(email, password = PW) {
  return call(null, "POST", "/auth/login", { email, password });
}
async function login(email, password = PW) {
  const r = await loginRaw(email, password);
  if (!r.j?.accessToken)
    throw new Error(`login ${email} failed: ${r.s} ${JSON.stringify(r.j)?.slice(0, 200)}`);
  return r.j.accessToken;
}
/** First sign-in with a temporary password → change it to R15_PW → fresh token. */
async function adoptPassword(email, temporaryPassword) {
  const t = await login(email, temporaryPassword);
  const ch = await call(t, "POST", "/auth/change-password", {
    currentPassword: temporaryPassword,
    newPassword: PW,
  });
  if (ch.s >= 300) throw new Error(`change-password ${email}: ${ch.s} ${JSON.stringify(ch.j)?.slice(0, 200)}`);
  return login(email);
}
const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errCode = (j) => j?.code ?? j?.message?.code ?? j?.response?.code ?? j?.error?.code ?? null;
const brief = (r) => `${r.s} ${JSON.stringify(r.j)?.slice(0, 260)}`;
const refused = (s) => s === 401 || s === 403 || s === 404;
const num = (v) => Number(v ?? 0);
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.005;
const ok2 = (s) => s >= 200 && s < 300;
const list = (j) => (Array.isArray(j) ? j : (j?.items ?? j?.data ?? []));
/** Every key path in `value` whose key matches `re`. */
function keyPaths(value, re, path = "") {
  if (Array.isArray(value)) return value.flatMap((v, i) => keyPaths(v, re, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(re.test(k) ? [`${path}.${k}`] : []),
    ...keyPaths(v, re, `${path}.${k}`),
  ]);
}
const jsonHas = (value, needle) => !!needle && JSON.stringify(value ?? null).includes(needle);
const defect = (d) => {
  defects.push({ section, ...d });
  console.log(`DEFECT [${section}] ${d.title}`);
};

// ───────── personas ─────────
const EMAIL = (k) => `r15-${k}@oms.local`;
const INTERNAL = ["admin", "sales", "sales2", "manager", "viewall", "browse", "shipping", "finance", "agview"];
const ids = Object.fromEntries(
  rows(`select email, id from users where email like 'r15-%@oms.local' and deleted_at is null`).map((r) => [
    r.email,
    r.id,
  ]),
);
const uid = (k) => ids[EMAIL(k)];
for (const k of INTERNAL) if (!uid(k)) throw new Error(`persona ${k} missing — run seed-personas.mjs`);
const T = {};
for (const k of INTERNAL) T[k] = await login(EMAIL(k));

// ───────── shared reference data ─────────
const settings = one(`select * from posting_settings limit 1`);
const SAR = settings.functional_currency_id;
const currencyCode = one(`select code from currencies where id = ${lit(SAR)}`).code;
const SA = one(`select id, name from countries where code = 'SA' and deleted_at is null limit 1`);
const CITY = "Riyadh";
const TODAY = one(`select to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD') d`).d;
const YESTERDAY = one(
  `select to_char((now() at time zone 'Africa/Cairo')::date - 1, 'YYYY-MM-DD') d`,
).d;
const MONTH_FROM = `${TODAY.slice(0, 7)}-01`;
const MONTH_TO = one(`select to_char((date_trunc('month', ${lit(TODAY)}::date) + interval '1 month - 1 day')::date, 'YYYY-MM-DD') d`).d;
const WH = Object.fromEntries(
  rows(`select code, id from warehouses where code in ('WH-MAIN','WH-TRANSIT','WH-DAMAGED') and deleted_at is null`).map(
    (w) => [w.code, w.id],
  ),
);
const status = (code) =>
  one(`select id from shipping_statuses where code = ${lit(code)} and deleted_at is null limit 1`)?.id;
context.today = TODAY;
context.currency = currencyCode;
let phoneSeq = Math.floor(Math.random() * 9000);
/** A fresh Saudi mobile (E.164) per call. */
const newPhone = () =>
  `+9665${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}${String(++phoneSeq % 10_000).padStart(4, "0")}`;
const localSa = (e164) => "0" + e164.slice(4); // +9665XXXXXXXX → 05XXXXXXXX
const arabicDigits = (s) => s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

const F = {}; // fixtures (ids)

// ═════════════════════════ S Setup (API) ═════════════════════════
await run("S", "Setup through the API", async () => {
  // Sales team: r15-manager manages r15-sales.
  let team = one(`select t.id from sales_teams t where t.manager_id = ${lit(uid("manager"))} and t.deleted_at is null and t.is_active
                  and exists (select 1 from sales_team_members m where m.sales_team_id = t.id and m.user_id = ${lit(uid("sales"))}) limit 1`);
  if (!team) {
    const dept = one(`select id from departments where deleted_at is null order by created_at limit 1`);
    const r = await call(T.admin, "POST", "/sales-teams", {
      name: `R15 Acceptance Team ${TAG}`,
      departmentId: dept.id,
      managerId: uid("manager"),
      memberIds: [uid("sales")],
    });
    check("admin creates the sales team (manager r15-manager, member r15-sales)", r.s === 201, brief(r));
    team = { id: r.j?.id };
  } else check("sales team r15-manager → r15-sales exists (previous run)", true, team.id);
  F.teamId = team.id;

  // Category / unit / service product for company orders.
  let cat = one(`select id from product_categories where name = 'R15 Acceptance' and deleted_at is null limit 1`);
  if (!cat) {
    const r = await call(T.admin, "POST", "/product-categories", { name: "R15 Acceptance" });
    check("admin creates product category R15 Acceptance", r.s === 201, brief(r));
    cat = { id: r.j?.id };
  }
  F.categoryId = cat.id;
  F.unitId = one(`select id from units where deleted_at is null order by created_at limit 1`).id;
  F.service = one(`select id, sku from products where deleted_at is null and status = 'ACTIVE' and owner_agent_id is null
    and is_sellable and item_type = 'SERVICE' and not is_inventory_item order by sku limit 1`);
  check("a company service product exists", !!F.service, F.service?.sku ?? "none");

  // Bank transfer method (non-reconciled, account = posting settings bank) for declarations.
  let bankMethod = one(`select id from payment_methods where name = 'R15 Bank transfer' and deleted_at is null limit 1`);
  if (!bankMethod) {
    const r = await call(T.admin, "POST", "/payment-methods", {
      name: "R15 Bank transfer",
      accountId: settings.bank_account_id,
      requiresReconciliation: false,
    });
    check("admin creates payment method R15 Bank transfer (bank account)", r.s === 201, brief(r));
    bankMethod = { id: r.j?.id };
  }
  F.bankMethodId = bankMethod.id;
  F.bankReceivingAccountId = one(
    `select id from receiving_accounts where code = 'BANK-01' and deleted_at is null limit 1`,
  )?.id;

  // Carrier COD clearing: a postable ASSET account "receivable from the carrier" + reconciled method.
  let codAcc = one(`select id from chart_of_accounts where name = 'R15 COD receivable from carrier' and deleted_at is null limit 1`);
  if (!codAcc) {
    const parent = one(
      `select id from chart_of_accounts where deleted_at is null and account_type = 'ASSET' and not allows_posting order by level desc, code limit 1`,
    );
    const r = await call(T.admin, "POST", "/chart-of-accounts", {
      name: "R15 COD receivable from carrier",
      accountType: "ASSET",
      parentAccountId: parent?.id,
      allowsPosting: true,
      accountKind: "POSTING",
    });
    check("admin creates ASSET account R15 COD receivable from carrier", r.s === 201, brief(r));
    codAcc = { id: r.j?.id };
  }
  F.codAccountId = codAcc.id;
  let codMethod = one(`select id from payment_methods where name = 'R15 COD via carrier' and deleted_at is null limit 1`);
  if (!codMethod) {
    const r = await call(T.admin, "POST", "/payment-methods", {
      name: "R15 COD via carrier",
      accountId: codAcc.id,
      requiresReconciliation: true,
    });
    check("admin creates reconciled payment method R15 COD via carrier", r.s === 201, brief(r));
    codMethod = { id: r.j?.id };
  }
  F.codMethodId = codMethod.id;
  let carrier = one(`select id, cod_payment_method_id from shipping_companies where name = 'R15 Carrier' and deleted_at is null limit 1`);
  if (!carrier) {
    const bad = await call(T.admin, "POST", "/shipping-companies", {
      name: `R15 bad COD ${TAG}`,
      type: "EXTERNAL_COMPANY",
      codPaymentMethodId: F.bankMethodId,
    });
    check(
      "carrier with a NON-reconciled COD method refused (COD_PAYMENT_METHOD_INVALID)",
      bad.s === 400 && errCode(bad.j) === "COD_PAYMENT_METHOD_INVALID",
      brief(bad),
    );
    const r = await call(T.admin, "POST", "/shipping-companies", {
      name: "R15 Carrier",
      type: "EXTERNAL_COMPANY",
      codPaymentMethodId: F.codMethodId,
    });
    check("admin creates carrier R15 Carrier with the COD method", r.s === 201, brief(r));
    carrier = { id: r.j?.id, cod_payment_method_id: F.codMethodId };
  }
  F.carrierId = carrier.id;
  check("R15 Carrier carries the reconciled COD method", carrier.cod_payment_method_id === F.codMethodId, "");

  // Agent with PREDETERMINED_CHARGE commission agreement + shipping agreement + users + catalog.
  const ag = await ensureAgent("R15 Acceptance Agent", "r15-agent", { withUsers: true });
  Object.assign(F, { agent: ag });
  T.agAdmin = ag.tokens.admin;
  T.agSales = ag.tokens.sales;
  const adminPerms = (await call(T.agAdmin, "GET", "/auth/me")).j?.permissions ?? [];
  const salesPerms = (await call(T.agSales, "GET", "/auth/me")).j?.permissions ?? [];
  check(
    "r15-agent-admin holds the ADMIN preset incl. view_team / leads.import / orders.import / records.assign",
    ["agent.reports.view_team", "agent.leads.import", "agent.orders.import", "agent.records.assign"].every((p) =>
      adminPerms.includes(p),
    ),
    JSON.stringify(adminPerms),
  );
  check(
    "r15-agent-sales holds the SALES preset + agent.orders.import + agent.leads.import, not view_team / records.assign",
    ["agent.orders.create", "agent.orders.import", "agent.leads.import"].every((p) => salesPerms.includes(p)) &&
      !salesPerms.includes("agent.reports.view_team") &&
      !salesPerms.includes("agent.records.assign"),
    JSON.stringify(salesPerms),
  );
  check(
    "agent tokens carry typ agent",
    decode(T.agAdmin).typ === "agent" && decode(T.agSales).typ === "agent",
    "",
  );
  context.agent = { number: ag.agentNumber, shippingAgreement: ag.shippingAgreementNumber };
});

/** Find-or-create an agent (SAR, SA) with an ACTIVE PREDETERMINED_CHARGE agreement, an in-force shipping
 * agreement, one non-stock agent product and (optionally) its admin + sales users. All through the API. */
async function ensureAgent(name, emailPrefix, { withUsers, rates, shippingFrom = "2026-01-01", fresh = false }) {
  const out = { tokens: {} };
  let agent = fresh ? null : one(`select id, agent_number from agents where name = ${lit(name)} and deleted_at is null limit 1`);
  if (!agent) {
    const r = await call(T.admin, "POST", "/agents", {
      name,
      email: `${emailPrefix}-agent-${tagLower}@oms.local`,
      currencyId: SAR,
      countryId: SA.id,
    });
    check(`admin creates agent "${name}"`, r.s === 201, brief(r));
    agent = { id: r.j?.id, agent_number: r.j?.agentNumber };
  }
  out.id = agent.id;
  out.agentNumber = agent.agent_number;
  // Shipping agreement in force today (created BEFORE the commission agreement is activated).
  let asa = one(`select id, agreement_number from agent_shipping_agreements where agent_id = ${lit(agent.id)} and status = 'ACTIVE'
    and deleted_at is null and effective_from <= ${lit(TODAY)}::date and (effective_to is null or effective_to >= ${lit(TODAY)}::date) limit 1`);
  if (!asa) {
    const d = await call(T.admin, "POST", `/agents/${agent.id}/shipping-agreements`, {
      effectiveFrom: shippingFrom,
      rates: rates ?? [
        { service: "COD_CARRIER", countryId: SA.id, amount: 60 },
        { service: "COD_INTERNAL_COURIER", countryId: SA.id, city: CITY, amount: 40 },
        { service: "PREPAID_CARRIER", amount: 70 },
        { service: "PREPAID_INTERNAL_COURIER", amount: 50 },
      ],
    });
    check(`shipping agreement draft for "${name}"`, d.s === 201, brief(d));
    const a = await call(T.admin, "POST", `/agents/${agent.id}/shipping-agreements/${d.j?.id}/activate`, {});
    check(`shipping agreement activated for "${name}"`, ok2(a.s) && (a.j?.status ?? a.j?.agreement?.status) === "ACTIVE", brief(a));
    asa = one(`select id, agreement_number from agent_shipping_agreements where id = ${lit(d.j?.id)}`);
  }
  out.shippingAgreementId = asa?.id;
  out.shippingAgreementNumber = asa?.agreement_number;
  let agr = one(`select id, shipping_policy from agent_agreements where agent_id = ${lit(agent.id)} and status = 'ACTIVE' limit 1`);
  if (!agr) {
    const c = await call(T.admin, "POST", `/agents/${agent.id}/agreements`, {
      effectiveFrom: "2026-01-01",
      productCommissionRatePercent: 35,
      serviceCommissionRatePercent: 10,
      shippingPolicy: "PREDETERMINED_CHARGE",
      commissionEarningEvent: "DELIVERED",
      returnCommissionTreatment: "REVERSE",
      customerShippingChargeOwner: "COMPANY",
      providerFeesBorneBy: "AGENT",
      shippingFeePerShipment: 0,
      returnFeePerShipment: 0,
      serviceFeePerOrder: 0,
      allowAgentDestinations: false,
      payoutHoldDays: 7,
    });
    check(`commission agreement (PREDETERMINED_CHARGE) for "${name}"`, c.s === 201, brief(c));
    const a = await call(T.admin, "POST", `/agents/${agent.id}/agreements/${c.j?.id}/activate`, {});
    check(`commission agreement activated for "${name}"`, ok2(a.s), brief(a));
    agr = { id: c.j?.id, shipping_policy: "PREDETERMINED_CHARGE" };
  }
  out.agreementId = agr.id;
  let prod = one(`select id, sku from products where owner_agent_id = ${lit(agent.id)} and deleted_at is null and status = 'ACTIVE' and is_sellable and is_inventory_item order by created_at limit 1`);
  if (!prod) {
    const r = await call(T.admin, "POST", "/products", {
      name: `${name} product`,
      internalName: `${name} product`,
      displayName: `${name} product`,
      categoryId: F.categoryId,
      unitId: F.unitId,
      type: "PURCHASE_AND_SALE",
      itemType: "PRODUCT",
      isPurchasable: true,
      isSellable: true,
      isInventoryItem: true,
      weight: 1,
      width: 10,
      height: 10,
      length: 10,
      preferredWarehouseId: WH["WH-MAIN"],
      salesPrice: 500,
      status: "ACTIVE",
      ownerAgentId: agent.id,
    });
    check(`agent-owned stocked product for "${name}" created`, r.s === 201, brief(r));
    prod = { id: r.j?.id, sku: r.j?.sku };
  }
  // Agent-owned goods on hand (ownerAgentId on every movement) so agent orders reserve.
  const agAvail = num((await invStock(prod.id))?.available);
  if (agAvail < 20) await openStock(prod, 50 - agAvail, 10);
  out.productId = prod.id;
  out.productSku = prod.sku;
  if (withUsers) {
    for (const [key, role, extra] of [
      ["admin", "ADMIN", []],
      ["sales", "SALES", ["agent.orders.import", "agent.leads.import"]],
    ]) {
      const email = `${emailPrefix}-${key}${fresh ? "-" + tagLower : ""}@oms.local`;
      let u = one(`select id, agent_id from users where email = ${lit(email)} and deleted_at is null`);
      if (!u) {
        const r = await call(T.admin, "POST", `/agents/${agent.id}/users`, {
          email,
          username: email.split("@")[0],
          fullName: `${name} ${key}`,
          agentRole: role,
          ...(extra.length ? { extraPermissions: extra } : {}),
        });
        check(`agent user ${email} created through the API (temporary password returned)`, r.s === 201 && !!r.j?.temporaryPassword, `${r.s}`);
        u = { id: r.j?.id };
        out.tokens[key] = await adoptPassword(email, r.j.temporaryPassword);
      } else {
        const l = await loginRaw(email);
        if (l.j?.accessToken && !l.j?.mustChangePassword) out.tokens[key] = l.j.accessToken;
        else {
          const rp = await call(T.admin, "POST", `/agents/${agent.id}/users/${u.id}/reset-password`, {});
          out.tokens[key] = await adoptPassword(email, rp.j?.temporaryPassword);
        }
      }
      out[`${key}UserId`] = u.id;
      agentTokens.add(out.tokens[key]);
    }
  }
  return out;
}

// ───────── shared company-order helpers ─────────
async function createCompanyOrder(token, items, opts = {}) {
  return call(token, "POST", "/store-orders", {
    partner: {
      name: opts.customerName ?? `${TAG} عميل ${opts.key}`,
      phone: opts.phone ?? newPhone(),
      countryId: SA.id,
      city: CITY,
      address: "R15 street 1",
    },
    source: "MANUAL",
    currencyId: SAR,
    paymentType: opts.paymentType ?? "CASH_ON_DELIVERY",
    ...(opts.fulfillmentMethod ? { fulfillmentMethod: opts.fulfillmentMethod } : {}),
    items,
    delivery: { countryId: SA.id, city: CITY, address: "R15 street 1" },
    creationIdempotencyKey: opts.idempotencyKey ?? `${TAG}-${opts.key}`,
    ...(opts.duplicateResolution ? { duplicateResolution: opts.duplicateResolution } : {}),
  });
}
const orderView = async (id) => (await call(T.admin, "GET", `/store-orders/${id}/stock`)).j;
async function invStock(productId, warehouseId) {
  return (await call(T.admin, "GET", `/inventory/stock?productId=${productId}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`)).j;
}
const sumAt = (productId, warehouseId) =>
  num(
    one(`select coalesce(sum(quantity),0) q from inventory_movements where product_id = ${lit(productId)} and warehouse_id = ${lit(warehouseId)}
         and type not in ('RESERVATION','RESERVATION_RELEASE')`)?.q,
  );
const itemsOf = (orderId) =>
  rows(`select id, product_id, quantity from store_order_items where store_order_id = ${lit(orderId)} order by created_at, id`);
const invoicesOf = (orderId) =>
  rows(`select id, invoice_number, status, grand_total, shipment_id from sales_invoices where store_order_id = ${lit(orderId)}
        and deleted_at is null and status <> 'CANCELLED' order by created_at`);
const journalOf = (sourceType, sourceId) => {
  const je = rows(`select id, entry_number from journal_entries where source_type = ${lit(sourceType)} and source_id = ${lit(sourceId)}
                   and status = 'POSTED' and reversal_of_entry_id is null and deleted_at is null`);
  const lines = je.length
    ? rows(`select l.debit, l.credit, l.account_id, a.account_type from journal_entry_lines l join chart_of_accounts a on a.id = l.account_id
            where l.journal_entry_id in (${inList(je.map((e) => e.id))})`)
    : [];
  const dr = lines.reduce((a, l) => a + num(l.debit), 0);
  const cr = lines.reduce((a, l) => a + num(l.credit), 0);
  const side = (acc, s) => lines.filter((l) => l.account_id === acc).reduce((a, l) => a + num(l[s]), 0);
  const type = (t, s) => lines.filter((l) => l.account_type === t).reduce((a, l) => a + num(l[s]), 0);
  return { entries: je, lines, dr, cr, balanced: near(dr, cr) && dr > 0, side, type };
};
/** Fresh company-owned stocked product (SAR price, weights) with opening stock at a unit cost. */
async function freshStockedProduct(label, qty, unitCost, salesPrice = 100) {
  const r = await call(T.admin, "POST", "/products", {
    name: `${TAG} ${label}`,
    internalName: `${TAG} ${label}`,
    displayName: `${TAG} ${label}`,
    categoryId: F.categoryId,
    unitId: F.unitId,
    type: "PURCHASE_AND_SALE",
    itemType: "PRODUCT",
    isPurchasable: true,
    isSellable: true,
    isInventoryItem: true,
    salesPrice,
    status: "ACTIVE",
    weight: 1,
    width: 10,
    height: 10,
    length: 10,
    preferredWarehouseId: WH["WH-MAIN"],
  });
  check(`setup: product "${label}" created (stocked, company-owned)`, r.s === 201, brief(r));
  const p = { id: r.j?.id, sku: r.j?.sku };
  if (qty > 0) await openStock(p, qty, unitCost);
  return p;
}
async function openStock(p, qty, unitCost) {
  const r = await call(T.admin, "POST", "/inventory/opening-balance", {
    productId: p.id,
    warehouseId: WH["WH-MAIN"],
    quantity: qty,
    unitCost,
    notes: `${TAG} acceptance stock`,
  });
  check(`setup: opening stock +${qty} @ ${unitCost} for ${p.sku}`, ok2(r.s), brief(r));
}
const ship = (orderId, body) =>
  call(T.shipping, "POST", `/store-orders/${orderId}/shipments/ship`, body ?? {});
const deliver = (orderId, body) =>
  call(T.shipping, "POST", `/store-orders/${orderId}/shipments/deliver`, body ?? {});

// ═════════════════════════ J4 Agent order entry parity ═════════════════════════
const J4 = {};
await run("J4", "Agent order entry parity", async () => {
  const ag = F.agent;
  // Catalog: the agent sees its own products, never company goods.
  const cat = await call(T.agSales, "GET", "/agent-portal/products?pageSize=100");
  const catIds = list(cat.j).map((p) => p.id ?? p.productId);
  check(
    "agent sales catalog lists the agent's product and no company product",
    cat.s === 200 && catIds.includes(ag.productId) && !catIds.includes(F.service.id),
    `${cat.s} n=${catIds.length}`,
  );
  const base = (lines, extra = {}) => ({
    pricingMode: "SHIPPING_ADDED",
    lines,
    fulfillmentMethod: "SHIPPING",
    paymentType: "CASH_ON_DELIVERY",
    countryId: SA.id,
    city: CITY,
    address: "Agent street 1",
    ...extra,
  });
  const qCompany = await call(T.agSales, "POST", "/agent-portal/orders/quote", base([{ productId: F.service.id, quantity: 1, lineAmount: 100 }]));
  const qIssues = JSON.stringify(qCompany.j);
  check(
    "agent quote with a COMPANY product → PRODUCT_NOT_AVAILABLE (refused)",
    /PRODUCT_NOT_AVAILABLE/.test(qIssues),
    brief(qCompany),
  );
  const phone = newPhone();
  J4.phone = phone;
  const cCompany = await call(T.agSales, "POST", "/agent-portal/orders", {
    ...base([{ productId: F.service.id, quantity: 1, lineAmount: 100 }]),
    customer: { name: `${TAG} agent customer`, mobile: phone, countryId: SA.id, city: CITY, address: "Agent street 1" },
    idempotencyKey: `${TAG}-ag-company-product`,
  });
  check(
    "agent create with a COMPANY product → refused (4xx, PRODUCT_NOT_AVAILABLE), no order",
    cCompany.s >= 400 && cCompany.s < 500 && /PRODUCT_NOT_AVAILABLE/.test(JSON.stringify(cCompany.j)),
    brief(cCompany),
  );

  // Duplicate check (agent) before the order: nothing.
  const d0 = await call(T.agSales, "POST", "/agent-portal/orders/duplicate-check", { phone, countryId: SA.id });
  check("agent duplicate-check on a new phone → NONE", d0.s === 200 && d0.j?.kind === "NONE", brief(d0));

  const q = await call(T.agSales, "POST", "/agent-portal/orders/quote", base([{ productId: ag.productId, quantity: 2, lineAmount: 1000 }]));
  check(
    "agent quote (agent product, COD, Riyadh) → 200 with a shipping charge from the shipping agreement",
    q.s === 200 && near(q.j?.shipping?.charge, 60) && q.j?.shippingPricingStatus === "PENDING_METHOD" && q.j?.agentShippingCharge?.shippingAgreementNumber === ag.shippingAgreementNumber,
    brief(q),
  );
  J4.quote = q.j;
  const c = await call(T.agSales, "POST", "/agent-portal/orders", {
    ...base([{ productId: ag.productId, quantity: 2, lineAmount: 1000 }]),
    customer: { name: `${TAG} agent customer`, mobile: phone, countryId: SA.id, city: CITY, address: "Agent street 1" },
    idempotencyKey: `${TAG}-ag-order-1`,
  });
  check("agent sales creates an agent order (own catalog) → 201", c.s === 201 && !!c.j?.id, brief(c));
  J4.agentOrder = c.j;
  const ord = one(`select id, internal_order_id, agent_id, employee_id, partner_id, agent_terms_snapshot from store_orders where id = ${lit(c.j?.id)}`);
  check(
    "agent order: agent from the token, owner = the agent sales user",
    ord?.agent_id === ag.id && ord?.employee_id === ag.salesUserId,
    JSON.stringify({ agent: ord?.agent_id === ag.id, owner: ord?.employee_id === ag.salesUserId }),
  );
  const snap = ord?.agent_terms_snapshot?.agentShippingCharge;
  check(
    "snapshot carries the shipping agreement number (D15-13)",
    !!snap && snap.shippingAgreementNumber === ag.shippingAgreementNumber,
    JSON.stringify(snap)?.slice(0, 300),
  );
  // Agent admin also creates one (for the team vs own figures in J1).
  const c2 = await call(T.agAdmin, "POST", "/agent-portal/orders", {
    ...base([{ productId: ag.productId, quantity: 1, lineAmount: 700 }]),
    customer: { name: `${TAG} agent customer 2`, mobile: newPhone(), countryId: SA.id, city: CITY, address: "Agent street 2" },
    idempotencyKey: `${TAG}-ag-order-2`,
  });
  check("agent admin creates an agent order → 201", c2.s === 201, brief(c2));
  J4.adminOrder = c2.j;

  // Duplicate check after the order — agent (Arabic digits, local form) and company (local form).
  const d1 = await call(T.agSales, "POST", "/agent-portal/orders/duplicate-check", {
    phone: arabicDigits(localSa(phone)),
    countryId: SA.id,
  });
  check(
    "agent duplicate-check with the same phone in Arabic digits / local form → PHONE (own agent's customer)",
    d1.s === 200 && d1.j?.kind === "PHONE" && d1.j?.crossScope === false,
    brief(d1),
  );
  const d2 = await call(T.sales, "POST", "/store-orders/duplicate-check", { phone: localSa(phone), countryId: SA.id });
  check(
    "company duplicate-check on the same phone (local form) → PHONE match (the shared R11 phone path)",
    d2.s === 200 && d2.j?.kind === "PHONE",
    brief(d2),
  );
  context.j4DuplicateCompany = { kind: d2.j?.kind, crossScope: d2.j?.crossScope };

  // Company order entry.
  const cAg = await createCompanyOrder(T.sales, [{ productId: ag.productId, quantity: 1, unitPrice: 100 }], {
    key: "co-agent-product",
  });
  check(
    "company POST /store-orders with an AGENT product → refused 4xx",
    cAg.s >= 400 && cAg.s < 500,
    brief(cAg),
  );
  const cDup = await createCompanyOrder(T.sales, [{ productId: F.service.id, quantity: 1, unitPrice: 90 }], {
    key: "co-dup",
    phone: localSa(phone),
  });
  check(
    "company order on the agent customer's phone without a decision → 409 DUPLICATE_ACKNOWLEDGEMENT_REQUIRED",
    cDup.s === 409 && errCode(cDup.j) === "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED",
    brief(cDup),
  );
  const cOk = await createCompanyOrder(T.sales, [{ productId: F.service.id, quantity: 1, unitPrice: 90 }], {
    key: "co-dup-ack",
    phone: localSa(phone),
    duplicateResolution: { decision: "INTENTIONAL_NEW_ORDER" },
  });
  check(
    "company order with the acknowledgement → 201, same customer record as the agent order (one phone = one customer)",
    cOk.s === 201 && cOk.j?.partnerId === ord?.partner_id,
    brief(cOk),
  );
  J4.companyOrder = cOk.j;
  const co = one(`select employee_id, agent_id, source from store_orders where id = ${lit(cOk.j?.id)}`);
  check(
    "company order: owner = the company salesperson, no agent",
    co?.employee_id === uid("sales") && co?.agent_id === null,
    JSON.stringify(co),
  );
});

// ═════════════════════════ J1 Overviews ═════════════════════════
await run("J1", "Company and agent overviews", async () => {
  const ag = F.agent;
  const MONEY = ["sales", "delivered", "collections", "position", "returns", "payouts"];
  const fo = await call(T.finance, "GET", `/agents-overview?ids=${ag.id}`);
  const vo = await call(T.agview, "GET", `/agents-overview?ids=${ag.id}`);
  const fItem = fo.j?.items?.[0];
  const vItem = vo.j?.items?.[0];
  check(
    "finance (agents.finance.view) /agents-overview → finance true, per-agent money present",
    fo.s === 200 && fo.j?.finance === true && fItem?.agent?.id === ag.id && "sales" in (fItem ?? {}) && "collections" in (fItem ?? {}),
    brief(fo),
  );
  check(
    "agents.view only /agents-overview → finance false, money keys ABSENT (not zero), counts present",
    vo.s === 200 &&
      vo.j?.finance === false &&
      vItem?.agent?.id === ag.id &&
      MONEY.every((k) => !(k in (vItem ?? {}))) &&
      !("collections" in (vo.j?.totals ?? {})) &&
      !!vItem?.fulfillment,
    JSON.stringify({ keys: Object.keys(vItem ?? {}), totals: Object.keys(vo.j?.totals ?? {}) }),
  );
  const f1 = await call(T.finance, "GET", `/agents/${ag.id}/overview`);
  const v1 = await call(T.agview, "GET", `/agents/${ag.id}/overview`);
  check(
    "finance /agents/:id/overview → money present (sales, delivered, collections, position)",
    f1.s === 200 && ["sales", "delivered", "collections", "position"].every((k) => k in (f1.j ?? {})),
    `${f1.s} keys=${Object.keys(f1.j ?? {}).join(",")}`,
  );
  check(
    "agents.view only /agents/:id/overview → stage counts present, money absent",
    v1.s === 200 && !!v1.j?.fulfillment && MONEY.every((k) => !(k in (v1.j ?? {}))),
    `${v1.s} keys=${Object.keys(v1.j ?? {}).join(",")}`,
  );
  check(
    "company overviews: order count includes the J4 agent orders (stage counts work without money)",
    num(v1.j?.fulfillment?.total) >= 2 && num(v1.j?.fulfillment?.total) === num(f1.j?.fulfillment?.total),
    JSON.stringify(v1.j?.fulfillment)?.slice(0, 200),
  );
  const s1 = await call(T.sales, "GET", `/agents/${ag.id}/overview`);
  check("r15-sales (no agents.view) → /agents/:id/overview refused", refused(s1.s), `${s1.s}`);
  const a1 = await call(T.agAdmin, "GET", `/agents/${ag.id}/overview`);
  check("agent token on the company overview → refused", refused(a1.s), `${a1.s}`);

  // Agent portal dashboards.
  const da = await call(T.agAdmin, "GET", "/agent-portal/dashboard");
  const ds = await call(T.agSales, "GET", "/agent-portal/dashboard");
  const teamRows = Array.isArray(da.j?.team) ? da.j.team : (da.j?.team?.rows ?? da.j?.team?.members ?? []);
  check(
    "agent admin dashboard → scope ALL with the per-employee team breakdown (incl. the sales user)",
    da.s === 200 && da.j?.scope === "ALL" && !!da.j?.team && JSON.stringify(da.j.team).includes(ag.salesUserId),
    `${da.s} scope=${da.j?.scope} team=${JSON.stringify(da.j?.team)?.slice(0, 200)}`,
  );
  check(
    "agent sales dashboard → scope OWN, own figures, NO team breakdown, no agent-level money",
    ds.s === 200 &&
      ds.j?.scope === "OWN" &&
      ds.j?.team === null &&
      !!ds.j?.own &&
      ds.j?.position === null &&
      ds.j?.collections === null &&
      ds.j?.payouts === null,
    JSON.stringify({ scope: ds.j?.scope, team: ds.j?.team, own: ds.j?.own, position: ds.j?.position }),
  );
  check(
    "agent sales dashboard never names the agent admin (other employees' figures absent)",
    !jsonHas(ds.j, ag.adminUserId),
    "",
  );
  const salesRow = teamRows.find?.((r) => (r.userId ?? r.user?.id ?? r.id) === ag.salesUserId);
  const ownValue = num(ds.j?.own?.orderValue?.amount ?? ds.j?.own?.orderValue);
  info("agent sales own.orderValue vs admin team row", { own: ds.j?.own?.orderValue, teamRow: salesRow });
  check(
    "agent sales own order value > 0 and excludes the admin's order (own < agent-wide total)",
    ownValue > 0 &&
      (da.j?.sales ? ownValue < num(da.j.sales?.totalOrderValue?.amount ?? da.j.sales?.totalOrderValue ?? Infinity) : true),
    JSON.stringify({ own: ds.j?.own, agentSales: da.j?.sales }),
  );
});

// ═════════════════════════ J2 / J3 Imports ═════════════════════════
async function xlsxOf(rows2) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import Data");
  const headers = [...new Set(rows2.flatMap((r) => Object.keys(r)))];
  ws.addRow(headers);
  for (const r of rows2) ws.addRow(headers.map((h) => r[h] ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/** create → upload (xlsx) → mapping (header = field key; extra headers left unmapped) → validate → run → job. */
async function importFile(token, base, type, rows2, fieldKeys, { runIt = true } = {}) {
  const out = {};
  const job = await call(token, "POST", `${base}/jobs`, { importType: type });
  out.create = job;
  if (!ok2(job.s)) return out;
  out.jobId = job.j.id;
  const buf = await xlsxOf(rows2);
  out.upload = await upload(token, `${base}/jobs/${out.jobId}/upload`, buf, `${TAG}-${type}.xlsx`);
  const headers = [...new Set(rows2.flatMap((r) => Object.keys(r)))];
  out.mapping = await call(token, "POST", `${base}/jobs/${out.jobId}/mapping`, {
    columnMapping: Object.fromEntries(headers.filter((h) => fieldKeys.includes(h)).map((h) => [h, h])),
  });
  out.validate = await call(token, "POST", `${base}/jobs/${out.jobId}/validate`);
  if (runIt) {
    out.run = await call(token, "POST", `${base}/jobs/${out.jobId}/run`);
    out.job = await call(token, "GET", `${base}/jobs/${out.jobId}`);
  }
  return out;
}
const LEAD_FIELDS = ["externalOrderId", "customerName", "mobileNumber", "countryName", "city", "address", "productSku", "notes", "agentEmail"];
const ORDER_FIELDS = [
  "externalOrderId", "orderDate", "customerName", "customerPhone", "countryName", "city", "address", "productSku",
  "quantity", "unitPrice", "lineAmount", "paidAmount", "currencyCode", "paymentMethodLabel", "paymentDate",
  "paymentType", "repeatCustomer", "notes", "agentEmail",
];
const J2 = {};
await run("J2", "Excel / Google Sheets imports (company + agent)", async () => {
  const CO = "/import-center";
  // Company leads: own row + an unmapped "Agent" column (never imported).
  const leadOwn = { customerName: `${TAG} Lead A`, mobileNumber: localSa(newPhone()), countryName: SA.name, city: CITY, Agent: "Some Agent" };
  const li = await importFile(T.sales, CO, "LEADS", [leadOwn], LEAD_FIELDS);
  check("company sales: lead import job created (crm.leads.import, no import-center.*)", li.create.s === 201, brief(li.create));
  check("lead XLSX uploaded", ok2(li.upload?.s), brief(li.upload ?? {}));
  check("lead mapping saved", ok2(li.mapping?.s), brief(li.mapping ?? {}));
  check(
    "lead preview: unmapped 'Agent' column → warning (never imported)",
    ok2(li.validate?.s) && /Agent/.test(JSON.stringify(li.validate.j?.warnings ?? [])),
    JSON.stringify(li.validate?.j?.warnings)?.slice(0, 300),
  );
  check("lead import run → created 1", ok2(li.run?.s) && li.run.j?.summary?.created === 1, brief(li.run ?? {}));
  const lead = one(`select id, sales_employee_id, import_row_key, agent_id from leads where customer_name = ${lit(leadOwn.customerName)}`);
  check(
    "imported lead belongs to the importer (company scope), import row key stamped",
    lead?.sales_employee_id === uid("sales") && lead?.agent_id === null && /^lead-import:company:/.test(lead?.import_row_key ?? ""),
    JSON.stringify(lead),
  );
  J2.companyLeadJob = li.jobId;

  // Company store orders: a paid row (declaration only) + a plain row; the job summary.
  const paidPhone = localSa(newPhone());
  const orderRows = [
    {
      orderDate: TODAY, customerName: `${TAG} Imp Paid`, customerPhone: paidPhone, countryName: SA.name, city: CITY,
      address: "Imp street", productSku: F.service.sku, quantity: "1", unitPrice: "150", currencyCode,
      paidAmount: "150", paymentMethodLabel: "R15 Bank transfer", paymentDate: TODAY, "Carrier Cost": "12",
    },
    {
      orderDate: TODAY, customerName: `${TAG} Imp Plain`, customerPhone: localSa(newPhone()), countryName: SA.name, city: CITY,
      address: "Imp street", productSku: F.service.sku, quantity: "2", unitPrice: "80", currencyCode, "Carrier Cost": "12",
    },
  ];
  J2.orderRows = orderRows;
  const oi = await importFile(T.sales, CO, "STORE_ORDERS", orderRows, ORDER_FIELDS);
  check("company sales: store-order import job created (store-orders.import)", oi.create.s === 201, brief(oi.create));
  check(
    "store-order preview: 'Carrier Cost' column → warning (never imported)",
    /Carrier Cost/.test(JSON.stringify(oi.validate?.j?.warnings ?? [])),
    JSON.stringify(oi.validate?.j?.warnings)?.slice(0, 300),
  );
  check(
    "store-order import run → created 2, rejected 0",
    ok2(oi.run?.s) && oi.run.j?.summary?.created === 2 && !oi.run.j?.summary?.rejected,
    brief(oi.run ?? {}),
  );
  check(
    "GET job → summary of created / skipped / needs review / rejected",
    oi.job?.s === 200 && oi.job.j?.summary && "created" in oi.job.j.summary,
    JSON.stringify(oi.job?.j?.summary),
  );
  J2.companyOrderJob = oi.jobId;
  const imp = rows(`select o.id, o.employee_id, o.source, o.creation_idempotency_key, o.declared_payment_status, o.agent_id
                    from store_orders o join partners p on p.id = o.partner_id where p.name in (${inList(orderRows.map((r) => r.customerName))}) and o.deleted_at is null`);
  J2.importedOrderIds = imp.map((o) => o.id);
  check(
    "imported orders: owner = importer, source IMPORT, key import:company:<sha>",
    imp.length === 2 &&
      imp.every((o) => o.employee_id === uid("sales") && o.source === "IMPORT" && /^import:company:[0-9a-f]{64}$/.test(o.creation_idempotency_key ?? "") && o.agent_id === null),
    JSON.stringify(imp.map((o) => [o.employee_id === uid("sales"), o.source, o.creation_idempotency_key?.slice(0, 20)])),
  );
  const paid = one(`select o.id from store_orders o join partners p on p.id = o.partner_id where p.name = ${lit(`${TAG} Imp Paid`)}`);
  const pays = rows(`select id, status, origin from payments where store_order_id = ${lit(paid?.id)} and deleted_at is null`);
  check(
    "payment column → exactly one PENDING SALES_DECLARATION claim",
    pays.length === 1 && pays[0].status === "PENDING" && pays[0].origin === "SALES_DECLARATION",
    JSON.stringify(pays),
  );
  const rl = one(`select count(*)::int n from payment_receipt_links where payment_id in (${inList(pays.map((p) => p.id))})`);
  const je = one(`select count(*)::int n from journal_entries where source_id in (${inList([paid?.id, ...pays.map((p) => p.id)])})`);
  const ft = one(`select count(*)::int n from financial_transactions where notes like ${lit(`%${pays[0]?.id ?? "x"}%`)}`);
  check("…no receipt link, no financial transaction, no journal entry (declaration ≠ collection)", rl.n === 0 && je.n === 0 && ft.n === 0, JSON.stringify({ rl, je, ft }));

  // Re-import of the same file → skipped, nothing new.
  const before = one(`select count(*)::int n from store_orders o join partners p on p.id = o.partner_id where p.name in (${inList(orderRows.map((r) => r.customerName))})`).n;
  const again = await importFile(T.sales, CO, "STORE_ORDERS", orderRows, ORDER_FIELDS);
  check(
    "re-import of the same rows → preview says skipped (already imported), run created 0 / skipped 2",
    again.run?.j?.summary?.created === 0 && again.run?.j?.summary?.skipped === 2,
    JSON.stringify({ preview: again.validate?.j?.summary, run: again.run?.j?.summary }),
  );
  const after = one(`select count(*)::int n from store_orders o join partners p on p.id = o.partner_id where p.name in (${inList(orderRows.map((r) => r.customerName))})`).n;
  check("no new store order rows after the re-import", after === before, `${before} → ${after}`);

  // Agent sales imports (agent from the token; "Agent" column ignored).
  const AG = "/agent-portal/imports";
  const al = await importFile(
    T.agSales,
    AG,
    "LEADS",
    [{ customerName: `${TAG} Agent Lead`, mobileNumber: localSa(newPhone()), countryName: SA.name, city: CITY, Agent: "Other agent" }],
    LEAD_FIELDS,
  );
  check("agent sales: lead import (agent.leads.import) → created 1", al.create.s === 201 && al.run?.j?.summary?.created === 1, brief(al.run ?? al.create));
  const alead = one(`select agent_id, sales_employee_id, import_row_key from leads where customer_name = ${lit(`${TAG} Agent Lead`)}`);
  check(
    "agent-imported lead belongs to the agent from the token and to the importing agent user",
    alead?.agent_id === F.agent.id && alead?.sales_employee_id === F.agent.salesUserId,
    JSON.stringify(alead),
  );
  const ao = await importFile(
    T.agSales,
    AG,
    "STORE_ORDERS",
    [
      {
        orderDate: TODAY, customerName: `${TAG} Agent Imp`, customerPhone: localSa(newPhone()), countryName: SA.name, city: CITY,
        address: "Agent imp street", productSku: F.agent.productSku, quantity: "1", unitPrice: "500", currencyCode, Agent: "Other agent",
      },
    ],
    ORDER_FIELDS,
  );
  check("agent sales: store-order import (agent.orders.import) → created 1", ao.create.s === 201 && ao.run?.j?.summary?.created === 1, brief(ao.run ?? ao.create));
  const aord = one(`select o.agent_id, o.employee_id, o.creation_idempotency_key from store_orders o join partners p on p.id = o.partner_id where p.name = ${lit(`${TAG} Agent Imp`)}`);
  check(
    "agent-imported order: agent from the token, owner = importer, keyed agent-order:<agent>:import:<sha>",
    aord?.agent_id === F.agent.id && aord?.employee_id === F.agent.salesUserId && /^agent-order:.*:import:/.test(aord?.creation_idempotency_key ?? ""),
    JSON.stringify(aord),
  );
  J2.agentJob = ao.jobId;

  // Google Sheets: service-account address; connection ownership refusals with fake spreadsheet ids.
  const gc = await call(T.sales, "GET", `${CO}/google-sheets/connections`);
  check(
    "connect step shows the OMS service-account address (share as Viewer, never public)",
    gc.s === 200 && /@.+\.iam\.gserviceaccount\.com$/.test(gc.j?.serviceAccountEmail ?? ""),
    `${gc.s} email=${gc.j?.serviceAccountEmail ? "<service account>" : "none"}`,
  );
  const fakeOwned = `r15fake${tagLower}owned0000000000000000`;
  const fakeSync = `r15fake${tagLower}sync00000000000000000`;
  const fakeFree = `r15fake${tagLower}free00000000000000000`;
  psql(`insert into import_sheet_connections (id, spreadsheet_id, title, owner_user_id, agent_id, created_at, updated_at, created_by)
        values (gen_random_uuid(), ${lit(fakeOwned)}, 'R15 fake sheet (owned by r15-sales2)', ${lit(uid("sales2"))}, null, now(), now(), ${lit(uid("sales2"))})`);
  psql(`insert into sync_source_configs (id, source_type, label, spreadsheet_id, enabled, created_at, updated_at, created_by)
        values (gen_random_uuid(), 'STORE_ORDERS', ${lit(`R15 fake sync ${TAG}`)}, ${lit(fakeSync)}, false, now(), now(), ${lit(uid("admin"))})`);
  try {
    const job = await call(T.sales, "POST", `${CO}/jobs`, { importType: "STORE_ORDERS" });
    const g1 = await call(T.sales, "POST", `${CO}/jobs/${job.j?.id}/google-sheets`, {
      url: `https://docs.google.com/spreadsheets/d/${fakeOwned}/edit#gid=0`,
    });
    check(
      "a sheet connected by another user → 409 SHEET_CONNECTED_BY_ANOTHER_USER",
      g1.s === 409 && errCode(g1.j) === "SHEET_CONNECTED_BY_ANOTHER_USER",
      brief(g1),
    );
    const g2 = await call(T.sales, "POST", `${CO}/jobs/${job.j?.id}/google-sheets`, {
      url: `https://docs.google.com/spreadsheets/d/${fakeSync}/edit#gid=0`,
    });
    check(
      "a sheet read by a continuous sync source → 400 SHEET_SYNCHRONISED (one ingestion path)",
      g2.s === 400 && errCode(g2.j) === "SHEET_SYNCHRONISED",
      brief(g2),
    );
    const ajob = await call(T.agSales, "POST", `${AG}/jobs`, { importType: "STORE_ORDERS" });
    const g3 = await call(T.agSales, "POST", `${AG}/jobs/${ajob.j?.id}/google-sheets`, {
      url: `https://docs.google.com/spreadsheets/d/${fakeOwned}/edit#gid=0`,
    });
    check(
      "agent: a sheet owned by a company user → 409 SHEET_CONNECTED_BY_ANOTHER_USER",
      g3.s === 409 && errCode(g3.j) === "SHEET_CONNECTED_BY_ANOTHER_USER",
      brief(g3),
    );
    const g4 = await call(T.sales, "POST", `${CO}/jobs/${job.j?.id}/google-sheets`, {
      url: `https://docs.google.com/spreadsheets/d/${fakeFree}/edit#gid=0`,
    });
    const created = one(`select count(*)::int n from import_sheet_connections where spreadsheet_id = ${lit(fakeFree)}`).n;
    check(
      "an unreadable (non-existent / not shared) sheet → clear 4xx error, no connection claimed",
      g4.s >= 400 && g4.s < 500 && created === 0,
      `${brief(g4)} connections=${created}`,
    );
    info("Google Sheets real-sheet path", "not verifiable locally (no sheet shared with the service account) — ownership / sync refusals verified with fake spreadsheet ids");
  } finally {
    psql(`update sync_source_configs set deleted_at = now() where spreadsheet_id = ${lit(fakeSync)}`);
    psql(`update import_sheet_connections set revoked_at = now() where spreadsheet_id = ${lit(fakeOwned)}`);
  }
});

await run("J3", "Import refusals and ownership columns", async () => {
  const CO = "/import-center";
  const r1 = await call(T.sales2, "POST", `${CO}/jobs`, { importType: "STORE_ORDERS" });
  check("r15-sales2 (no store-orders.import) → 403", r1.s === 403, brief(r1));
  const r2 = await call(T.sales2, "POST", `${CO}/jobs`, { importType: "LEADS" });
  check("r15-sales2 (no crm.leads.import) → 403", r2.s === 403, brief(r2));
  const r3 = await call(T.sales, "POST", `${CO}/jobs`, { importType: "PRODUCTS" });
  check("r15-sales: administrator types (PRODUCTS) stay behind import-center.manage → 403", r3.s === 403, brief(r3));
  if (J2.companyOrderJob) {
    for (const k of ["sales2", "manager", "viewall"]) {
      const g = await call(T[k], "GET", `${CO}/jobs/${J2.companyOrderJob}`);
      check(`r15-${k} cannot read r15-sales's job → 404`, g.s === 404, `${g.s}`);
    }
    const run2 = await call(T.manager, "POST", `${CO}/jobs/${J2.companyOrderJob}/run`);
    check("another user cannot run the job → 404", run2.s === 404, `${run2.s}`);
    const lst = await call(T.sales2, "GET", `${CO}/jobs`);
    check("another user's job list never includes it", !list(lst.j).some((j) => j.id === J2.companyOrderJob), `${lst.s}`);
    const ag = await call(T.agSales, "GET", `/agent-portal/imports/jobs/${J2.companyOrderJob}`);
    check("agent user cannot read a company job → 404", ag.s === 404, `${ag.s}`);
  }
  if (J2.agentJob) {
    const co = await call(T.admin, "GET", `${CO}/jobs/${J2.agentJob}`);
    check("company endpoint never returns an agent job (even super admin) → 404", co.s === 404, `${co.s}`);
    const aa = await call(T.agAdmin, "GET", `/agent-portal/imports/jobs/${J2.agentJob}`);
    check("agent admin cannot read the agent sales user's job (creator only) → 404", aa.s === 404, `${aa.s}`);
  }
  // Owner column without the right to assign → row rejected (never silently reassigned).
  const owner = await importFile(
    T.sales,
    CO,
    "LEADS",
    [
      { customerName: `${TAG} Lead Own2`, mobileNumber: localSa(newPhone()), countryName: SA.name },
      { customerName: `${TAG} Lead Other`, mobileNumber: localSa(newPhone()), countryName: SA.name, agentEmail: EMAIL("sales2") },
    ],
    LEAD_FIELDS,
  );
  check(
    "company Owner column naming a colleague (importer cannot assign) → row rejected 'cannot assign records'",
    owner.run?.j?.summary?.created === 1 && owner.run?.j?.summary?.rejected === 1 && /cannot assign records/i.test(JSON.stringify(owner.validate?.j?.errors ?? [])),
    JSON.stringify({ summary: owner.run?.j?.summary, errors: owner.validate?.j?.errors })?.slice(0, 400),
  );
  check(
    "the rejected lead does not exist; nothing assigned to r15-sales2",
    one(`select count(*)::int n from leads where customer_name = ${lit(`${TAG} Lead Other`)}`).n === 0,
    "",
  );
  const aown = await importFile(
    T.agSales,
    "/agent-portal/imports",
    "LEADS",
    [{ customerName: `${TAG} Agent Lead Other`, mobileNumber: localSa(newPhone()), countryName: SA.name, agentEmail: EMAIL("agent-admin") }],
    LEAD_FIELDS,
  );
  check(
    "agent sales Owner column naming the agent admin (no agent.records.assign) → row rejected",
    aown.run?.j?.summary?.created === 0 && aown.run?.j?.summary?.rejected === 1,
    JSON.stringify({ summary: aown.run?.j?.summary, errors: aown.validate?.j?.errors })?.slice(0, 400),
  );
  // Agent without the import key: the admin delegates? → use the company token on the agent route.
  const noKey = await call(T.sales, "POST", "/agent-portal/imports/jobs", { importType: "LEADS" });
  check("company token on the agent import route → refused", refused(noKey.s), `${noKey.s}`);
});

// ═════════════════════════ J5 Agent shipping agreement ═════════════════════════
await run("J5", "Agent shipping agreement lifecycle", async () => {
  // A dedicated agent per run (activation / replace-from depend on dates in force).
  const ag = await ensureAgent(`R15 J5 Agent ${TAG}`, `r15-j5`, {
    withUsers: true,
    fresh: true,
    rates: [{ service: "COD_CARRIER", countryId: SA.id, amount: 55 }],
  });
  F.j5AgentId = ag.id;
  const old = one(`select id, agreement_number, effective_from from agent_shipping_agreements where id = ${lit(ag.shippingAgreementId)}`);
  check("J5 agent: base shipping agreement ACTIVE from 2026-01-01", !!old, JSON.stringify(old));
  const P = `/agents/${ag.id}/shipping-agreements`;
  const d = await call(T.finance, "POST", P, { effectiveFrom: TODAY, notes: `${TAG} J5` });
  check("finance (agents.agreements.manage) creates a DRAFT, number generated", d.s === 201 && d.j?.status === "DRAFT" && !!(d.j?.agreementNumber ?? d.j?.number), brief(d));
  const draftId = d.j?.id;
  const number = d.j?.agreementNumber ?? d.j?.number;
  context.j5Agreement = number;
  for (const [rate, label] of [
    [{ service: "COD_CARRIER", countryId: SA.id, amount: 60 }, "COD_CARRIER Saudi Arabia 60"],
    [{ service: "COD_INTERNAL_COURIER", countryId: SA.id, city: CITY, amount: 40 }, "COD_INTERNAL_COURIER Riyadh 40"],
    [{ service: "PREPAID_CARRIER", amount: 70 }, "PREPAID_CARRIER all destinations 70"],
  ]) {
    const r = await call(T.finance, "POST", `${P}/${draftId}/rates`, rate);
    check(`rate added: ${label}`, ok2(r.s), brief(r));
  }
  const dup = await call(T.finance, "POST", `${P}/${draftId}/rates`, { service: "COD_INTERNAL_COURIER", countryId: SA.id, city: CITY.toLowerCase(), amount: 41 });
  check("duplicate rate (same service + destination, case-insensitive city) → refused", dup.s >= 400 && dup.s < 500, brief(dup));
  const g = await call(T.finance, "GET", `${P}/${draftId}`);
  check(
    "agreement detail shows the 3 rates and a coverage report (missing combinations listed)",
    g.s === 200 && (g.j?.rates?.length ?? 0) === 3 && JSON.stringify(g.j).match(/coverage/i),
    `${g.s} rates=${g.j?.rates?.length} keys=${Object.keys(g.j ?? {}).join(",")}`,
  );
  const a1 = await call(T.finance, "POST", `${P}/${draftId}/activate`, {});
  check(
    "activate without replaceFrom → 409 SHIPPING_AGREEMENT_OVERLAP naming the agreement in force",
    a1.s === 409 && errCode(a1.j) === "SHIPPING_AGREEMENT_OVERLAP" && jsonHas(a1.j, old?.agreement_number),
    brief(a1),
  );
  const a2 = await call(T.finance, "POST", `${P}/${draftId}/activate`, { replaceFrom: true });
  check("activate with replaceFrom → ACTIVE", ok2(a2.s), brief(a2));
  const st = rows(`select id, status, to_char(effective_from,'YYYY-MM-DD') efrom, to_char(effective_to,'YYYY-MM-DD') eto, supersedes_id from agent_shipping_agreements where agent_id = ${lit(ag.id)} and deleted_at is null order by created_at`);
  const nw = st.find((x) => x.id === draftId);
  const od = st.find((x) => x.id === old?.id);
  check(
    `replace-from closed the previous agreement the day before (${YESTERDAY}) and linked it`,
    nw?.status === "ACTIVE" && od?.eto === YESTERDAY && nw?.supersedes_id === old?.id,
    JSON.stringify(st),
  );

  const base = (extra = {}) => ({
    pricingMode: "SHIPPING_ADDED",
    lines: [{ productId: ag.productId, quantity: 1, lineAmount: 1000 }],
    fulfillmentMethod: "SHIPPING",
    paymentType: "CASH_ON_DELIVERY",
    countryId: SA.id,
    city: CITY,
    address: "J5 street",
    ...extra,
  });
  const q = await call(ag.tokens.sales, "POST", "/agent-portal/orders/quote", base());
  check("quote prices from the new agreement (carrier estimate 60 while the method is unknown)", q.s === 200 && near(q.j?.shipping?.charge, 60) && q.j?.agentShippingCharge?.shippingAgreementNumber === number, brief(q));
  const c = await call(ag.tokens.sales, "POST", "/agent-portal/orders", {
    ...base(),
    customer: { name: `${TAG} J5 customer`, mobile: newPhone(), countryId: SA.id, city: CITY, address: "J5 street" },
    idempotencyKey: `${TAG}-j5-1`,
  });
  check("agent order created → 201", c.s === 201, brief(c));
  const snap = () => {
    const r = one(`select agent_terms_snapshot->'agentShippingCharge' s, shipping_pricing_status st, shipping_charge c from store_orders where id = ${lit(c.j?.id)}`);
    return r ? { ...r.s, status: r.st, orderShippingCharge: r.c } : null;
  };
  const s0 = snap();
  check(
    "snapshot: agreement number + PENDING_METHOD 60 with byChannel CARRIER 60 / INTERNAL_COURIER 40",
    s0?.shippingAgreementNumber === number && s0?.status === "PENDING_METHOD" && near(s0?.amount, 60) && JSON.stringify(s0?.byChannel ?? "").includes("40"),
    JSON.stringify(s0)?.slice(0, 400),
  );
  const agAssign = await call(ag.tokens.admin, "POST", `/store-orders/${c.j?.id}/shipments/shipping-company`, { shippingCompanyId: F.carrierId });
  check("agent admin cannot assign the carrier (3.6) → refused", refused(agAssign.s), `${agAssign.s}`);
  const sc = await call(T.shipping, "POST", `/store-orders/${c.j?.id}/shipments/shipping-company`, { shippingCompanyId: F.carrierId });
  check("r15-shipping assigns the external carrier → 200", sc.s === 200, brief(sc));
  const s1 = snap();
  check("agent shipping charge CONFIRMED 60 (COD_CARRIER) from the frozen snapshot", s1?.status === "CONFIRMED" && near(s1?.amount, 60), JSON.stringify(s1)?.slice(0, 300));
  // The carrier-assigned order as the agent sees it (scanned by the J1 leak sweep: no carrier cost / margin).
  const agView = await call(ag.tokens.sales, "GET", `/agent-portal/orders/${c.j?.id}`);
  check("agent sales opens its carrier-assigned order (agreed charge 60 shown)", agView.s === 200 && JSON.stringify(agView.j).includes("60"), `${agView.s}`);
  await call(ag.tokens.admin, "GET", `/agent-portal/orders/${c.j?.id}`);
  await call(ag.tokens.admin, "GET", "/agent-portal/statement/summary");
  await call(ag.tokens.admin, "GET", "/agent-portal/commission-report");
  const de = await call(T.finance, "POST", `${P}/${draftId}/deactivate`, {});
  check("deactivate without a reason → 400", de.s === 400, brief(de));
  const de2 = await call(T.finance, "POST", `${P}/${draftId}/deactivate`, { reason: `${TAG} acceptance` });
  check("deactivate with a reason → INACTIVE", ok2(de2.s) && one(`select status from agent_shipping_agreements where id = ${lit(draftId)}`).status === "INACTIVE", brief(de2));
  const q2 = await call(ag.tokens.sales, "POST", "/agent-portal/orders/quote", base());
  const c2 = await call(ag.tokens.sales, "POST", "/agent-portal/orders", {
    ...base(),
    customer: { name: `${TAG} J5 customer 2`, mobile: newPhone(), countryId: SA.id, city: CITY, address: "J5 street" },
    idempotencyKey: `${TAG}-j5-2`,
  });
  check(
    "new agent order refused with AGENT_SHIPPING_AGREEMENT_MISSING (quote + create), never a silent zero",
    /AGENT_SHIPPING_AGREEMENT_MISSING/.test(JSON.stringify(q2.j)) && c2.s >= 400 && /AGENT_SHIPPING_AGREEMENT_MISSING/.test(JSON.stringify(c2.j)),
    `${brief(q2)} | ${brief(c2)}`,
  );
  check("…the message tells the company where to activate one (Settings → Shipping agreement)", /Settings|الإعدادات/.test(JSON.stringify(c2.j)), "");
  const s2 = snap();
  check("the earlier order is unchanged (CONFIRMED 60, same agreement number)", JSON.stringify(s2) === JSON.stringify(s1), "");
  const me = await call(ag.tokens.admin, "GET", "/agent-portal/me");
  check("agent portal /me after deactivation: no shipping agreement in force today (null), never a stale one", me.s === 200 && me.j?.shippingAgreement == null, JSON.stringify(me.j?.shippingAgreement)?.slice(0, 300));
});

// ═════════════════════════ J7 Stock lifecycle ═════════════════════════
const J7 = {};
await run("J7", "Reservation → transit → delivery → back", async () => {
  const P7 = await freshStockedProduct("J7 stocked", 5, 25, 100);
  J7.product = P7;
  context.j7Product = P7.sku;
  const avail = async () => (await invStock(P7.id)).available;
  const s0 = await invStock(P7.id);
  check("stock API: on-hand 5, available 5 (STOCK warehouses only)", num(s0?.onHand) === 5 && num(s0?.available) === 5, JSON.stringify(s0));

  // A — reserved at creation.
  const A = await createCompanyOrder(T.sales, [{ productId: P7.id, quantity: 3, unitPrice: 100 }], { key: "j7-A" });
  check("order A (3 of 5) created", A.s === 201, brief(A));
  J7.A = A.j;
  let vA = await orderView(A.j.id);
  check("A: stockStatus RESERVED, line reserved 3 in WH-MAIN", vA?.stockStatus === "RESERVED" && num(vA?.lines?.[0]?.reserved) === 3, JSON.stringify(vA?.lines?.[0])?.slice(0, 300));
  check("available drops 5 → 2 immediately; on-hand unchanged (a reservation is not a sale)", num(await avail()) === 2 && sumAt(P7.id, WH["WH-MAIN"]) === 5, "");
  const resv = rows(`select type, quantity from inventory_movements where reference_type = 'STORE_ORDER' and reference_id = ${lit(A.j.id)}`);
  check("RESERVATION movement (STORE_ORDER:<order>) qty 3", resv.some((m) => m.type === "RESERVATION" && num(m.quantity) === 3), JSON.stringify(resv));

  // B — short.
  const B = await createCompanyOrder(T.sales, [{ productId: P7.id, quantity: 4, unitPrice: 10 }], { key: "j7-B" });
  J7.B = B.j;
  let vB = await orderView(B.j.id);
  check(
    "B (4, only 2 available): SHORT with INSUFFICIENT_STOCK (required 4, available 2); nothing reserved",
    vB?.stockStatus === "SHORT" && vB?.stockIssue?.code === "INSUFFICIENT_STOCK" && num(vB?.lines?.[0]?.reserved) === 0,
    JSON.stringify({ st: vB?.stockStatus, issue: vB?.stockIssue })?.slice(0, 300),
  );
  check("available unchanged (2) — never oversold", num(await avail()) === 2, "");
  const shB = await ship(B.j.id);
  check("dispatch of B refused STOCK_NOT_RESERVED", shB.s >= 400 && errCode(shB.j) === "STOCK_NOT_RESERVED", brief(shB));
  check(
    "the impossible status was not recorded (B's shipment has no SHIPPED status)",
    !rows(`select status from shipments where store_order_id = ${lit(B.j.id)} and deleted_at is null`).some((s) => s.status === "SHIPPED"),
    "",
  );

  // Dispatch A → transit, no JE, no payment.
  const jeBefore = one(`select count(*)::int n from journal_entries`).n;
  const ftBefore = one(`select count(*)::int n from financial_transactions`).n;
  const shA = await ship(A.j.id);
  check("r15-shipping dispatches A → 200", shA.s === 200, brief(shA));
  vA = await orderView(A.j.id);
  check("A: IN_TRANSIT, reserved 0, in transit 3", vA?.stockStatus === "IN_TRANSIT" && num(vA?.lines?.[0]?.inTransit) === 3 && num(vA?.lines?.[0]?.reserved) === 0, JSON.stringify(vA?.lines?.[0])?.slice(0, 300));
  const tr = rows(`select warehouse_id, quantity, type from inventory_movements where reference_type = 'STORE_ORDER_TRANSIT' and reference_id = ${lit(A.j.id)}`);
  check(
    "TRANSFER pair: −3 WH-MAIN / +3 WH-TRANSIT (reference STORE_ORDER_TRANSIT)",
    tr.some((m) => m.warehouse_id === WH["WH-MAIN"] && num(m.quantity) === -3 && m.type === "TRANSFER") &&
      tr.some((m) => m.warehouse_id === WH["WH-TRANSIT"] && num(m.quantity) === 3 && m.type === "TRANSFER"),
    JSON.stringify(tr),
  );
  const s1 = await invStock(P7.id);
  check("WH-MAIN on-hand 2, in transit 3, available still 2 (dispatch does not change available)", sumAt(P7.id, WH["WH-MAIN"]) === 2 && num(s1?.inTransit) === 3 && num(s1?.available) === 2, JSON.stringify(s1));
  check(
    "no journal entry and no financial transaction at dispatch; no payment row",
    one(`select count(*)::int n from journal_entries`).n === jeBefore &&
      one(`select count(*)::int n from financial_transactions`).n === ftBefore &&
      one(`select count(*)::int n from payments where store_order_id = ${lit(A.j.id)}`).n === 0,
    "",
  );

  // Deliver A → invoice for the shipment, SALES_DELIVERY out of transit, COGS = 3 × 25.
  const avg = num(one(`select current_cost from products where id = ${lit(P7.id)}`).current_cost);
  const dA = await deliver(A.j.id);
  check("r15-shipping delivers A → 200", dA.s === 200, brief(dA));
  const invA = invoicesOf(A.j.id);
  const shpA = one(`select id from shipments where store_order_id = ${lit(A.j.id)} and deleted_at is null order by created_at desc limit 1`);
  check("one CONFIRMED invoice linked to the delivered shipment, total 300", invA.length === 1 && invA[0].status === "CONFIRMED" && invA[0].shipment_id === shpA?.id && near(invA[0].grand_total, 300), JSON.stringify(invA));
  const sd = rows(`select warehouse_id, quantity from inventory_movements where type = 'SALES_DELIVERY' and reference_id = ${lit(invA[0]?.id)}`);
  check("SALES_DELIVERY −3 out of WH-TRANSIT", sd.length === 1 && sd[0].warehouse_id === WH["WH-TRANSIT"] && num(sd[0].quantity) === -3, JSON.stringify(sd));
  const jA = journalOf("SALES_INVOICE", invA[0]?.id);
  check("sales JE balanced", jA.balanced, `Dr ${jA.dr} Cr ${jA.cr}`);
  check(`COGS = qty × moving average = 3 × ${avg} = ${3 * avg} (EXPENSE Dr) and inventory credited the same`, near(jA.type("EXPENSE", "debit"), 3 * avg) && near(avg, 25), `COGS ${jA.type("EXPENSE", "debit")} avg ${avg}`);
  vA = await orderView(A.j.id);
  check("A: DELIVERED, postedCogs 75 (from the journal)", vA?.stockStatus === "DELIVERED" && near(vA?.postedCogs, 75), JSON.stringify({ st: vA?.stockStatus, cogs: vA?.postedCogs }));
  const mvTypes = new Set((vA?.movements ?? []).map((m) => m.type));
  check(
    "order stock view exposes the shipment with its lines and every movement (reservation, release, transfers, delivery) — 5.16",
    vA?.shipments?.[0]?.lines?.[0]?.deliveredQuantity === 3 &&
      ["RESERVATION", "RESERVATION_RELEASE", "TRANSFER", "SALES_DELIVERY"].every((t) => mvTypes.has(t)),
    JSON.stringify({ shipment: vA?.shipments?.[0]?.lines, types: [...mvTypes] })?.slice(0, 300),
  );
  check("owned stock reduced exactly once (WH-MAIN 2 + transit 0)", sumAt(P7.id, WH["WH-MAIN"]) + sumAt(P7.id, WH["WH-TRANSIT"]) === 2, "");

  // Reserve-now for B after a receipt; partial dispatch / partial acceptance on C.
  await openStock(P7, 5, 25);
  const rB = await call(T.sales, "POST", `/store-orders/${B.j.id}/stock/reserve`);
  vB = await orderView(B.j.id);
  check("'Reserve now' on B after the receipt → RESERVED (4)", ok2(rB.s) && vB?.stockStatus === "RESERVED" && num(vB?.lines?.[0]?.reserved) === 4, brief(rB));
  const C = await createCompanyOrder(T.sales, [{ productId: P7.id, quantity: 3, unitPrice: 100 }], { key: "j7-C" });
  J7.C = C.j;
  const itemC = itemsOf(C.j.id)[0];
  const shC = await ship(C.j.id, { lines: [{ storeOrderItemId: itemC.id, quantity: 2 }] });
  let vC = await orderView(C.j.id);
  check("partial dispatch 2 of 3 → in transit 2, reserved 1", shC.s === 200 && num(vC?.lines?.[0]?.inTransit) === 2 && num(vC?.lines?.[0]?.reserved) === 1, `${brief(shC)} ${JSON.stringify(vC?.lines?.[0])?.slice(0, 200)}`);
  const dC = await deliver(C.j.id, { deliveredLines: [{ storeOrderItemId: itemC.id, quantity: 1 }] });
  const invC = invoicesOf(C.j.id);
  check("partial acceptance 1 of 2 → invoice for the accepted quantity only (1 × 100)", dC.s === 200 && invC.length === 1 && near(invC[0].grand_total, 100), `${brief(dC)} ${JSON.stringify(invC)}`);
  vC = await orderView(C.j.id);
  check(
    "remainder stays in transit (RETURNING / PARTIALLY_DELIVERED): delivered 1, in transit 1, reserved 1",
    num(vC?.lines?.[0]?.delivered) === 1 && num(vC?.lines?.[0]?.inTransit) === 1 && ["PARTIALLY_DELIVERED", "RETURNING"].includes(vC?.stockStatus),
    JSON.stringify({ st: vC?.stockStatus, line: vC?.lines?.[0] })?.slice(0, 300),
  );
  const mainBeforeBack = sumAt(P7.id, WH["WH-MAIN"]);
  const key = randomUUID();
  const rbBody = { idempotencyKey: key, lines: [{ storeOrderItemId: itemC.id, quantity: 1, condition: "SALEABLE" }] };
  const rb1 = await call(T.shipping, "POST", `/store-orders/${C.j.id}/stock/receive-back`, rbBody);
  const mvCount = one(`select count(*)::int n from inventory_movements where reference_id = ${lit(C.j.id)}`).n;
  const rb2 = await call(T.shipping, "POST", `/store-orders/${C.j.id}/stock/receive-back`, rbBody);
  vC = await orderView(C.j.id);
  check(
    "receive-back SALEABLE → origin warehouse +1 and re-reserved for the order (reserved 2, in transit 0)",
    ok2(rb1.s) && sumAt(P7.id, WH["WH-MAIN"]) === mainBeforeBack + 1 && num(vC?.lines?.[0]?.reserved) === 2 && num(vC?.lines?.[0]?.inTransit) === 0,
    `${brief(rb1)} ${JSON.stringify(vC?.lines?.[0])?.slice(0, 200)}`,
  );
  check("same receipt replayed (same key) → no new movement", ok2(rb2.s) && one(`select count(*)::int n from inventory_movements where reference_id = ${lit(C.j.id)}`).n === mvCount, `${rb2.s}`);
  const rbSales = await call(T.sales, "POST", `/store-orders/${C.j.id}/stock/receive-back`, { idempotencyKey: randomUUID(), lines: [{ storeOrderItemId: itemC.id, quantity: 1, condition: "SALEABLE" }] });
  check("receive-back needs shipping.receive_returns (r15-sales → 403)", rbSales.s === 403, `${rbSales.s}`);

  // DAMAGED: B fails delivery → RETURNING → 3 saleable + 1 damaged.
  const shB2 = await ship(B.j.id);
  const fB = await call(T.shipping, "POST", `/store-orders/${B.j.id}/shipments/delivery-failed`);
  vB = await orderView(B.j.id);
  check("B dispatched then DELIVERY_FAILED → RETURNING, 4 still in transit, nothing released", ok2(shB2.s) && ok2(fB.s) && vB?.stockStatus === "RETURNING" && num(vB?.lines?.[0]?.inTransit) === 4, JSON.stringify({ st: vB?.stockStatus, line: vB?.lines?.[0] })?.slice(0, 300));
  const itemB = itemsOf(B.j.id)[0];
  const dmgBefore = sumAt(P7.id, WH["WH-DAMAGED"]);
  const rbB = await call(T.shipping, "POST", `/store-orders/${B.j.id}/stock/receive-back`, {
    idempotencyKey: randomUUID(),
    lines: [
      { storeOrderItemId: itemB.id, quantity: 3, condition: "SALEABLE" },
      { storeOrderItemId: itemB.id, quantity: 1, condition: "DAMAGED" },
    ],
  });
  check("receive-back 3 SALEABLE + 1 DAMAGED → 200", ok2(rbB.s), brief(rbB));
  check("DAMAGED unit → WH-DAMAGED (+1)", sumAt(P7.id, WH["WH-DAMAGED"]) === dmgBefore + 1, `${dmgBefore} → ${sumAt(P7.id, WH["WH-DAMAGED"])}`);
  const s2 = await invStock(P7.id);
  check("damaged stock never counts as available", num(s2?.damaged) >= 1 && num(s2?.available) === sumAt(P7.id, WH["WH-MAIN"]) - num(s2?.reserved), JSON.stringify(s2));
  const over = await call(T.shipping, "POST", `/store-orders/${B.j.id}/stock/receive-back`, { idempotencyKey: randomUUID(), lines: [{ storeOrderItemId: itemB.id, quantity: 1, condition: "SALEABLE" }] });
  check("receiving more than is in transit → RECEIVE_EXCEEDS_IN_TRANSIT", over.s >= 400 && errCode(over.j) === "RECEIVE_EXCEEDS_IN_TRANSIT", brief(over));

  // Cancel in transit: D shipped then archived → RETURNING until received; not re-reserved.
  await openStock(P7, 2, 25);
  const D = await createCompanyOrder(T.sales, [{ productId: P7.id, quantity: 1, unitPrice: 100 }], { key: "j7-D" });
  await ship(D.j.id);
  const transitBefore = sumAt(P7.id, WH["WH-TRANSIT"]);
  const mainBefore = sumAt(P7.id, WH["WH-MAIN"]);
  const arc = await call(T.admin, "POST", `/store-orders/${D.j.id}/archive`);
  const dRow = one(`select stock_status, deleted_at is not null archived from store_orders where id = ${lit(D.j.id)}`);
  check(
    "cancel (archive) in transit → order RETURNING (DB), goods stay in transit, warehouse unchanged, nothing released",
    ok2(arc.s) && dRow?.archived && dRow?.stock_status === "RETURNING" && sumAt(P7.id, WH["WH-TRANSIT"]) === transitBefore && sumAt(P7.id, WH["WH-MAIN"]) === mainBefore,
    `${arc.s} ${JSON.stringify(dRow)}`,
  );
  const vDget = await call(T.admin, "GET", `/store-orders/${D.j.id}/stock`);
  check("GET /store-orders/:id/stock on the cancelled (archived) order → 200 for super admin (5.16 visibility)", vDget.s === 200, brief(vDget));
  const itemD = itemsOf(D.j.id)[0];
  const rbD = await call(T.shipping, "POST", `/store-orders/${D.j.id}/stock/receive-back`, { idempotencyKey: randomUUID(), lines: [{ storeOrderItemId: itemD.id, quantity: 1, condition: "SALEABLE" }] });
  const dAfter = one(`select stock_status from store_orders where id = ${lit(D.j.id)}`);
  const dReserved = num(one(`select coalesce(sum(case when type = 'RESERVATION' then quantity when type = 'RESERVATION_RELEASE' then -quantity end), 0) r
    from inventory_movements where reference_type = 'STORE_ORDER' and reference_id = ${lit(D.j.id)}`)?.r);
  const back = check(
    "goods of the cancelled order received back (r15-shipping) → WH-MAIN +1, out of transit, NOT re-reserved",
    ok2(rbD.s) && sumAt(P7.id, WH["WH-MAIN"]) === mainBefore + 1 && sumAt(P7.id, WH["WH-TRANSIT"]) === transitBefore - 1,
    `${brief(rbD)} after=${JSON.stringify(dAfter)} reservedLedger=${dReserved}`,
  );
  if (!back && (rbD.s === 404 || vDget.s === 404))
    defect({
      title: "Goods of an order cancelled in transit can never be received back (receive-back / stock view 404 on archived orders)",
      endpoint: "POST /store-orders/:id/stock/receive-back, GET /store-orders/:id/stock",
      persona: "r15-shipping (shipping.receive_returns, store-orders.view_all) and r15-admin (super admin)",
      request: `archive ${D.j.internalOrderId} after SHIPPED, then receive-back {lines:[{storeOrderItemId, quantity:1, condition:SALEABLE}]}`,
      expected: "D15-8 / spec W5a §5: quantities stay in transit as RETURNING and are received back (saleable → origin, not re-reserved for a cancelled order)",
      actual: `${rbD.s} ${JSON.stringify(rbD.j)}; GET stock ${vDget.s}; DB stock_status ${dAfter?.stock_status}, 1 unit still in WH-TRANSIT`,
      suspectedFile:
        "apps/api/src/store-orders/stock-lifecycle/store-order-stock.controller.ts (view / receiveBack call salesScope.assertCanOpenStoreOrder → sales-scope.service.ts assertStoreOrderAccessById filters deletedAt: null, so archived orders are 404 before StoreOrderStockService.receiveBack, which itself supports archived orders)",
    });
  const tc = await call(T.admin, "GET", `/traceability/store_order/${A.j.id}`);
  const mvGroup = tc.j?.groups?.find((x) => x.key === "STOCK_MOVEMENTS");
  check("traceability lists reservation, transfer and delivery movements for A", tc.s === 200 && mvGroup?.state === "FOUND" && (mvGroup?.items?.length ?? 0) >= 4, JSON.stringify(mvGroup?.items?.map((i) => i.status))?.slice(0, 300));
});

// ═════════════════════════ J8 Collections ═════════════════════════
const J8 = {};
await run("J8", "Prepaid and COD collection timing", async () => {
  const P8 = J7.product ?? (await freshStockedProduct("J8 stocked", 0, 25, 100));
  await openStock(P8, 6, 25);
  // Prepaid: declaration ≠ collection; verification = advance before delivery.
  const E = await createCompanyOrder(T.sales, [{ productId: P8.id, quantity: 1, unitPrice: 200 }], { key: "j8-E", paymentType: "PREPAID" });
  check("prepaid order E created (reserved regardless of payment)", E.s === 201 && (await orderView(E.j.id))?.stockStatus === "RESERVED", brief(E));
  J8.E = E.j;
  const dec = await call(T.sales, "POST", `/store-orders/${E.j.id}/payment-declaration`, {
    kind: "FULL",
    paymentMethodId: F.bankMethodId,
    currencyId: SAR,
    paymentDate: TODAY,
    referenceNumber: `${TAG}-E`,
    idempotencyKey: `${TAG}-E-decl`,
  });
  const payE = one(`select id, status, origin from payments where store_order_id = ${lit(E.j.id)} and deleted_at is null`);
  check("salesperson declares FULL → one PENDING claim", ok2(dec.s) && payE?.status === "PENDING", brief(dec));
  check(
    "declaration posts nothing (no receipt link, no JE for the order / payment)",
    one(`select count(*)::int n from payment_receipt_links where payment_id = ${lit(payE?.id)}`).n === 0 &&
      one(`select count(*)::int n from journal_entries where source_id in (${inList([E.j.id, payE?.id])})`).n === 0,
    "",
  );
  let mE = (await call(T.finance, "GET", `/store-orders/${E.j.id}/money`)).j;
  check("money panel: declared 200, collected 0", near(mE?.figures?.declared, 200) && near(mE?.figures?.collected, 0), JSON.stringify(mE?.figures));
  const vf = await call(T.finance, "POST", `/payments/${payE?.id}/confirm`);
  const link = one(`select financial_transaction_id ft from payment_receipt_links where payment_id = ${lit(payE?.id)}`);
  check("finance verifies → VERIFIED, one CUSTOMER_RECEIPT", ok2(vf.s) && !!link?.ft, brief(vf));
  const rj = journalOf("CUSTOMER_RECEIPT", link?.ft);
  check("receipt JE balanced, Dr bank 200", rj.balanced && near(rj.side(settings.bank_account_id, "debit"), 200), `Dr ${rj.dr} Cr ${rj.cr}`);
  check("before delivery the receipt is an unallocated advance", one(`select count(*)::int n from financial_transaction_allocations where transaction_id = ${lit(link?.ft)}`).n === 0, "");
  mE = (await call(T.finance, "GET", `/store-orders/${E.j.id}/money`)).j;
  check("prepaid-before-delivery: collected 200, invoiced 0, balance due 0, refund due 0", near(mE?.figures?.collected, 200) && near(mE?.figures?.invoiced, 0) && near(mE?.figures?.balanceDue, 0) && near(mE?.figures?.refundDue, 0), JSON.stringify(mE?.figures));
  await ship(E.j.id);
  await deliver(E.j.id);
  const invE = invoicesOf(E.j.id);
  const alloc = one(`select coalesce(sum(allocated_amount),0) a from financial_transaction_allocations where sales_invoice_id = ${lit(invE[0]?.id)}`);
  check("at delivery the advance is allocated to the shipment's invoice (200)", invE.length === 1 && near(alloc?.a, 200), JSON.stringify({ invE, alloc }));
  check("still exactly one receipt for the payment (cash recognised once)", one(`select count(*)::int n from payment_receipt_links where payment_id = ${lit(payE?.id)}`).n === 1, "");
  mE = (await call(T.finance, "GET", `/store-orders/${E.j.id}/money`)).j;
  check("after delivery: invoiced 200, collected 200, balance due 0", near(mE?.figures?.invoiced, 200) && near(mE?.figures?.balanceDue, 0), JSON.stringify(mE?.figures));

  // COD via carrier with a COD method.
  const Fo = await createCompanyOrder(T.sales, [{ productId: P8.id, quantity: 1, unitPrice: 120 }], { key: "j8-F" });
  J8.F = Fo.j;
  const sc = await call(T.shipping, "POST", `/store-orders/${Fo.j.id}/shipments/shipping-company`, { shippingCompanyId: F.carrierId });
  check("COD order F: r15-shipping assigns R15 Carrier (COD method)", sc.s === 200, brief(sc));
  const ftBefore = one(`select count(*)::int n from financial_transactions`).n;
  await ship(Fo.j.id);
  const dF = await deliver(Fo.j.id);
  check("F delivered → 200", dF.s === 200, brief(dF));
  let payF = rows(`select id, status, origin, amount, payment_method_id from payments where store_order_id = ${lit(Fo.j.id)} and deleted_at is null`);
  check(
    "delivery → one PENDING CARRIER_COD claim for 120 on the carrier's COD method",
    payF.length === 1 && payF[0].status === "PENDING" && payF[0].origin === "CARRIER_COD" && near(payF[0].amount, 120) && payF[0].payment_method_id === F.codMethodId,
    JSON.stringify(payF),
  );
  check(
    "no cash posted at dispatch / delivery (no receipt, no new financial transaction besides none)",
    one(`select count(*)::int n from payment_receipt_links where payment_id in (${inList(payF.map((p) => p.id))})`).n === 0 &&
      one(`select count(*)::int n from financial_transactions where type = 'CUSTOMER_RECEIPT' and created_at >= ${lit(START)}::timestamptz and notes like ${lit(`%${payF[0]?.id}%`)}`).n === 0,
    `financial transactions ${ftBefore} → ${one(`select count(*)::int n from financial_transactions`).n}`,
  );
  let mF = (await call(T.finance, "GET", `/store-orders/${Fo.j.id}/money`)).j;
  check(
    "delivery-before-settlement: tracking TRACKED, expected from carrier 120, invoiced 120, collected 0, balance due 120",
    mF?.codCollection?.tracking === "TRACKED" && near(mF?.figures?.expectedFromCarrier, 120) && near(mF?.figures?.invoiced, 120) && near(mF?.figures?.collected, 0) && near(mF?.figures?.balanceDue, 120),
    JSON.stringify({ cod: mF?.codCollection, f: mF?.figures }),
  );
  const direct = await call(T.finance, "POST", `/payments/${payF[0]?.id}/confirm`);
  check("direct Finance confirm of the reconciled COD claim → 409 (must be matched to the carrier's statement)", direct.s === 409, brief(direct));
  // The carrier's COD report = a statement line of the method; matching posts Dr clearing / Cr AR.
  const line = await call(T.admin, "POST", `/payment-reconciliation/methods/${F.codMethodId}/lines`, {
    amount: 120,
    currencyId: SAR,
    transactionDate: TODAY,
    orderReference: Fo.j.internalOrderId,
    providerReference: `${TAG}-COD-F`,
  });
  check("carrier COD report line recorded on the method's statement", ok2(line.s), brief(line));
  const lineId = one(`select id from payment_statement_lines where import_id = ${lit(line.j?.importId)} order by created_at limit 1`)?.id;
  const mkey = `${TAG}-match-F`;
  const match = await call(T.admin, "POST", `/payment-reconciliation/methods/${F.codMethodId}/matches`, {
    statementLineId: lineId,
    allocations: [{ paymentId: payF[0]?.id, amount: 120 }],
    idempotencyKey: mkey,
  });
  check("match confirmed → 200", ok2(match.s), brief(match));
  await call(T.admin, "POST", `/payment-reconciliation/methods/${F.codMethodId}/matches`, {
    statementLineId: lineId,
    allocations: [{ paymentId: payF[0]?.id, amount: 120 }],
    idempotencyKey: mkey,
  });
  const linkF = rows(`select financial_transaction_id ft from payment_receipt_links where payment_id = ${lit(payF[0]?.id)}`);
  const rF = journalOf("CUSTOMER_RECEIPT", linkF[0]?.ft);
  check("one receipt (replayed match adds none); Dr COD clearing (receivable from carrier) 120, balanced", linkF.length === 1 && rF.balanced && near(rF.side(F.codAccountId, "debit"), 120), `links=${linkF.length} Dr ${rF.dr} Cr ${rF.cr}`);
  mF = (await call(T.finance, "GET", `/store-orders/${Fo.j.id}/money`)).j;
  check("after the match: collected 120 (with carrier / awaiting settlement), balance due 0", near(mF?.figures?.collected, 120) && near(mF?.figures?.balanceDue, 0), JSON.stringify(mF?.figures));
});

// ═════════════════════════ J9 Prepaid return ═════════════════════════
await run("J9", "Prepaid return, credit note and refund", async () => {
  const P9 = J7.product ?? (await freshStockedProduct("J9 stocked", 0, 25, 100));
  await openStock(P9, 4, 25);
  const G = await createCompanyOrder(T.sales, [{ productId: P9.id, quantity: 2, unitPrice: 100 }], { key: "j9-G", paymentType: "PREPAID" });
  check("prepaid order G (2 × 100) created", G.s === 201, brief(G));
  await call(T.sales, "POST", `/store-orders/${G.j.id}/payment-declaration`, { kind: "FULL", paymentMethodId: F.bankMethodId, currencyId: SAR, paymentDate: TODAY, idempotencyKey: `${TAG}-G-decl` });
  const payG = one(`select id from payments where store_order_id = ${lit(G.j.id)} and deleted_at is null`);
  const cf = await call(T.finance, "POST", `/payments/${payG?.id}/confirm`);
  check("G paid (declared + verified)", ok2(cf.s), brief(cf));
  await ship(G.j.id);
  await deliver(G.j.id);
  const invG = invoicesOf(G.j.id);
  check("G delivered → invoice 200", invG.length === 1 && near(invG[0].grand_total, 200), JSON.stringify(invG));
  const line = one(`select id from sales_invoice_items where sales_invoice_id = ${lit(invG[0]?.id)} limit 1`);
  const mainBefore = sumAt(P9.id, WH["WH-MAIN"]);
  const rkey = `${TAG}-G-ret`;
  const rq = await call(T.finance, "POST", `/store-orders/${G.j.id}/returns`, { reason: "Customer changed mind (R15 acceptance)", lines: [{ salesInvoiceItemId: line?.id, quantity: 1 }], idempotencyKey: rkey });
  const ret = rq.j?.returns?.[0];
  check("return requested → DRAFT sales return linked to the order, reason kept", ok2(rq.s) && ret?.status === "DRAFT", brief(rq));
  check(
    "a request moves no stock and posts nothing",
    sumAt(P9.id, WH["WH-MAIN"]) === mainBefore && one(`select count(*)::int n from journal_entries where source_id = ${lit(ret?.id)}`).n === 0,
    "",
  );
  const rq2 = await call(T.finance, "POST", `/store-orders/${G.j.id}/returns`, { reason: "Customer changed mind (R15 acceptance)", lines: [{ salesInvoiceItemId: line?.id, quantity: 1 }], idempotencyKey: rkey });
  check("replayed request (same key) → same return", ok2(rq2.s) && rq2.j?.returns?.[0]?.id === ret?.id, brief(rq2));
  const rcv = await call(T.finance, "POST", `/store-orders/${G.j.id}/returns/${ret?.id}/receive`, { lines: [{ salesReturnItemId: ret?.items?.[0]?.id, condition: "SALEABLE" }] });
  check("receive & inspect (SALEABLE) → CONFIRMED", ok2(rcv.s) && (rcv.j?.status ?? rcv.j?.salesReturn?.status) === "CONFIRMED", brief(rcv));
  check("saleable unit back in stock (WH-MAIN +1)", sumAt(P9.id, WH["WH-MAIN"]) === mainBefore + 1, `${mainBefore} → ${sumAt(P9.id, WH["WH-MAIN"])}`);
  const cn = journalOf("SALES_RETURN", ret?.id);
  check(
    "credit note JE balanced: revenue reversed (Dr 100) and COGS reversed at the invoice cost (Cr 25 / Dr inventory 25)",
    cn.balanced && near(cn.type("REVENUE", "debit") + cn.type("INCOME", "debit"), 100) && near(cn.type("EXPENSE", "credit"), 25),
    JSON.stringify({ dr: cn.dr, cr: cn.cr, rev: cn.type("REVENUE", "debit"), cogs: cn.type("EXPENSE", "credit") }),
  );
  let mG = (await call(T.finance, "GET", `/store-orders/${G.j.id}/money`)).j;
  check("refund due 100 shown; refunded 0 (a credit note is not a refund)", near(mG?.figures?.refundDue, 100) && near(mG?.figures?.refunded, 0), JSON.stringify(mG?.figures));
  check("recognition status PARTIALLY_RETURNED", one(`select recognition_status from store_orders where id = ${lit(G.j.id)}`).recognition_status === "PARTIALLY_RETURNED", "");
  const fkey = `${TAG}-G-refund`;
  const rf = await call(T.finance, "POST", `/financial-transactions/refunds/store-orders/${G.j.id}`, { amount: 100, receivingAccountId: F.bankReceivingAccountId, referenceNumber: `${TAG}-BANK`, idempotencyKey: fkey });
  check("record refund 100 → CONFIRMED money-out document", ok2(rf.s) && rf.j?.status === "CONFIRMED", brief(rf));
  const rfj = journalOf("CUSTOMER_REFUND", rf.j?.id);
  check("refund JE balanced: Cr bank 100", rfj.balanced && near(rfj.type("ASSET", "credit"), 100), `Dr ${rfj.dr} Cr ${rfj.cr}`);
  mG = (await call(T.finance, "GET", `/store-orders/${G.j.id}/money`)).j;
  check("refund due 0, refunded 100", near(mG?.figures?.refundDue, 0) && near(mG?.figures?.refunded, 100), JSON.stringify(mG?.figures));
  const rf2 = await call(T.finance, "POST", `/financial-transactions/refunds/store-orders/${G.j.id}`, { amount: 100, receivingAccountId: F.bankReceivingAccountId, idempotencyKey: fkey });
  check("replayed refund (same key) → same document", ok2(rf2.s) && rf2.j?.id === rf.j?.id, brief(rf2));
  const rf3 = await call(T.finance, "POST", `/financial-transactions/refunds/store-orders/${G.j.id}`, { amount: 1, receivingAccountId: F.bankReceivingAccountId, idempotencyKey: `${TAG}-G-refund-2` });
  check("a second refund is refused (REFUND_EXCEEDS_DUE)", rf3.s >= 400 && errCode(rf3.j) === "REFUND_EXCEEDS_DUE", brief(rf3));

  // RETURN_PENDING cleared — reachable through the API via a pickup order (COLLECTED → RETURNED).
  const H = await createCompanyOrder(T.sales, [{ productId: P9.id, quantity: 1, unitPrice: 80 }], { key: "j9-H", paymentType: "PREPAID", fulfillmentMethod: "PICKUP" });
  check("prepaid pickup order H created", H.s === 201, brief(H));
  const p1 = await call(T.sales, "POST", `/store-orders/${H.j.id}/pickup/READY_FOR_PICKUP`);
  const p2 = await call(T.sales, "POST", `/store-orders/${H.j.id}/pickup/COLLECTED`);
  const p3 = await call(T.sales, "POST", `/store-orders/${H.j.id}/pickup/RETURNED`);
  check("pickup READY → COLLECTED (no payment gate) → RETURNED", ok2(p1.s) && ok2(p2.s) && ok2(p3.s), [p1, p2, p3].map(brief).join(" | "));
  check("H is RETURN_PENDING after the RETURNED pickup status", one(`select recognition_status from store_orders where id = ${lit(H.j.id)}`).recognition_status === "RETURN_PENDING", "");
  const invH = invoicesOf(H.j.id);
  const lineH = one(`select id from sales_invoice_items where sales_invoice_id = ${lit(invH[0]?.id)} limit 1`);
  // r15-finance opens an order by id only when it has payment activity (R7 rule) — H has none, so the
  // counter return is processed by the administrator here.
  const rqHf = await call(T.finance, "POST", `/store-orders/${H.j.id}/returns`, { reason: "Returned at the counter", lines: [{ salesInvoiceItemId: lineH?.id, quantity: 1 }], idempotencyKey: `${TAG}-H-ret-f` });
  info("r15-finance return request on an order without payment activity", `${rqHf.s} ${errCode(rqHf.j) ?? ""} (finance.view opens by id only orders with payment activity)`);
  const rqH = await call(T.admin, "POST", `/store-orders/${H.j.id}/returns`, { reason: "Returned at the counter", lines: [{ salesInvoiceItemId: lineH?.id, quantity: 1 }], idempotencyKey: `${TAG}-H-ret` });
  check("H return requested (admin) → DRAFT", ok2(rqH.s) && rqH.j?.returns?.[0]?.status === "DRAFT", brief(rqH));
  const retH = rqH.j?.returns?.[0];
  const rcH = await call(T.admin, "POST", `/store-orders/${H.j.id}/returns/${retH?.id}/receive`, { lines: [{ salesReturnItemId: retH?.items?.[0]?.id, condition: "SALEABLE" }] });
  check("H return received → RETURN_PENDING cleared to RETURNED", ok2(rcH.s) && one(`select recognition_status from store_orders where id = ${lit(H.j.id)}`).recognition_status === "RETURNED", brief(rcH));
  const mH = (await call(T.admin, "GET", `/store-orders/${H.j.id}/money`)).j;
  check("nothing collected on H → refund due 0 (credit note only reduces AR)", near(mH?.figures?.refundDue, 0), JSON.stringify(mH?.figures));
  info("RETURN_PENDING on a SHIPPED parcel", "needs a catalog shipping status whose code contains RETURN; statuses created through the API get USR_<hex> codes, so only imports / seeded catalog codes reach it — exercised here through the pickup RETURNED path");
});

// ═════════════════════════ J10 Idempotency / concurrency ═════════════════════════
await run("J10", "Concurrency and idempotency", async () => {
  const P10 = J7.product ?? (await freshStockedProduct("J10 stocked", 0, 25, 100));
  await openStock(P10, 10, 25);
  // Repeated DELIVERED: deliver ×3 sequential + catalog status DELIVERED, then Promise.all ×3 on another order.
  const K = await createCompanyOrder(T.sales, [{ productId: P10.id, quantity: 1, unitPrice: 100 }], { key: "j10-K" });
  await ship(K.j.id);
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push((await deliver(K.j.id)).s);
  seq.push((await call(T.shipping, "POST", `/store-orders/${K.j.id}/shipments/shipping-status`, { shippingStatusId: status("DELIVERED") })).s);
  const invK = invoicesOf(K.j.id);
  const mvK = rows(`select id from inventory_movements where type = 'SALES_DELIVERY' and reference_id in (${inList(invK.map((i) => i.id))})`);
  const jeK = rows(`select id from journal_entries where source_type = 'SALES_INVOICE' and source_id in (${inList(invK.map((i) => i.id))}) and status = 'POSTED' and reversal_of_entry_id is null`);
  check("DELIVERED ×3 + catalog DELIVERED (sequential) → one invoice, one SALES_DELIVERY, one JE", invK.length === 1 && mvK.length === 1 && jeK.length === 1, `statuses ${seq.join(",")} inv=${invK.length} mv=${mvK.length} je=${jeK.length}`);
  const L = await createCompanyOrder(T.sales, [{ productId: P10.id, quantity: 1, unitPrice: 100 }], { key: "j10-L" });
  await ship(L.j.id);
  const par = await Promise.all([deliver(L.j.id), deliver(L.j.id), deliver(L.j.id)]);
  const invL = invoicesOf(L.j.id);
  const mvL = rows(`select id from inventory_movements where type = 'SALES_DELIVERY' and reference_id in (${inList(invL.map((i) => i.id))})`);
  check("Promise.all DELIVERED ×3 → one invoice, one movement set", invL.length === 1 && mvL.length === 1, `statuses ${par.map((r) => r.s).join(",")} inv=${invL.length} mv=${mvL.length}`);
  const M = await createCompanyOrder(T.sales, [{ productId: P10.id, quantity: 2, unitPrice: 100 }], { key: "j10-M" });
  const pship = await Promise.all([ship(M.j.id), ship(M.j.id), ship(M.j.id)]);
  const trM = rows(`select id from inventory_movements where reference_type = 'STORE_ORDER_TRANSIT' and reference_id = ${lit(M.j.id)}`);
  check("Promise.all dispatch ×3 → one transfer pair", trM.length === 2, `statuses ${pship.map((r) => r.s).join(",")} transfers=${trM.length}`);

  // Two concurrent refunds of the full due (cancelled prepaid order's advance).
  const N = await createCompanyOrder(T.sales, [{ productId: P10.id, quantity: 1, unitPrice: 150 }], { key: "j10-N", paymentType: "PREPAID" });
  await call(T.sales, "POST", `/store-orders/${N.j.id}/payment-declaration`, { kind: "FULL", paymentMethodId: F.bankMethodId, currencyId: SAR, paymentDate: TODAY, idempotencyKey: `${TAG}-N-decl` });
  const payN = one(`select id from payments where store_order_id = ${lit(N.j.id)} and deleted_at is null`);
  await call(T.finance, "POST", `/payments/${payN?.id}/confirm`);
  const arc = await call(T.admin, "POST", `/store-orders/${N.j.id}/archive`);
  // A cancelled (archived) order is refunded from Finance → Refunds (the order page / money panel are by-id 404 once archived).
  const ctx = await call(T.finance, "GET", `/financial-transactions/refunds/store-orders/${N.j.id}`);
  const open = await call(T.finance, "GET", `/financial-transactions/refunds/open-orders?partnerId=${N.j.partnerId}`);
  check("cancelled prepaid order: refund due = the verified advance (150), listed under open orders to refund", ok2(arc.s) && near(ctx.j?.refundDue, 150) && ctx.j?.active === false && JSON.stringify(open.j ?? "").includes(N.j.id), `${arc.s} ctx=${brief(ctx)} open=${open.s}`);
  const panelN = await call(T.finance, "GET", `/store-orders/${N.j.id}/money`);
  info("money panel of an archived (cancelled) order", `${panelN.s} ${errCode(panelN.j) ?? ""} — archived orders are not openable by id; the refund context endpoint serves the refund`);
  const two = await Promise.all(
    [1, 2].map((i) =>
      call(T.finance, "POST", `/financial-transactions/refunds/store-orders/${N.j.id}`, { amount: 150, receivingAccountId: F.bankReceivingAccountId, idempotencyKey: `${TAG}-N-refund-${i}` }),
    ),
  );
  const okN = two.filter((r) => ok2(r.s)).length;
  const refundedN = one(`select coalesce(sum(a.allocated_amount),0) s from financial_transaction_allocations a join financial_transactions t on t.id = a.transaction_id
                          where t.type = 'CUSTOMER_REFUND' and t.status = 'CONFIRMED' and a.store_order_id = ${lit(N.j.id)}`).s;
  check("two concurrent refunds of the full due → exactly one succeeds, total refunded 150", okN === 1 && near(refundedN, 150), `${two.map(brief).join(" | ")} refunded=${refundedN}`);

  // Import replay.
  if (J2.orderRows) {
    const before = one(`select count(*)::int n from store_orders o join partners p on p.id = o.partner_id where p.name in (${inList(J2.orderRows.map((r) => r.customerName))})`).n;
    const again = await importFile(T.sales, "/import-center", "STORE_ORDERS", J2.orderRows, ORDER_FIELDS);
    const after = one(`select count(*)::int n from store_orders o join partners p on p.id = o.partner_id where p.name in (${inList(J2.orderRows.map((r) => r.customerName))})`).n;
    check("re-running the import → created 0, no new rows", again.run?.j?.summary?.created === 0 && after === before, JSON.stringify({ summary: again.run?.j?.summary, before, after }));
  }
  // Replayed create with the same creationIdempotencyKey (sequential + concurrent).
  const key = `${TAG}-replay`;
  const phone = newPhone();
  const items = [{ productId: F.service.id, quantity: 1, unitPrice: 55 }];
  const r1 = await createCompanyOrder(T.sales, items, { key: "replay", idempotencyKey: key, phone, customerName: `${TAG} replay` });
  const r2 = await createCompanyOrder(T.sales, items, { key: "replay", idempotencyKey: key, phone, customerName: `${TAG} replay` });
  check("replayed create (same creationIdempotencyKey) → the same order", ok2(r1.s) && ok2(r2.s) && r1.j?.id === r2.j?.id, `${r1.s}/${r2.s}`);
  const key2 = `${TAG}-replay-par`;
  const phone2 = newPhone();
  const par2 = await Promise.all([1, 2, 3].map(() => createCompanyOrder(T.sales, items, { key: "replay2", idempotencyKey: key2, phone: phone2, customerName: `${TAG} replay par` })));
  const n2 = one(`select count(*)::int n from store_orders where creation_idempotency_key like ${lit("%:" + key2)}`).n;
  check("concurrent creates with one key → one order", n2 === 1 && par2.filter((r) => ok2(r.s)).every((r) => r.j?.id === par2.find((x) => ok2(x.s))?.j?.id), `statuses ${par2.map((r) => r.s).join(",")} rows=${n2}`);
});

// ═════════════════════════ J6 Partner portal ═════════════════════════
await run("J6", "Partner login and portal", async () => {
  const prof = await call(T.finance, "POST", "/company-partners/profiles", { name: `${TAG} شريك اختبار`, notes: `${TAG} acceptance partner` });
  check("finance creates a company partner profile", prof.s === 201, brief(prof));
  const pid = prof.j?.partnerId ?? prof.j?.id;
  const email = `r15-partner-${tagLower}@oms.local`;
  context.partnerLogin = email;
  const early = await call(T.finance, "POST", `/company-partners/profiles/${pid}/login`, { email, fullName: `${TAG} Partner` });
  check("create login before any agreement → 409 PARTNER_LOGIN_NEEDS_AGREEMENT", early.s === 409 && errCode(early.j) === "PARTNER_LOGIN_NEEDS_AGREEMENT", brief(early));
  const agr = await call(T.finance, "POST", "/company-partners/agreements", {
    partnerId: pid,
    profitSharePercent: 1,
    basis: "NET_PROFIT",
    effectiveFrom: MONTH_FROM,
    effectiveTo: MONTH_TO,
    frequency: "MONTHLY",
    activate: true,
  });
  check(`agreement 1% NET_PROFIT monthly ${MONTH_FROM} → ${MONTH_TO} (ACTIVE; Sep / Nov / Dec 2026 are closed periods on this DB)`, agr.s === 201 && agr.j?.status === "ACTIVE", brief(agr));
  const ses = await call(T.sales, "POST", `/company-partners/profiles/${pid}/login`, { email, fullName: "x" });
  check("r15-sales (no company-partners.users.manage) cannot create a partner login → 403", ses.s === 403, `${ses.s}`);
  const lg = await call(T.finance, "POST", `/company-partners/profiles/${pid}/login`, { email, fullName: `${TAG} Partner` });
  check("finance creates the partner login through the API (temporary password returned once)", lg.s === 201 && !!lg.j?.temporaryPassword, `${lg.s}`);
  const lg2 = await call(T.finance, "POST", `/company-partners/profiles/${pid}/login`, { email: `x-${email}`, fullName: "dup" });
  check("a second login for the same partner → 409 PARTNER_LOGIN_EXISTS", lg2.s === 409 && errCode(lg2.j) === "PARTNER_LOGIN_EXISTS", brief(lg2));
  const pu = one(`select id, user_type, company_partner_id, must_change_password from users where email = ${lit(email)}`);
  check("PARTNER user linked to the partner profile, must change password", pu?.user_type === "PARTNER" && pu?.company_partner_id === prof.j?.id && pu?.must_change_password === true, JSON.stringify(pu));
  const tPart = await adoptPassword(email, lg.j.temporaryPassword);
  partnerTokens.add(tPart);
  check("partner token typ partner + companyPartnerId (the profile)", decode(tPart).typ === "partner" && decode(tPart).companyPartnerId === prof.j?.id, JSON.stringify({ typ: decode(tPart).typ, profile: decode(tPart).companyPartnerId === prof.j?.id }));
  const perms = (await call(tPart, "GET", "/auth/me")).j?.permissions ?? [];
  check("partner holds only partner.* permissions", perms.length > 0 && perms.every((p) => p.startsWith("partner.")), JSON.stringify(perms));

  // Payment (finance) so the statement has a payment line backed by a JE.
  const pay = await call(T.finance, "POST", "/company-partners/payments", { partnerId: pid, amount: 10, date: TODAY, financialAccountId: settings.bank_account_id, reference: `${TAG}-P` });
  check("finance records a payment of 10 to the partner (posted)", pay.s === 201, brief(pay));
  const portal = {};
  for (const p of ["me", "summary", "periods", `statement?from=2026-09-01&to=${TODAY}`]) {
    const r = await call(tPart, "GET", `/partner-portal/${p}`);
    portal[p.split("?")[0]] = r.j;
    check(`partner GET /partner-portal/${p.split("?")[0]} → 200`, r.s === 200, `${r.s} ${JSON.stringify(r.j)?.slice(0, 200)}`);
  }
  check("statement lists the payment (method label, no account / JE)", JSON.stringify(portal.statement?.payments ?? []).includes("10"), JSON.stringify(portal.statement?.payments)?.slice(0, 300));
  const others = rows(`select p.name from company_partner_profiles c join partners p on p.id = c.partner_id where c.partner_id <> ${lit(pid)}`).map((r) => r.name).filter((n) => n && n.length > 3);
  const jeIds = rows(`select id from journal_entries where source_type like '%PARTNER%' order by created_at desc limit 500`).map((r) => r.id);
  // Codes / names of the accounts the partner's payment and profit postings use. A code equal to a payment-method
  // label the portal shows (CASH / BANK / OTHER) is checked through the account name only.
  const accs = rows(`select a.code, a.name from chart_of_accounts a where a.id in (${inList([settings.bank_account_id, settings.partner_profit_payable_account_id, settings.partner_profit_distribution_account_id].filter(Boolean))})`);
  const accCodes = accs.map((r) => r.code).filter((c) => c && !["CASH", "BANK", "OTHER"].includes(c));
  const accNames = accs.map((r) => r.name).filter((n) => n && n.length > 3);
  const blob = JSON.stringify(portal);
  check("no other partner's name in any portal response", !others.some((n) => blob.includes(n)), `checked ${others.length} names`);
  check("no journal entry id in any portal response", !jeIds.some((id) => blob.includes(id)) && keyPaths(portal, /journal/i).length === 0, JSON.stringify(keyPaths(portal, /journal/i)));
  check(
    "no internal account code / name / account keys in any portal response",
    !accCodes.some((c) => blob.includes(`"${c}"`)) && !accNames.some((n) => blob.includes(n)) && keyPaths(portal, /account/i).length === 0,
    JSON.stringify({ keys: keyPaths(portal, /account/i), codes: accCodes, names: accNames }),
  );
  for (const [m, path] of [
    ["GET", "/store-orders"],
    ["GET", "/company-partners/profiles"],
    ["GET", `/company-partners/profiles/${pid}/statement`],
    ["GET", "/agents-overview"],
    ["GET", "/sales-reports/performance"],
  ]) {
    const r = await call(tPart, m, path);
    check(`partner token on internal ${path} → 403`, r.s === 403, `${r.s} ${errCode(r.j) ?? ""}`);
  }
  const internalOnPortal = await call(T.finance, "GET", "/partner-portal/me");
  check("internal token on /partner-portal/me → refused", refused(internalOnPortal.s), `${internalOnPortal.s}`);
  // Expiry: end the agreement — history stays readable.
  const end = await call(T.finance, "POST", `/company-partners/agreements/${agr.j?.id}/end`, { effectiveTo: YESTERDAY });
  const me2 = await call(tPart, "GET", "/partner-portal/me");
  const st2 = await call(tPart, "GET", `/partner-portal/statement?from=2026-09-01&to=${TODAY}`);
  check("after the partnership ends the login still reads its history (me + statement 200)", ok2(end.s) && me2.s === 200 && st2.s === 200, `${brief(end)} me=${me2.s} statement=${st2.s} status=${me2.j?.partnership?.status}`);
  // Disable → 401.
  const dis = await call(T.finance, "POST", `/company-partners/profiles/${pid}/login/disable`);
  check("finance disables the login → 200", dis.s === 200, brief(dis));
  let s = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    s = (await call(tPart, "GET", "/partner-portal/me")).s;
    if (s === 401) break;
    await sleep(1000);
  }
  check("disabled login: live token → 401", s === 401, `${s} after ${Math.round((Date.now() - t0) / 1000)}s`);
  const relog = await loginRaw(email);
  check("disabled login cannot sign in (401, or 403 ACCOUNT_DISABLED as for every user type)", relog.s === 401 || (relog.s === 403 && errCode(relog.j) === "ACCOUNT_DISABLED"), brief(relog));
});

// ═════════════════════════ J11 Report scope ═════════════════════════
await run("J11", "Sales-report scope", async () => {
  // Data this month: an order by r15-sales2 (outside r15-manager's team).
  const o2 = await createCompanyOrder(T.sales2, [{ productId: F.service.id, quantity: 1, unitPrice: 70 }], { key: "j11-sales2" });
  check("r15-sales2 creates an order this month", o2.s === 201, brief(o2));
  const names = Object.fromEntries(rows(`select email, full_name from users where email like 'r15-%@oms.local'`).map((r) => [r.email, r.full_name]));
  const perf = (t) => call(t, "GET", `/sales-reports/performance?from=${MONTH_FROM}&to=${TODAY}`);
  const dash = (t) => call(t, "GET", "/sales/performance?period=month");
  const empIds = (j) => (j?.employees ?? []).map((e) => e.userId);

  const s = await perf(T.sales);
  check("r15-sales report → scope OWN, only own row", s.s === 200 && s.j?.scope === "OWN" && empIds(s.j).every((id) => id === uid("sales")), `${s.s} scope=${s.j?.scope} ids=${empIds(s.j).length}`);
  check("r15-sales report → ownRank {position, of}, no teams / agents / unassigned rows", s.j?.ownRank && "of" in s.j.ownRank && !s.j?.teams && !s.j?.agents && !s.j?.unassigned, JSON.stringify({ ownRank: s.j?.ownRank, teams: s.j?.teams, agents: s.j?.agents, un: s.j?.unassigned }));
  check("r15-sales report never contains another employee's id or name", !jsonHas(s.j, uid("sales2")) && !jsonHas(s.j, names[EMAIL("sales2")]) && !jsonHas(s.j, uid("manager")), "");
  const sd = await dash(T.sales);
  check("r15-sales dashboard → scope OWN, empty leaderboard, own rank", sd.s === 200 && sd.j?.scope === "OWN" && (sd.j?.ranking?.leaderboard ?? []).length === 0 && !!sd.j?.ranking?.self, `${sd.s} ${JSON.stringify({ scope: sd.j?.scope, ranking: sd.j?.ranking })?.slice(0, 200)}`);
  check("r15-sales dashboard never contains another employee's id or name", !jsonHas(sd.j, uid("sales2")) && !jsonHas(sd.j, names[EMAIL("sales2")]), "");
  const ownRow = (s.j?.employees ?? [])[0];
  info("own figures: report vs dashboard", { report: ownRow, dashboardSelf: sd.j?.ranking?.self });
  check("dashboard own orders = report own orders (same period / orderDate basis)", num(sd.j?.ranking?.self?.orders) === num(ownRow?.orders ?? ownRow?.orderCount ?? ownRow?.validOrders), JSON.stringify({ dash: sd.j?.ranking?.self, rep: ownRow })?.slice(0, 300));

  const m = await perf(T.manager);
  check("r15-manager report → TEAM incl. r15-sales, never r15-sales2", m.s === 200 && m.j?.scope === "TEAM" && empIds(m.j).includes(uid("sales")) && !empIds(m.j).includes(uid("sales2")), `${m.s} scope=${m.j?.scope}`);
  const md = await dash(T.manager);
  check("r15-manager dashboard → TEAM", md.s === 200 && md.j?.scope === "TEAM" && !jsonHas(md.j, uid("sales2")), `${md.s} scope=${md.j?.scope}`);
  const v = await perf(T.viewall);
  check("r15-viewall report → ALL incl. r15-sales and r15-sales2", v.s === 200 && v.j?.scope === "ALL" && empIds(v.j).includes(uid("sales")) && empIds(v.j).includes(uid("sales2")), `${v.s} scope=${v.j?.scope} n=${empIds(v.j).length}`);
  const vd = await dash(T.viewall);
  check("r15-viewall dashboard → ALL", vd.s === 200 && vd.j?.scope === "ALL", `${vd.s} scope=${vd.j?.scope}`);
  const b = await perf(T.browse);
  check("r15-browse (store-orders.view_all alone) report → OWN, no other employee", b.s === 200 && b.j?.scope === "OWN" && !jsonHas(b.j, uid("sales")) && !jsonHas(b.j, uid("sales2")), `${b.s} scope=${b.j?.scope}`);
  const bd = await dash(T.browse);
  check("r15-browse dashboard → OWN, empty leaderboard", bd.s === 200 && bd.j?.scope === "OWN" && (bd.j?.ranking?.leaderboard ?? []).length === 0, `${bd.s} scope=${bd.j?.scope}`);
  const nv = await perf(T.agview);
  check("no reports.sales.view → /sales-reports/performance 403", nv.s === 403, `${nv.s}`);
  const nd = await dash(T.agview);
  check("no leads / orders view → /sales/performance 403", nd.s === 403, `${nd.s}`);

  // Agent reports.
  const ap = (t) => call(t, "GET", `/agent-portal/sales-reports/performance?from=${MONTH_FROM}&to=${TODAY}`);
  const as = await ap(T.agSales);
  check("agent sales → AGENT_OWN, own row only, never the agent admin", as.s === 200 && as.j?.scope === "AGENT_OWN" && empIds(as.j).every((id) => id === F.agent.salesUserId) && !jsonHas(as.j, F.agent.adminUserId), `${as.s} scope=${as.j?.scope}`);
  check("agent sales → ownRank present", !!as.j?.ownRank, JSON.stringify(as.j?.ownRank));
  const aa = await ap(T.agAdmin);
  check("agent admin → AGENT_ALL with both agent users", aa.s === 200 && aa.j?.scope === "AGENT_ALL" && empIds(aa.j).includes(F.agent.salesUserId), `${aa.s} scope=${aa.j?.scope} ids=${empIds(aa.j).length}`);
  check("agent admin report never shows company employees", !jsonHas(aa.j, uid("sales")) && !jsonHas(aa.j, uid("sales2")), "");
});

// ═════════════════════════ J1 (end) — leak sweep over every agent response ═════════════════════════
await run("J1", "Agent response leak sweep", async () => {
  // Every agent-facing read of the main agent, for both personas (403s are recorded too and carry no data).
  const firstOrder = J4.agentOrder?.id;
  for (const t of [T.agAdmin, T.agSales].filter(Boolean)) {
    for (const p of [
      "/agent-portal/me",
      "/agent-portal/dashboard",
      "/agent-portal/orders?pageSize=50",
      ...(firstOrder ? [`/agent-portal/orders/${firstOrder}`] : []),
      "/agent-portal/leads?pageSize=50",
      "/agent-portal/products?pageSize=50",
      "/agent-portal/stock",
      "/agent-portal/statement",
      "/agent-portal/statement/summary",
      "/agent-portal/commission-report",
      "/agent-portal/payouts",
      "/agent-portal/sales-reports/live",
      `/agent-portal/sales-reports/performance?from=${MONTH_FROM}&to=${TODAY}`,
      "/agent-portal/imports/jobs",
    ])
      await call(t, "GET", p);
  }
  const LEAK = /cost|margin|cogs|carrier/i;
  // The agent's OWN agreed shipping charge per delivery channel is keyed by the channel enum
  // (agentShippingCharge.byChannel.CARRIER / .INTERNAL_COURIER = { amount, service, rateId } from the agent's
  // shipping agreement). That key is a channel identifier, not a carrier cost: it is classified separately, and its
  // values are verified to be agreement rates (never a company carrier cost).
  // Every /carrier/i key is listed; it is a violation when it names money (carrier cost / charge / fee / amount /
  // price / rate) or holds a number, or is the bare `carrier` object (the product's own leakedKeys rule).
  // Operational labels (e.g. `carrierStatus` = the shipment's catalog status) are listed as INFO only.
  const CHANNEL_KEY = /\.byChannel\.(CARRIER|INTERNAL_COURIER)$/;
  const CARRIER_MONEY = /carrier.*(cost|charge|fee|amount|price|rate)|^carrier$/i;
  const hits = [];
  const channelKeys = [];
  const carrierLabels = [];
  const valueAt = (body, path) =>
    path
      .split(/\.|\[(\d+)\]/)
      .filter((x) => x !== undefined && x !== "")
      .reduce((v, k) => (v == null ? v : v[k]), body);
  for (const r of agentResponses) {
    for (const p of keyPaths(r.body, LEAK)) {
      const at = `${r.method} ${r.path.split("?")[0]} ${p}`;
      const key = p.split(".").pop();
      const v = valueAt(r.body, p);
      if (CHANNEL_KEY.test(p)) channelKeys.push(at);
      else if (/cost|margin|cogs/i.test(key) || CARRIER_MONEY.test(key) || typeof v === "number") hits.push(at);
      else carrierLabels.push(`${at} = ${JSON.stringify(v)}`);
    }
  }
  if (carrierLabels.length) info("non-money /carrier/i keys seen by agents (labels / statuses)", [...new Set(carrierLabels)].slice(0, 10));
  context.agentResponsesScanned = agentResponses.length;
  check(
    `no cost / margin / COGS / carrier-cost key in any agent-token response (${agentResponses.length} responses scanned with /cost|margin|cogs|carrier/i)`,
    hits.length === 0,
    JSON.stringify([...new Set(hits)].slice(0, 30)),
  );
  const rateAmounts = new Set(
    rows(
      `select amount from agent_shipping_agreement_rates where shipping_agreement_id in (select id from agent_shipping_agreements where agent_id in (${inList([F.agent?.id, F.j5AgentId].filter(Boolean))}))`,
    ).map((r) => num(r.amount)),
  );
  const channelValues = agentResponses.flatMap((r) => {
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (v.byChannel && typeof v.byChannel === "object") for (const x of Object.values(v.byChannel)) out.push(num(x?.amount));
      Object.values(v).forEach(walk);
    };
    walk(r.body);
    return out;
  });
  info("channel-keyed agreed charges seen by agents (byChannel.CARRIER / INTERNAL_COURIER)", [...new Set(channelKeys)].slice(0, 10));
  check(
    "every byChannel amount an agent sees is one of its own shipping-agreement rates (agreed charge, not carrier cost)",
    channelValues.every((a) => rateAmounts.has(a)),
    JSON.stringify({ seen: [...new Set(channelValues)], rates: [...rateAmounts] }),
  );
});

// ───────── evidence ─────────
const bySection = {};
for (const r of results.filter((x) => !x.info)) {
  bySection[r.section] ??= { pass: 0, fail: 0 };
  bySection[r.section][r.ok ? "pass" : "fail"]++;
}
context.networkRetries = networkRetries;
const summary = {
  pass: results.filter((r) => r.ok && !r.info).length,
  fail: results.filter((r) => !r.ok).length,
  bySection,
};
writeFileSync(
  `${OUT}/journeys.json`,
  JSON.stringify({ ...context, finishedAt: new Date().toISOString(), summary, defects, results }, null, 2),
);
console.log(`\n${summary.pass} PASS / ${summary.fail} FAIL`, JSON.stringify(bySection));
console.log(`evidence: ${OUT}/journeys.json`);
process.exitCode = summary.fail ? 1 : 0;
