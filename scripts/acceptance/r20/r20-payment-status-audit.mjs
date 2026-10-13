#!/usr/bin/env node
/**
 * R20 C — read-only audit of invoice payment status on every API surface (GET only, never writes).
 * See `payment-status-audit.lib.mjs` for what is checked.
 *
 *   node scripts/acceptance/r20/r20-payment-status-audit.mjs [--out <file.json>]
 *   API=http://localhost:4825 EMAIL=admin@oms-demo.local PASSWORD_FILE=… PASSWORD_KEY=MANUAL_PW (local runs)
 *
 * Production default: https://oms.haseb.org/api as the QA admin (D:\Systems\OMS\tmp\.qa.env QA_PASSWORD,
 * never printed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { apiSession, auditPaymentStatus, readPassword } from "./payment-status-audit.lib.mjs";

const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const password = readPassword(
  process.env.PASSWORD_FILE ?? "D:/Systems/OMS/tmp/.qa.env",
  process.env.PASSWORD_KEY ?? "QA_PASSWORD",
);
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex > 0 ? process.argv[outIndex + 1] : null;

const session = await apiSession({ api: API, email: EMAIL, password });
const report = { api: API, at: new Date().toISOString(), ...(await auditPaymentStatus(session.get)) };
await session.logout();

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
}
const { findings, invoices, ...head } = report;
console.log(JSON.stringify(head, null, 2));
for (const f of findings) console.log(JSON.stringify(f));
console.table(invoices);
