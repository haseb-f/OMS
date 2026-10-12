#!/usr/bin/env node
/**
 * R18 — repair of the reported partial-payment record on Production, through the business operations only
 * (Cancel = audited reversal of the voucher's entry, then Create + Confirm of the replacement), never SQL.
 *
 *   CR-2026-000095 (customer دار الهدى للنشر) posted 200,000 to the bank while 100,000 was received: the
 *   "Receive Payment" prefill kept the invoice balance as the amount after the allocation was lowered to
 *   100,000. Repair: cancel CR-2026-000095 and record its replacement — 100,000 allocated to INV-2026-000091,
 *   same date and receiving account, referencing CR-2026-000095.
 *
 * Idempotent: a cancelled CR-2026-000095 is not cancelled again; the replacement carries a fixed idempotency
 * key, so a re-run returns the same voucher and posts nothing more. Dry run by default; `--apply` writes.
 * Prints the before / after reconciliation (invoice, vouchers, partner statement, bank account, integrity).
 * Signs in as the QA admin (tmp/.qa.env, never printed).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const PW =
  process.env.PASSWORD ??
  readFileSync("tmp/.qa.env", "utf8")
    .split(/\r?\n/)
    .find((l) => /QA_PASSWORD=/.test(l))
    .replace(/^\s*(export\s+)?QA_PASSWORD=/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
const RECEIPT_NUMBER = process.env.RECEIPT ?? "CR-2026-000095";
const INVOICE_NUMBER = process.env.INVOICE ?? "INV-2026-000091";
const RECEIVED = Number(process.env.RECEIVED ?? 100000);
const KEY = `r18-repair-${RECEIPT_NUMBER}`;

const login = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PW }),
});
const { accessToken } = await login.json();
if (!accessToken) throw new Error(`login failed (${login.status})`);
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);
const n = (v) => Math.round(Number(v ?? 0) * 100) / 100;

async function findReceipt(number) {
  const list = items(await call("GET", `/financial-transactions/receipts?search=${encodeURIComponent(number)}&pageSize=20`));
  const row = list.find((r) => r.transactionNumber === number);
  return row ? call("GET", `/financial-transactions/receipts/${row.id}`) : null;
}

async function snapshot(label, receipt, invoiceId, bankAccountId) {
  const invoice = await call("GET", `/sales/invoices/${invoiceId}`);
  const vouchers = items(
    await call("GET", `/financial-transactions/receipts?partnerId=${invoice.partnerId}&pageSize=100`),
  ).map((r) => ({
    number: r.transactionNumber,
    status: r.status,
    amount: n(r.amount),
    allocated: n((r.allocations ?? []).reduce((s, a) => s + Number(a.allocatedAmount), 0)),
    reference: r.referenceNumber ?? null,
  }));
  const statement = await call("GET", `/accounting/reports/partner-statement?partnerId=${invoice.partnerId}`);
  const day = new Date(receipt.transactionDate).toISOString().slice(0, 10);
  const bank = bankAccountId
    ? await call("GET", `/accounting/reports/account-statement?accountId=${bankAccountId}&dateFrom=${day}`)
    : null;
  const bankFromVouchers = (bank?.movements ?? bank?.items ?? []).filter((m) =>
    /Customer Receipt Voucher|Reversal/.test(m.description ?? m.journalEntry?.description ?? ""),
  );
  let integrity = null;
  try {
    const report = await call("GET", "/accounting/reports/voucher-integrity");
    integrity = {
      errors: report.errors,
      review: report.review,
      thisPartner: report.issues
        .filter((i) => i.partnerName === invoice.partner?.name)
        .map((i) => `${i.severity} ${i.code} ${i.documentNumber} ${JSON.stringify(i.amounts)}`),
    };
  } catch (error) {
    integrity = `not available: ${String(error.message).slice(0, 80)}`;
  }
  return {
    label,
    invoice: {
      number: invoice.invoiceNumber,
      grandTotal: n(invoice.grandTotal),
      allocatedTotal: n(invoice.allocatedTotal),
      remainingBalance: n(invoice.remainingBalance),
      paymentStatus: invoice.paymentStatus,
    },
    vouchers,
    partnerStatement: {
      periodDebit: n(statement.periodDebit),
      periodCredit: n(statement.periodCredit),
      closingBalance: n(statement.closingBalance),
    },
    bankAccount: bank
      ? {
          from: day,
          openingBalance: n(bank.openingBalance),
          closingBalance: n(bank.closingBalance),
          voucherMovements: bankFromVouchers.map((m) => ({
            entry: m.entryNumber ?? m.journalEntry?.entryNumber,
            debit: n(m.debit),
            credit: n(m.credit),
          })),
        }
      : null,
    integrity,
  };
}

const receipt = await findReceipt(RECEIPT_NUMBER);
if (!receipt) throw new Error(`${RECEIPT_NUMBER} not found`);
const allocation = (receipt.allocations ?? []).find((a) => a.salesInvoice?.invoiceNumber === INVOICE_NUMBER);
const invoiceId = allocation?.salesInvoiceId ?? receipt.allocations?.[0]?.salesInvoiceId;
if (!invoiceId) throw new Error(`${RECEIPT_NUMBER} has no allocation to ${INVOICE_NUMBER}`);
const receivingAccounts = items(await call("GET", "/receiving-accounts?pageSize=200"));
const bankAccountId =
  receivingAccounts.find((ra) => ra.id === receipt.receivingAccountId)?.chartOfAccountId ?? null;

const report = { appliedAt: null, apply: APPLY, receipt: RECEIPT_NUMBER, before: null, actions: [], after: null };
report.before = await snapshot("before", receipt, invoiceId, bankAccountId);

// Guard: repair only the exact confirmed defect shape (amount 200,000 with 100,000 applied to the invoice).
const allocated = n((receipt.allocations ?? []).reduce((s, a) => s + Number(a.allocatedAmount), 0));
const shapeOk = receipt.status === "CANCELLED" || (n(receipt.amount) > allocated && n(allocation?.allocatedAmount) === RECEIVED);
if (!shapeOk) throw new Error(`${RECEIPT_NUMBER} no longer has the reported shape — nothing done`);

const replacementDto = {
  partnerId: receipt.partnerId,
  transactionDate: receipt.transactionDate,
  receivingAccountId: receipt.receivingAccountId ?? undefined,
  paymentSourceId: receipt.paymentSourceId ?? undefined,
  currencyId: receipt.currencyId ?? undefined,
  amount: RECEIVED,
  referenceNumber: RECEIPT_NUMBER,
  notes: `R18 correction of ${RECEIPT_NUMBER}: it posted ${n(receipt.amount).toFixed(2)} while ${RECEIVED.toFixed(2)} was received (the invoice balance stayed as the amount after the allocation was lowered). This voucher records the money actually received.`,
  allocations: [{ invoiceId, allocatedAmount: RECEIVED }],
  idempotencyKey: KEY,
};

if (!APPLY) {
  report.actions.push(
    receipt.status === "CONFIRMED" ? `would cancel ${RECEIPT_NUMBER} (reverses its entry)` : `${RECEIPT_NUMBER} already ${receipt.status}`,
    `would create + confirm the replacement (${RECEIVED} → ${INVOICE_NUMBER}, key ${KEY})`,
  );
} else {
  if (receipt.status === "CONFIRMED") {
    await call("POST", `/financial-transactions/receipts/${receipt.id}/cancel`);
    report.actions.push(`cancelled ${RECEIPT_NUMBER}`);
  } else {
    report.actions.push(`${RECEIPT_NUMBER} already ${receipt.status} — not cancelled again`);
  }
  const replacement = await call("POST", "/financial-transactions/receipts/confirmed", replacementDto);
  report.actions.push(`replacement ${replacement.transactionNumber} ${replacement.status} amount ${n(replacement.amount)}`);
  report.appliedAt = new Date().toISOString();
  report.after = await snapshot("after", await call("GET", `/financial-transactions/receipts/${receipt.id}`), invoiceId, bankAccountId);
}

await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
mkdirSync("specs/round18-corrections/evidence", { recursive: true });
const out = `specs/round18-corrections/evidence/repair-${RECEIPT_NUMBER}${APPLY ? "" : "-dry-run"}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`written ${out}`);
