#!/usr/bin/env node
/**
 * R22 I-A — read-only settlement probe (GET only, never writes). For every receipt / supplier payment /
 * refund / expense voucher: its allocations, its journal entry (sourceType/sourceId link, lines, entry date
 * vs voucher date), and per partner: invoices (total / paid / remaining / status), credit notes, the
 * partner statement closing balance on the control account, the party position and the aging row — then
 * reconciles   ledger closing  vs  open invoices − unapplied credits   and classifies every gap.
 *
 *   node scripts/acceptance/r22/r22-settlement-prod-probe.mjs [--out <file.json>]
 *   API=http://localhost:4905/api EMAIL=admin@oms-demo.local PASSWORD_FILE=D:/Systems/OMS/tmp/r15-manual/.env PASSWORD_KEY=MANUAL_PW
 *
 * Production default: https://oms.haseb.org/api as the QA admin (tmp/.qa.env QA_PASSWORD, never printed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { apiSession, items, n, readPassword } from "../r20/payment-status-audit.lib.mjs";

const API = process.env.API ?? "https://oms.haseb.org/api";
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const password = readPassword(
  process.env.PASSWORD_FILE ?? "D:/Systems/OMS/tmp/.qa.env",
  process.env.PASSWORD_KEY ?? "QA_PASSWORD",
);
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex > 0 ? process.argv[outIndex + 1] : null;

const session = await apiSession({ api: API, email: EMAIL, password });
const get = session.get;
const safe = (p) => get(p).catch((e) => ({ __error: String(e.message ?? e) }));

async function all(path) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await get(`${path}${sep}page=${page}&pageSize=200`);
    const batch = items(json);
    rows.push(...batch);
    if (batch.length < 200 || rows.length >= (json?.total ?? rows.length)) break;
  }
  return rows;
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const settings = await safe("/accounting/posting-settings");
const functional = settings?.functionalCurrency?.code ?? null;

const VOUCHER_PATHS = {
  CUSTOMER_RECEIPT: "/financial-transactions/receipts",
  SUPPLIER_PAYMENT: "/financial-transactions/payments",
  CUSTOMER_REFUND: "/financial-transactions/refunds",
  EXPENSE_PAYMENT: "/financial-transactions/expense-payments",
};

const vouchers = [];
for (const [type, path] of Object.entries(VOUCHER_PATHS)) {
  const rows = await all(path).catch(() => []);
  for (const v of rows) {
    const entries = items(await safe(`/journal-entries?sourceId=${v.id}&pageSize=50`));
    const detailed = [];
    for (const e of entries) {
      const full = await safe(`/journal-entries/${e.id}`);
      detailed.push({
        entryNumber: full.entryNumber ?? e.entryNumber,
        status: full.status ?? e.status,
        sourceType: full.sourceType ?? e.sourceType,
        sourceId: full.sourceId ?? e.sourceId,
        entryDate: day(full.entryDate ?? e.entryDate),
        currency: full.currency?.code ?? null,
        exchangeRate: full.exchangeRate != null ? Number(full.exchangeRate) : null,
        lines: (full.lines ?? []).map((l) => ({
          account: `${l.account?.code ?? ""} ${l.account?.name ?? ""}`.trim(),
          partner: l.partner?.name ?? null,
          debit: n(l.debit),
          credit: n(l.credit),
        })),
      });
    }
    const allocated = n((v.allocations ?? []).reduce((s, a) => s + Number(a.allocatedAmount), 0));
    vouchers.push({
      type,
      id: v.id,
      number: v.transactionNumber,
      status: v.status,
      partner: v.partner?.name ?? null,
      partnerId: v.partnerId ?? null,
      currency: v.currency?.code ?? functional,
      amount: n(v.amount),
      fee: n(v.feeAmount),
      allocated,
      unapplied: n(Number(v.amount) + Number(v.feeAmount ?? 0) - allocated),
      allocations: (v.allocations ?? []).map((a) => ({
        document:
          a.salesInvoice?.invoiceNumber ??
          a.purchaseInvoice?.invoiceNumber ??
          a.salesReturn?.returnNumber ??
          (a.storeOrder ? `ORDER ${a.storeOrder.internalOrderId}` : null),
        amount: n(a.allocatedAmount),
      })),
      account: v.receivingAccount?.name ?? null,
      transactionDate: day(v.transactionDate),
      confirmedAt: day(v.confirmedAt),
      exchangeRate: v.exchangeRate != null ? Number(v.exchangeRate) : null,
      entries: detailed,
    });
  }
}

// Voucher-level findings.
const findings = [];
const flag = (kind, detail) => findings.push({ kind, ...detail });
for (const v of vouchers) {
  const posted = v.entries.filter((e) => e.status === "POSTED");
  if (v.status === "CONFIRMED" && posted.length === 0) flag("CONFIRMED_WITHOUT_ENTRY", { voucher: v.number });
  if (v.status === "DRAFT" && v.entries.length > 0) flag("DRAFT_WITH_ENTRY", { voucher: v.number });
  for (const e of v.entries) {
    if (e.sourceId !== v.id || e.sourceType !== v.type)
      flag("ENTRY_LINK_MISMATCH", { voucher: v.number, entry: e.entryNumber, sourceType: e.sourceType });
    const dr = n(e.lines.reduce((s, l) => s + l.debit, 0));
    const cr = n(e.lines.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(dr - cr) > 0.005) flag("UNBALANCED_ENTRY", { voucher: v.number, entry: e.entryNumber, dr, cr });
  }
  const original = v.entries.find((e) => e.status === "POSTED" || e.status === "REVERSED");
  if (v.status === "CONFIRMED" && original && v.transactionDate && original.entryDate !== v.transactionDate) {
    flag("ENTRY_DATE_NE_VOUCHER_DATE", {
      voucher: v.number,
      voucherDate: v.transactionDate,
      entryDate: original.entryDate,
    });
  }
  if (v.status === "CONFIRMED" && v.unapplied > 0.005 && v.type !== "EXPENSE_PAYMENT" && v.type !== "CUSTOMER_REFUND")
    flag("UNAPPLIED_MONEY", { voucher: v.number, partner: v.partner, unapplied: v.unapplied, currency: v.currency });
  if (v.status === "CANCELLED" && v.allocations.length > 0)
    flag("ALLOCATIONS_ON_CANCELLED_VOUCHER", { voucher: v.number });
  // Realized FX lines: neither the cash / bank line nor the partner (AR / AP) line.
  const fx = v.entries.flatMap((e) =>
    e.lines.filter((l) => !l.partner && /FX|فروق|فرق/i.test(l.account) && !/مصرف|بنك|صندوق|خزين/.test(l.account)),
  );
  if (fx.length) flag("FX_LINES", { voucher: v.number, currency: v.currency, fx });
}

// Partner reconciliation (customers + suppliers).
const sales = await all("/sales/invoices");
const purchases = await all("/purchasing/invoices");
const salesReturns = await all("/sales/returns").catch(() => []);
const purchaseReturns = await all("/purchasing/returns").catch(() => []);
const arAging = await safe("/accounting/reports/ar-aging");
const apAging = await safe("/accounting/reports/ap-aging");

const partners = new Map();
const touch = (id, name, side) => {
  if (!id) return;
  const key = `${side}:${id}`;
  if (!partners.has(key)) partners.set(key, { side, partnerId: id, partner: name });
};
for (const i of sales) touch(i.partnerId, i.partner?.name, "AR");
for (const i of purchases) touch(i.partnerId, i.partner?.name, "AP");
for (const v of vouchers) {
  if (v.type === "CUSTOMER_RECEIPT" || v.type === "CUSTOMER_REFUND") touch(v.partnerId, v.partner, "AR");
  if (v.type === "SUPPLIER_PAYMENT") touch(v.partnerId, v.partner, "AP");
}

const partnerRows = [];
for (const p of partners.values()) {
  const isAR = p.side === "AR";
  const invoices = (isAR ? sales : purchases).filter((i) => i.partnerId === p.partnerId);
  const returns = (isAR ? salesReturns : purchaseReturns).filter((r) => r.partnerId === p.partnerId);
  const statement = await safe(
    `/accounting/reports/partner-statement?partnerId=${p.partnerId}&controlType=${isAR ? "RECEIVABLE" : "PAYABLE"}`,
  );
  const position = await safe(
    `/financial-transactions/${isAR ? "receipts" : "payments"}/position?partnerId=${p.partnerId}`,
  );
  const aging = (isAR ? arAging : apAging)?.partners?.find((r) => r.partnerId === p.partnerId) ?? null;
  const partnerVouchers = vouchers.filter(
    (v) => v.partnerId === p.partnerId && v.status === "CONFIRMED" && (isAR ? v.type !== "SUPPLIER_PAYMENT" : v.type === "SUPPLIER_PAYMENT"),
  );
  const currencies = [
    ...new Set([...invoices.map((i) => i.currency?.code ?? functional), ...partnerVouchers.map((v) => v.currency)]),
  ];
  const posted = invoices.filter((i) => ["CONFIRMED", "CLOSED"].includes(i.status));
  const openRemaining = n(posted.reduce((s, i) => s + Number(i.remainingBalance ?? 0), 0));
  const postedReturns = returns.filter((r) => ["CONFIRMED", "CLOSED"].includes(r.status));
  // Statement is debit-positive in functional currency; AP payable shows as negative.
  const ledger = statement?.closingBalance != null ? n(isAR ? statement.closingBalance : -statement.closingBalance) : null;
  const agingNet = aging ? n(aging.net) : 0;
  const row = {
    side: p.side,
    partner: p.partner,
    currencies,
    invoices: posted.map((i) => ({
      number: i.invoiceNumber,
      currency: i.currency?.code ?? functional,
      total: n(i.grandTotal),
      paid: n(i.allocatedTotal),
      remaining: n(i.remainingBalance),
      status: i.paymentStatus,
    })),
    creditNotes: postedReturns.map((r) => ({
      number: r.returnNumber,
      invoice: r.salesInvoice?.invoiceNumber ?? r.purchaseInvoice?.invoiceNumber ?? null,
      total: n(r.grandTotal),
    })),
    openRemaining,
    aging: aging ? { total: n(aging.total), unapplied: n(aging.unapplied), net: agingNet } : null,
    ledgerClosingFunctional: ledger,
    position: Array.isArray(position) ? position : position?.__error ?? null,
    statementMovements: statement?.movements?.length ?? null,
  };
  // Only comparable when every document is in the functional currency.
  if (ledger != null && currencies.every((c) => c === functional)) {
    row.gapLedgerVsAgingNet = n(ledger - agingNet);
    if (Math.abs(row.gapLedgerVsAgingNet) > 0.005) flag("LEDGER_NE_AGING_NET", { partner: p.partner, side: p.side, ledger, agingNet });
  }
  for (const r of postedReturns) {
    const inv = (r.salesInvoiceId ?? r.purchaseInvoiceId)
      ? invoices.find((i) => i.id === (r.salesInvoiceId ?? r.purchaseInvoiceId))
      : null;
    if (inv && Number(inv.remainingBalance) > 0.005)
      flag("CREDIT_NOTE_NOT_IN_INVOICE_REMAINING", {
        partner: p.partner,
        invoice: inv.invoiceNumber,
        creditNote: r.returnNumber,
        creditTotal: n(r.grandTotal),
        invoiceRemaining: n(inv.remainingBalance),
        status: inv.paymentStatus,
      });
  }
  partnerRows.push(row);
}

// Aging totals per currency (the API adds them into one figure).
const agingByCurrency = {};
for (const [side, aging, docs, type] of [
  ["AR", arAging, sales, "CUSTOMER_RECEIPT"],
  ["AP", apAging, purchases, "SUPPLIER_PAYMENT"],
]) {
  const byNumber = new Map(docs.map((d) => [d.invoiceNumber, d.currency?.code ?? functional]));
  const per = {};
  const bump = (cur, key, value) => {
    per[cur] ??= { open: 0, unapplied: 0 };
    per[cur][key] = n(per[cur][key] + value);
  };
  for (const row of aging?.invoices ?? []) bump(byNumber.get(row.invoiceNumber) ?? "?", "open", Number(row.remaining));
  for (const v of vouchers.filter((x) => x.type === type && x.status === "CONFIRMED" && x.unapplied > 0.005))
    bump(v.currency, "unapplied", v.unapplied);
  agingByCurrency[side] = { apiTotals: aging?.totals ?? null, perCurrency: per };
  if (Object.keys(per).length > 1)
    flag("AGING_TOTALS_ADD_CURRENCIES", { side, apiTotal: aging?.totals?.total, apiUnapplied: aging?.totals?.unapplied, perCurrency: per });
}

const integrity = await safe("/accounting/reports/voucher-integrity");
const cash = await safe("/accounting/reports/cash-availability");
await session.logout();

const report = {
  api: API,
  at: new Date().toISOString(),
  functional,
  counts: {
    vouchers: vouchers.reduce((m, v) => ({ ...m, [`${v.type}/${v.status}`]: (m[`${v.type}/${v.status}`] ?? 0) + 1 }), {}),
    salesInvoices: sales.length,
    purchaseInvoices: purchases.length,
    salesReturns: salesReturns.length,
    purchaseReturns: purchaseReturns.length,
  },
  agingTotals: { AR: arAging?.totals ?? null, AP: apAging?.totals ?? null },
  agingByCurrency,
  findingsByKind: findings.reduce((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {}),
  findings,
  partners: partnerRows,
  vouchers,
  integrity: integrity?.summary ?? integrity,
  cashAvailability: cash,
};
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ counts: report.counts, agingTotals: report.agingTotals, findingsByKind: report.findingsByKind }, null, 2));
for (const f of findings) console.log(JSON.stringify(f));
for (const r of partnerRows)
  console.log(
    JSON.stringify({
      side: r.side,
      partner: r.partner,
      currencies: r.currencies,
      open: r.openRemaining,
      aging: r.aging,
      ledger: r.ledgerClosingFunctional,
      gap: r.gapLedgerVsAgingNet,
    }),
  );
