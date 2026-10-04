#!/usr/bin/env node
/**
 * R7 - live API journeys for scope, lookup, payments, distribution and agent
 * isolation, against a LOCAL integrated build with seeded demo personas
 * (DEMO-R7-20261004-*). Local only: ids are read from the local Docker DB.
 *
 *   R7_PW=<demo password> API=http://localhost:4105 node scripts/acceptance/r7-journeys.mjs
 *
 * Exit code 1 if any check fails. Output is a plain PASS/FAIL list (no tokens).
 */
import { execFileSync } from "node:child_process";

const API = (process.env.API ?? "http://localhost:4105").replace(/\/$/, "");
const PW = process.env.R7_PW ?? "";
const DB = process.env.R7_DB ?? "oms_r7_int";
if (!PW) throw new Error("set R7_PW (local demo password)");

const psql = (sql) =>
  execFileSync("docker", ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-F", "|", "-c", sql], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((l) => l.split("|"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PW, rememberMe: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.accessToken) throw new Error(`login failed for ${email}: ${r.status}`);
  return j.accessToken;
}
const call = async (token, method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
};
const rowsOf = (j) => (Array.isArray(j) ? j : (j?.data ?? j?.items ?? j?.rows ?? []));
const denied = (s) => s === 403 || s === 404;

const userId = (email) => psql(`select id from users where email='${email}'`)[0][0];

