#!/usr/bin/env node
/* eslint-disable no-console, no-undef */
/**
 * R15 acceptance personas for the LOCAL verification DB only (default oms_r15_e2e).
 *
 *   node scripts/acceptance/r15/seed-personas.mjs            # applies the SQL (idempotent upsert)
 *   DRY=1 node scripts/acceptance/r15/seed-personas.mjs      # prints the SQL instead
 *
 * Internal users only (SQL = there is no API that creates a user with a known password). The agent,
 * its agreements and its two users, the sales team and the partner login are created THROUGH THE API
 * by the journey script (r15-journeys.mjs, section S / J6).
 *
 * The password is generated once into tmp/r15/.r15.env (R15_PW, git-ignored) and never printed.
 * Re-running keeps the user ids (FK-safe): password hash + permission set + flags are reset.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ROOT = "D:/Systems/OMS";
const DB = process.env.DB ?? "oms_r15_e2e";
if (!/^oms_r15_/.test(DB)) throw new Error("R15 verification databases only");
const require = createRequire(`${ROOT}/apps/api/package.json`);
const bcrypt = require("bcryptjs");

mkdirSync(`${ROOT}/tmp/r15`, { recursive: true });
const envFile = `${ROOT}/tmp/r15/.r15.env`;
let pw;
if (existsSync(envFile))
  pw = readFileSync(envFile, "utf8")
    .match(/R15_PW=(.*)/)?.[1]
    ?.trim();
if (!pw) {
  pw = "R15-" + randomBytes(9).toString("base64url");
  writeFileSync(envFile, `R15_PW=${pw}\n`);
}
const hash = bcrypt.hashSync(pw, 10);

const SALES = [
  "store-orders.view",
  "store-orders.create",
  "store-orders.edit",
  "crm.leads.view",
  "crm.leads.create",
  "crm.leads.edit",
  "crm.leads.convert",
  "reports.sales.view",
  "customers.lookup_advanced",
  // Customer pick / find-or-create on the order form (R14 personas held it too).
  "partners.view",
];
export const PERSONAS = [
  { key: "admin", name: "مدير النظام R15", superAdmin: true, perms: [] },
  {
    key: "sales",
    name: "موظف مبيعات R15",
    eligible: true,
    perms: [...SALES, "store-orders.import", "crm.leads.import"],
  },
  { key: "sales2", name: "موظف مبيعات R15 ثاني", eligible: true, perms: [...SALES] },
  {
    key: "manager",
    name: "مدير فريق مبيعات R15",
    // crm.leads.view + store-orders.view: the dashboard gate (/sales/performance needs one of them);
    // neither widens a figure.
    perms: ["reports.sales.view", "crm.leads.manage", "crm.leads.view", "store-orders.view"],
  },
  {
    key: "viewall",
    name: "مدير مبيعات الشركة R15",
    // store-orders.view only for the dashboard gate (OWN record scope — never widens).
    perms: ["reports.sales.view", "reports.sales.view_all", "store-orders.view"],
  },
  {
    key: "browse",
    name: "متصفح طلبات R15",
    perms: ["reports.sales.view", "store-orders.view_all"],
  },
  {
    key: "shipping",
    name: "موظف شحن R15",
    perms: [
      "shipping.view",
      "shipping.edit",
      "shipping.manage",
      "shipping.assign_carrier",
      "shipping.receive_returns",
      "store-orders.view",
      "store-orders.view_all",
    ],
  },
  {
    key: "finance",
    name: "محاسب R15",
    perms: [
      "finance.view",
      "store-orders.view",
      "partners.view",
      "customers.view_financials",
      "sales.invoices.view",
      "sales.receipts.view",
      "sales.receipts.create",
      "sales.receipts.confirm",
      "sales.receipts.cancel",
      "sales.receipts.reverse",
      "sales.refunds.view",
      "sales.refunds.create",
      "sales.refunds.confirm",
      "sales.returns.view",
      "sales.returns.create",
      "sales.returns.approve",
      "sales.returns.confirm",
      "company-partners.view",
      "company-partners.manage",
      "company-partners.close",
      "company-partners.pay",
      "company-partners.users.manage",
      "agents.view",
      "agents.finance.view",
      "agents.agreements.manage",
    ],
  },
  // J1 — a company user who may see agents but not agent money.
  { key: "agview", name: "مطّلع على الوكلاء R15", perms: ["agents.view"] },
];

const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
let sql = "BEGIN;\n";
for (const p of PERSONAS) {
  const email = `r15-${p.key}@oms.local`;
  sql += `INSERT INTO users (id, email, username, full_name, password_hash, is_super_admin, sales_distribution_eligible, must_change_password, updated_at)
  VALUES (gen_random_uuid(), ${q(email)}, ${q("r15-" + p.key)}, ${q(p.name)}, ${q(hash)}, ${p.superAdmin ? "true" : "false"}, ${p.eligible ? "true" : "false"}, false, now())
  ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_super_admin = EXCLUDED.is_super_admin,
    sales_distribution_eligible = EXCLUDED.sales_distribution_eligible, must_change_password = false, is_active = true,
    is_locked = false, deleted_at = NULL, job_title_id = NULL, updated_at = now();\n`;
  sql += `DELETE FROM user_permissions WHERE user_id = (SELECT id FROM users WHERE email = ${q(email)});\n`;
  for (const name of p.perms) {
    sql += `INSERT INTO user_permissions (id, user_id, permission_id) SELECT gen_random_uuid(), u.id, pm.id FROM users u, permissions pm WHERE u.email = ${q(email)} AND pm.name = ${q(name)};\n`;
  }
}
sql += "COMMIT;\n";

if (process.env.DRY) {
  process.stdout.write(sql.replace(hash, "<bcrypt hash>"));
} else {
  execFileSync(
    "docker",
    ["exec", "-i", "oms-postgres", "psql", "-U", "oms", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  );
  // Verify every requested key landed (a typo would silently grant nothing).
  for (const p of PERSONAS) {
    const n = Number(
      execFileSync(
        "docker",
        [
          "exec",
          "oms-postgres",
          "psql",
          "-U",
          "oms",
          "-d",
          DB,
          "-At",
          "-c",
          `select count(*) from user_permissions up join users u on u.id = up.user_id where u.email = 'r15-${p.key}@oms.local'`,
        ],
        { encoding: "utf8" },
      ).trim(),
    );
    if (n !== p.perms.length)
      throw new Error(`r15-${p.key}: ${n} of ${p.perms.length} permissions granted`);
    console.log(`r15-${p.key}@oms.local  ${n} permissions${p.superAdmin ? " (super admin)" : ""}`);
  }
}
