#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * R20 §B — value proof on the LOCAL demo stack (read-only): every box of every employee card
 * (`GET /sales-reports/employee-periods`, every page) equals an INDEPENDENT database computation
 * of the same definitions — orders of the employee (company: no agent; agent: that agent), not
 * deleted, placed in the period by the Cairo calendar day of `order_date`, valid = fulfillment
 * code ≠ CANCELLED, returned still a sale, amount = payable total else Σ live line agreed
 * amounts, summed per order currency. The SQL here uses `AT TIME ZONE 'Africa/Cairo'` dates,
 * not the API's UTC bounds, so the boundaries are checked too. The own card of an own scope is
 * also compared with that persona's Live report (Live filtered to the employee).
 *
 *   API=http://localhost:4815 DB=oms_r20_b PW_FILE=D:/Systems/OMS/tmp/r15-manual/.env \
 *     node scripts/acceptance/r20/r20-b-verify-periods.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const API = (process.env.API ?? "http://localhost:4815").replace(/\/$/, "");
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local API only");
const DB = process.env.DB ?? "oms_r20_b";
if (DB === "oms") throw new Error("never the main local DB");
const OUT = process.env.OUT;
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();

/** A kept-alive socket can be closed by the server while psql runs — retry once. */
const fetch = async (url, init) => {
  try {
    return await globalThis.fetch(url, init);
  } catch {
    return globalThis.fetch(url, init);
  }
};
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
const get = async (token, path) => {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
function sql(query) {
  return execFileSync(
    "docker",
    ["exec", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-At", "-F", "|", "-c", query],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("|"));
}
const uuid = (value) => {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error(`not a uuid: ${value}`);
  return `'${value}'::uuid`;
};

/** Independent computation for one owner in one audience, per period. */
function expected(userId, agentId, periods) {
  const audience = agentId ? `o.agent_id = ${uuid(agentId)}` : "o.agent_id IS NULL";
  const out = {};
  for (const { period, from, to } of periods) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      throw new Error("date");
    const rows = sql(`
      WITH x AS (
        SELECT c.code AS currency,
               COALESCE(sd.code, CASE WHEN o.shipping_stage::text = 'READY_FOR_SHIPPING' THEN 'READY' ELSE 'UNFULFILLED' END) AS status,
               COALESCE(o.payable_total, (SELECT SUM(i.agreed_amount) FROM store_order_items i
                                          WHERE i.store_order_id = o.id AND i.deleted_at IS NULL), 0) AS amount
        FROM store_orders o
        JOIN currencies c ON c.id = o.currency_id
        LEFT JOIN status_definitions sd ON sd.id = o.fulfillment_status_id
        WHERE o.deleted_at IS NULL AND o.employee_id = ${uuid(userId)} AND ${audience}
          AND ((o.order_date AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo')::date BETWEEN '${from}' AND '${to}'
      )
      SELECT 'n', COUNT(*), COUNT(*) FILTER (WHERE status <> 'CANCELLED'),
             COUNT(*) FILTER (WHERE status = 'CANCELLED'), COUNT(*) FILTER (WHERE status = 'RETURNED')
      FROM x
      UNION ALL
      SELECT currency, ROUND(SUM(amount), 2), 0, 0, 0 FROM x WHERE status <> 'CANCELLED'
      GROUP BY currency`);
    const [, orders, valid, cancelled, returned] = rows.find((row) => row[0] === "n");
    out[period] = {
      orders: Number(orders),
      valid: Number(valid),
      cancelled: Number(cancelled),
      returned: Number(returned),
      amounts: rows
        .filter((row) => row[0] !== "n")
        .map(([currencyCode, amount]) => ({ currencyCode, amount: Number(amount) }))
        .sort((a, b) => a.currencyCode.localeCompare(b.currencyCode)),
    };
  }
  return out;
}

const PERSONAS = [
  // [persona, source]
  ["admin@oms-demo.local", "company"],
  ["sales@oms-demo.local", "company"],
  ["sales2@oms-demo.local", "company"],
  ["agent@oms-demo.local", "agent"],
  ["agent2@oms-demo.local", "agent"],
];
const BASE = { company: "/sales-reports", agent: "/agent-portal/sales-reports" };
const report = { at: new Date().toISOString(), api: API, db: DB, personas: {} };
let boxes = 0;
let mismatches = 0;

for (const [persona, source] of PERSONAS) {
  const token = await login(persona);
  const pages = [];
  for (let page = 1; ; page += 1) {
    const body = await get(token, `${BASE[source]}/employee-periods?page=${page}&pageSize=10`);
    pages.push(body);
    if (page * body.pageSize >= body.total) break;
  }
  const first = pages[0];
  const employees = pages.flatMap((body) => body.employees);
  const agentId =
    source === "agent"
      ? sql(`SELECT agent_id FROM users WHERE email = '${persona.replace(/'/g, "")}'`)[0][0]
      : null;
  const entry = {
    scope: first.scope,
    total: first.total,
    pages: pages.length,
    periods: first.periods,
    employees: employees.map((row) => ({ name: row.name, rank: row.rank })),
    separateRows: Boolean(first.unassigned || first.agents),
    mismatches: [],
  };
  for (const row of employees) {
    const want = expected(row.userId, agentId, first.periods);
    for (const box of row.periods) {
      boxes += 1;
      const { period, ...got } = box;
      if (JSON.stringify(got) !== JSON.stringify(want[period])) {
        mismatches += 1;
        entry.mismatches.push({ employee: row.name, period, got, want: want[period] });
      }
    }
  }
  // Own scope: the own card equals the persona's Live report (Live filtered to the employee).
  if (first.scope === "OWN" || first.scope === "AGENT_OWN") {
    const live = await get(token, `${BASE[source]}/live`);
    entry.liveEqualsOwnCard = live.periods.every((bucket) => {
      const box = employees[0]?.periods.find((p) => p.period === bucket.period);
      const strip = ({ orders, valid, cancelled, returned, amounts }) =>
        JSON.stringify({ orders, valid, cancelled, returned, amounts });
      return box && strip(box) === strip(bucket);
    });
    if (!entry.liveEqualsOwnCard) mismatches += 1;
  }
  report.personas[persona] = entry;
  console.log(
    `${persona} ${first.scope}: ${employees.length} employee card(s) on ${pages.length} page(s), ` +
      `${entry.mismatches.length} mismatch(es)` +
      (entry.liveEqualsOwnCard !== undefined
        ? `, live = own card: ${entry.liveEqualsOwnCard}`
        : ""),
  );
}
report.boxes = boxes;
report.mismatches = mismatches;
console.log(`boxes compared: ${boxes}, mismatches: ${mismatches}`);
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
if (mismatches) process.exit(1);