async function main() {
  const T = {};
  for (const [k, e] of Object.entries({
    A: "demo-r7-sales-a@oms.local", B: "demo-r7-sales-b@oms.local", fin: "demo-r7-finance@oms.local", ship: "demo-r7-shipping@oms.local",
    agA: "agent-a-admin.demo-agt@oms.local", agAS: "agent-a-sales1.demo-agt@oms.local", agB: "agent-b-admin.demo-agt@oms.local",
  })) T[k] = await login(e);

  const idA = userId("demo-r7-sales-a@oms.local"), idB = userId("demo-r7-sales-b@oms.local");
  const leadsOf = (uid) => psql(`select id from leads where sales_employee_id='${uid}' and deleted_at is null`).map((r) => r[0]);
  const ordersOf = (uid) => psql(`select id from store_orders where employee_id='${uid}' and deleted_at is null`).map((r) => r[0]);
  const aLeads = leadsOf(idA), bLeads = leadsOf(idB), aOrders = ordersOf(idA), bOrders = ordersOf(idB);

  // ---- 1. Default sales scope: lists
  for (const [who, mine, theirs, label] of [["A", aLeads, bLeads, "Sales A"], ["B", bLeads, aLeads, "Sales B"]]) {
    const l = rowsOf((await call(T[who], "GET", "/leads?limit=200")).json);
    const ids = l.map((x) => x.id);
    check(`${label}: lead list contains exactly the assigned leads`, mine.every((i) => ids.includes(i)) && ids.every((i) => mine.includes(i)), `${ids.length} rows`);
    check(`${label}: no other employee's / unassigned / agent lead leaks`, !theirs.some((i) => ids.includes(i)));
    const o = rowsOf((await call(T[who], "GET", "/store-orders?limit=200")).json);
    const oids = o.map((x) => x.id);
    const oMine = who === "A" ? aOrders : bOrders, oTheirs = who === "A" ? bOrders : aOrders;
    check(`${label}: order list contains only own orders`, oMine.every((i) => oids.includes(i)) && oids.every((i) => oMine.includes(i)), `${oids.length} rows`);
    check(`${label}: other employee's orders absent`, !oTheirs.some((i) => oids.includes(i)));
  }

  // ---- 2. Direct URL / by-id
  const bLead = bLeads[0], bOrder = bOrders[0];
  check("Sales A cannot open B's lead by id", denied((await call(T.A, "GET", `/leads/${bLead}`)).status));
  check("Sales A cannot open B's order by id", denied((await call(T.A, "GET", `/store-orders/${bOrder}`)).status));
  check("Sales A can open own lead", (await call(T.A, "GET", `/leads/${aLeads[0]}`)).status === 200);
  check("Sales A can open own order", (await call(T.A, "GET", `/store-orders/${aOrders[0]}`)).status === 200);
  check("Sales A cannot add a note to B's order", denied((await call(T.A, "POST", `/store-orders/${bOrder}/notes`, { text: "x" })).status));
  check("Sales A cannot post a payment on B's order", denied((await call(T.A, "POST", `/store-orders/${bOrder}/payments`, {
    paymentDate: new Date().toISOString(), amount: 5, paymentSourceId: "00000000-0000-4000-8000-000000000000",
    receivingAccountId: "00000000-0000-4000-8000-000000000000", senderName: "x" })).status));

  // ---- 3. Finance / Shipping do not get the generic sales lists
  const finList = await call(T.fin, "GET", "/store-orders?limit=50");
  check("Finance (no store-orders.view) has no sales order list", denied(finList.status) || rowsOf(finList.json).length === 0, `status ${finList.status}`);
  const shipList = await call(T.ship, "GET", "/store-orders?limit=50");
  check("Shipping does not receive a generic sales order list", denied(shipList.status) || rowsOf(shipList.json).length === 0, `status ${shipList.status}`);
  const shipBOrder = await call(T.ship, "GET", `/store-orders/${bOrder}`);
  const inQueue = psql(`select count(*) from shipments where store_order_id='${bOrder}'`)[0][0] !== "0";
  check("Shipping opens an order only when it is in the Shipping queue", shipBOrder.status === 200 ? inQueue : denied(shipBOrder.status), `status ${shipBOrder.status}, queued=${inQueue}`);

  // ---- 4. Advanced lookup
  const [bOrderId, bPhone] = (() => { const r = psql(`select s.id, coalesce(p.mobile, p.phone) from store_orders s join partners p on p.id=s.partner_id where s.id='${bOrder}'`)[0]; return r; })();
  const found = await call(T.A, "POST", "/customer-lookup/advanced", { query: bPhone });
  const m = (found.json?.matches ?? [])[0];
  check("Lookup: A finds B's customer by phone", found.status === 200 && !!m, `status ${found.status}`);
  check("Lookup: result flagged 'not assigned to you'", m?.notAssignedToYou === true);
  check("Lookup: not openable (no edit/open path)", m && (m.openable === null || m.openable === undefined));
  const keys = m ? Object.keys(m).sort().join(",") : "";
  check("Lookup: fixed minimal shape (no address/balance/payment/owner)", !!m && !/address|balance|payment|owner|employee|agent|email|total|amount/i.test(JSON.stringify(m)), keys);
  check("Lookup: phone is masked", !!m && !JSON.stringify(m).includes(String(bPhone).replace(/\D/g, "").slice(-8)));
  check("Lookup: single-word name refused (no prefix sweep)", (await call(T.A, "POST", "/customer-lookup/advanced", { query: "Ahmed" })).status === 400);
  check("Lookup: short phone refused", (await call(T.A, "POST", "/customer-lookup/advanced", { query: "12345" })).status === 400);
  check("Lookup: finance (no permission) denied", (await call(T.fin, "POST", "/customer-lookup/advanced", { query: bPhone })).status === 403);
  check("Lookup: agent token denied", (await call(T.agA, "POST", "/customer-lookup/advanced", { query: bPhone })).status === 403);
  const legacy = await call(T.A, "GET", `/partners/global-lookup?phone=${encodeURIComponent(bPhone)}`);
  check("Legacy phone lookup: other employee's customer is masked/restricted", legacy.status === 200 && legacy.json?.restricted === true && !/address|recentOrders|lastOrder/.test(JSON.stringify(legacy.json)), `status ${legacy.status}`);
  const bOrderNo = psql(`select internal_order_id from store_orders where id='${bOrder}'`)[0][0];
  const legacyOrder = await call(T.A, "GET", `/store-orders/global-lookup?orderNumber=${encodeURIComponent(bOrderNo)}`);
  check("Legacy order lookup: other employee's order is masked/restricted", legacyOrder.status === 200 && legacyOrder.json?.restricted === true && !/products|paymentStatus|customerName/.test(JSON.stringify(legacyOrder.json)));
  // agent-only customer
  const agOrder = psql(`select s.id, coalesce(p.mobile,p.phone) from store_orders s join partners p on p.id=s.partner_id where s.agent_id=(select agent_id from users where email='agent-a-admin.demo-agt@oms.local') and s.deleted_at is null and not exists (select 1 from store_orders s2 where s2.partner_id=s.partner_id and s2.agent_id is null and s2.deleted_at is null) and not exists (select 1 from leads l where l.partner_id=s.partner_id and l.agent_id is null and l.deleted_at is null) limit 1`)[0];
  if (agOrder) {
    const r = await call(T.A, "POST", "/customer-lookup/advanced", { query: agOrder[1] });
    check("Lookup: an agent-only customer is invisible to company staff", r.status === 200 && (r.json?.matches ?? []).length === 0);
    const lg = await call(T.A, "GET", `/partners/global-lookup?phone=${encodeURIComponent(agOrder[1])}`);
    check("Legacy lookup: agent-only customer invisible to company staff", lg.status === 200 && (lg.json === null || Object.keys(lg.json ?? {}).length === 0));
  } else check("Lookup: agent-only customer fixture", false, "no agent-only customer found");

  // ---- 5. Agent isolation
  const agentA = psql(`select agent_id from users where email='agent-a-admin.demo-agt@oms.local'`)[0][0];
  const agentB = psql(`select agent_id from users where email='agent-b-admin.demo-agt@oms.local'`)[0][0];
  const aLeadsAg = rowsOf((await call(T.agA, "GET", "/agent-portal/leads?limit=100")).json);
  const aOrdersAg = rowsOf((await call(T.agA, "GET", "/agent-portal/orders?limit=100")).json);
  const agLeadIds = new Set(psql(`select id from leads where agent_id='${agentA}' and deleted_at is null`).map((r) => r[0]));
  const agOrderIds = new Set(psql(`select id from store_orders where agent_id='${agentA}' and deleted_at is null`).map((r) => r[0]));
  check("Agent A admin sees only agent A's leads", aLeadsAg.length > 0 && aLeadsAg.every((x) => agLeadIds.has(x.id)), `${aLeadsAg.length} rows`);
  check("Agent A admin sees only agent A's orders", aOrdersAg.length > 0 && aOrdersAg.every((x) => agOrderIds.has(x.id)), `${aOrdersAg.length} rows`);
  const bAgLead = psql(`select id from leads where agent_id='${agentB}' and deleted_at is null limit 1`)[0]?.[0];
  const bAgOrder = psql(`select id from store_orders where agent_id='${agentB}' and deleted_at is null limit 1`)[0]?.[0];
  if (bAgLead) check("Agent A cannot open agent B's lead by id", denied((await call(T.agA, "GET", `/agent-portal/leads/${bAgLead}`)).status));
  if (bAgOrder) check("Agent A cannot open agent B's order by id", denied((await call(T.agA, "GET", `/agent-portal/orders/${bAgOrder}`)).status));
  check("Agent token cannot reach internal leads", (await call(T.agA, "GET", "/leads?limit=5")).status === 403);
  check("Agent token cannot reach internal store orders", (await call(T.agA, "GET", "/store-orders?limit=5")).status === 403);
  check("Agent token cannot open an internal order by id", denied((await call(T.agA, "GET", `/store-orders/${bOrder}`)).status));
  check("Agent token cannot reach legacy global lookup", denied((await call(T.agA, "GET", `/partners/global-lookup?phone=${encodeURIComponent(bPhone)}`)).status));
  check("Internal Sales A cannot reach the agent portal", denied((await call(T.A, "GET", "/agent-portal/leads?limit=5")).status));
  const agASales = rowsOf((await call(T.agAS, "GET", "/agent-portal/orders?limit=100")).json);
  check("Agent A sales (own scope) sees only agent A orders", agASales.every((x) => agOrderIds.has(x.id)), `${agASales.length} rows`);

  // ---- 6. Distribution eligibility (internal pool only, explicit sales designation)
  const mgr = await login("demo-r7-mgr@oms.local");
  const snap = (await call(mgr, "GET", "/leads/distribution")).json ?? {};
  const eligibleEmails = (snap.eligible ?? []).map((u) => u.email);
  const excluded = snap.excluded ?? [];
  const reasonOf = (email) => (excluded.find((u) => u.email === email)?.reasons ?? []).join("+");
  check("Distribution: Sales A and B are eligible", ["demo-r7-sales-a@oms.local", "demo-r7-sales-b@oms.local"].every((e) => eligibleEmails.includes(e)));
  check("Distribution: Finance (has crm.leads.edit) is excluded as NOT_SALES_DESIGNATED", !eligibleEmails.includes("demo-r7-finance@oms.local") && reasonOf("demo-r7-finance@oms.local") === "NOT_SALES_DESIGNATED", reasonOf("demo-r7-finance@oms.local"));
  check("Distribution: Shipping and the manager are not eligible", !eligibleEmails.includes("demo-r7-shipping@oms.local") && !eligibleEmails.includes("demo-r7-mgr@oms.local"));
  check("Distribution: no agent user is ever eligible", !eligibleEmails.some((e) => /demo-agt/.test(e)));
  check("Distribution: agent users never appear in the internal pool's exclusions either", !excluded.some((u) => /demo-agt/.test(u.email)));
  const flagged = new Set(psql("select email from users where sales_distribution_eligible and is_active and not is_locked").map((r) => r[0]));
  check("Distribution: every eligible user is explicitly flagged", eligibleEmails.every((e) => flagged.has(e)), `${eligibleEmails.length} eligible`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(2); });
