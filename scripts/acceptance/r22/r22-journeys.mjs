#!/usr/bin/env node
/**
 * R22 — integrated API journeys for receipts, payments and invoice settlement
 * (customer: sales invoice + receipt; supplier: purchase invoice + supplier
 * payment) plus the D4 operation types (other receipt / payment, transfer,
 * advance refund). LOCAL API ONLY — refuses any non-local URL.
 *
 *   API=http://localhost:4945 node scripts/acceptance/r22/r22-journeys.mjs
 *
 * Creates its own partners / invoices / vouchers (fresh partners per journey
 * so statements and aging are isolated). Password from tmp/r15-manual/.env
 * MANUAL_PW (never printed). Output:
 * specs/round22-settlement/evidence/journeys/journeys.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const API = (process.env.API ?? "http://localhost:4945").replace(/\/$/, "");
if (/haseb|vercel/i.test(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  throw new Error(`local API only — refusing ${API}`);
}
const OUT = process.env.OUT ?? "specs/round22-settlement/evidence/journeys";
mkdirSync(OUT, { recursive: true });
const PW = readFileSync(process.env.PW_FILE ?? "D:/Systems/OMS/tmp/r15-manual/.env", "utf8")
  .match(/MANUAL_PW=(.*)/)[1]
  .trim();
const EMAIL = process.env.EMAIL ?? "admin@oms-demo.local";

// ------------------------------------------------------------------ recording
const results = [];
let current = "setup";
const check = (name, ok, detail = undefined) => {
  results.push({ journey: current, check: name, ok: !!ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  [${current}] ${name}${ok ? "" : `  ${JSON.stringify(detail).slice(0, 600)}`}`,
  );
  return !!ok;
};
const eq = (name, actual, expected) => check(name, near(actual, expected), { actual, expected });
const near = (a, b) => (typeof b === "number" ? Math.abs(Number(a) - b) < 0.005 : a === b);
const journey = async (name, fn) => {
  current = name;
  try {
    await fn();
  } catch (error) {
    check("step error", false, String(error?.message ?? error).slice(0, 1500));
  }
};

// ------------------------------------------------------------------ HTTP
async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.accessToken) throw new Error(`login failed for ${email}: ${r.status} ${j?.code ?? ""}`);
  return j.accessToken;
}
const client = (token) => {
  /** Raw call: never throws on HTTP status. */
  const raw = async (method, path, body) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, body: json, request: { method, path, body } };
  };
  /** Throwing call: the error carries the exact request and response. */
  const call = async (method, path, body) => {
    const res = await raw(method, path, body);
    if (res.status >= 400) {
      throw new Error(
        `${method} ${path} ${body ? JSON.stringify(body).slice(0, 400) : ""} → ${res.status} ${JSON.stringify(res.body).slice(0, 600)}`,
      );
    }
    return res.body;
  };
  return { raw, call };
};
const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);
const num = (v) => Number(v ?? 0);
const RUN_STARTED = new Date(Date.now() - 1000).toISOString();
const stamp = Date.now().toString(36).toUpperCase();
let seq = 0;
const key = (label) => `r22j-${label}-${stamp}-${++seq}`;

const admin = client(await login(EMAIL, PW));
const { call, raw } = admin;

// ------------------------------------------------------------------ fixtures
const products = items(await call("GET", "/products?pageSize=100"));
const usable = (p) => p.status === "ACTIVE" && !p.ownerAgentId && !p.isInventoryItem;
const sellable = products.find((p) => usable(p) && p.isSellable);
const purchasable = products.find((p) => usable(p) && p.isPurchasable) ?? sellable;
const warehouses = items(await call("GET", "/warehouses?pageSize=50"));
const warehouse =
  warehouses.find((w) => w.isDefault && w.isActive) ?? warehouses.find((w) => w.isActive);
const settings = await call("GET", "/accounting/posting-settings");
const receiving = items(await call("GET", "/receiving-accounts?pageSize=100")).filter(
  (a) => a.isActive,
);
const bank = receiving.find((a) => a.code === "BANK-01") ?? receiving.find((a) => !a.currencyId);
const cash =
  receiving.find((a) => a.code === "CASH-01" && a.id !== bank.id) ??
  receiving.find(
    (a) => a.id !== bank.id && !a.currencyId && a.chartOfAccountId !== bank.chartOfAccountId,
  );
const BANK_GL = bank.chartOfAccountId;
const CASH_GL = cash.chartOfAccountId;

const line = (product, unitPrice, quantity = 1) => ({
  productId: product.id,
  unitId: product.unitId ?? product.unit?.id,
  quantity,
  unitPrice,
  warehouseId: warehouse?.id,
});
const newPartner = (role, label) =>
  call("POST", "/partners", {
    name: `${role === "CUSTOMER" ? "عميل" : "مورد"} R22J ${label} ${stamp}`,
    roles: [role],
  });

/** Direction-specific API surface. */
const SIDE = {
  customer: {
    role: "CUSTOMER",
    voucher: "/financial-transactions/receipts",
    invoice: "/sales/invoices",
    aging: "ar-aging",
    async createInvoice(partnerId, total, quantity = 1) {
      const draft = await call("POST", "/sales/invoices", {
        partnerId,
        referenceNumber: `R22J-S-${stamp}-${++seq}`,
        items: [line(sellable, total / quantity, quantity)],
      });
      return call("POST", `/sales/invoices/${draft.id}/confirm`);
    },
  },
  supplier: {
    role: "SUPPLIER",
    voucher: "/financial-transactions/payments",
    invoice: "/purchasing/invoices",
    aging: "ap-aging",
    async createInvoice(partnerId, total, quantity = 1) {
      const draft = await call("POST", "/purchasing/invoices", {
        partnerId,
        referenceNumber: `R22J-P-${stamp}-${++seq}`,
        items: [{ ...line(purchasable, total / quantity, quantity), unitCost: total / quantity }],
      });
      const direct = await raw("POST", `/purchasing/invoices/${draft.id}/confirm`);
      if (direct.status < 400) return direct.body;
      await raw("POST", `/purchasing/invoices/${draft.id}/submit`);
      await raw("POST", `/purchasing/invoices/${draft.id}/approve`);
      return call("POST", `/purchasing/invoices/${draft.id}/confirm`);
    },
  },
};

/** Invoice settlement as both the detail and the settlement endpoint report it. */
async function settlement(side, invoiceId) {
  const s = await call("GET", `${SIDE[side].invoice}/${invoiceId}/settlement`);
  return s;
}
async function expectInvoice(side, invoiceId, label, expected) {
  const s = await settlement(side, invoiceId);
  const detail = await call("GET", `${SIDE[side].invoice}/${invoiceId}`);
  for (const [field, value] of Object.entries(expected)) {
    eq(`${label}: settlement.${field} = ${value}`, s.summary[field], value);
    if (field in detail)
      eq(
        `${label}: detail.${field} = ${value}`,
        typeof value === "number" ? num(detail[field]) : detail[field],
        value,
      );
  }
  return s;
}
const voucherCreateConfirmed = (side, body) =>
  call("POST", `${SIDE[side].voucher}/confirmed`, { idempotencyKey: key(side), ...body });

/** Every journal entry of a source document (incl. reversals reached through `reversedByEntry`). */
async function entriesOf(sourceId) {
  return items(await call("GET", `/journal-entries?sourceId=${sourceId}&pageSize=50`));
}
function assertBalanced(label, entry) {
  const d = (entry.lines ?? []).reduce((s, l) => s + num(l.debit), 0);
  const c = (entry.lines ?? []).reduce((s, l) => s + num(l.credit), 0);
  check(
    `${label}: ${entry.entryNumber} balanced Σdebit = Σcredit (${d.toFixed(2)})`,
    Math.abs(d - c) < 0.005 && (entry.lines ?? []).length >= 2,
    { debit: d, credit: c, totalDebit: entry.totalDebit, totalCredit: entry.totalCredit },
  );
}
async function assertSourceBalanced(label, sourceId) {
  const list = await entriesOf(sourceId);
  for (const e of list) assertBalanced(label, e);
  return list;
}
/** Net movement (debit − credit) of a GL account in the entries of one source. */
const netOn = (entries, accountId) =>
  entries
    .filter((e) => e.status === "POSTED" || e.status === "REVERSED")
    .flatMap((e) => e.lines ?? [])
    .filter((l) => l.accountId === accountId)
    .reduce((s, l) => s + num(l.debit) - num(l.credit), 0);
const ledger = async (accountId) =>
  num(
    (await call("GET", `/accounting/reports/account-statement?accountId=${accountId}&pageSize=1`))
      .closingBalance,
  );
const agingOf = async (side, partnerId) =>
  call("GET", `/accounting/reports/${SIDE[side].aging}?partnerId=${partnerId}`);
const codeOf = (res) => res.body?.code;
const futureDate = () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

// =================================================================== journeys
for (const side of ["customer", "supplier"]) {
  const S = SIDE[side];
  const tag = side === "customer" ? "C" : "S";

  await journey(`J1 baseline 200,000 / 100,000 (${side})`, async () => {
    const partner = await newPartner(S.role, `J1${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    check("invoice posted (CONFIRMED)", invoice.status === "CONFIRMED", invoice.status);
    const invEntries = await assertSourceBalanced("invoice entry", invoice.id);
    check("invoice has one posted entry", invEntries.length === 1, invEntries.length);
    const bankBefore = await ledger(BANK_GL);
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 100000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 100000 }],
    });
    check("voucher CONFIRMED", v.status === "CONFIRMED", v.status);
    const s = await expectInvoice(side, invoice.id, "after 100,000", {
      grandTotal: 200000,
      paidTotal: 100000,
      remainingBalance: 100000,
      paymentStatus: "PARTIALLY_PAID",
    });
    const pay = s.entries.filter((e) => e.kind === "PAYMENT");
    check(
      "settlement lists the payment (voucher, 100,000)",
      pay.length === 1 && pay[0].documentId === v.id && near(pay[0].amount, 100000),
      s.entries,
    );
    const ve = await assertSourceBalanced("voucher entry", v.id);
    check(
      "exactly one entry linked to the voucher",
      ve.length === 1 && ve[0].sourceId === v.id,
      ve.map((e) => e.entryNumber),
    );
    eq(
      "bank GL line of the voucher = 100,000 (Dr for receipt, Cr for payment)",
      netOn(ve, BANK_GL),
      side === "customer" ? 100000 : -100000,
    );
    eq(
      "bank ledger closing balance moved by exactly 100,000",
      (await ledger(BANK_GL)) - bankBefore,
      side === "customer" ? 100000 : -100000,
    );
    const st = await call("GET", `/accounting/reports/partner-statement?partnerId=${partner.id}`);
    const kinds = st.movements.map((m) => m.sourceId);
    check(
      "partner statement shows invoice and payment",
      kinds.includes(invoice.id) && kinds.includes(v.id),
      st.movements.map((m) => m.sourceType),
    );
    eq(
      "partner statement closing balance = 100,000 (abs)",
      Math.abs(num(st.closingBalance)),
      100000,
    );
    const ag = await agingOf(side, partner.id);
    const row = ag.invoices.find((i) => i.invoiceId === invoice.id);
    eq("aging: invoice remaining 100,000", row?.remaining, 100000);
    eq(
      "aging: partner total open 100,000",
      ag.partners.find((p) => p.partnerId === partner.id)?.total,
      100000,
    );
  });

  await journey(`J2 full payment → PAID (${side})`, async () => {
    const partner = await newPartner(S.role, `J2${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 200000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 200000 }],
    });
    await assertSourceBalanced("voucher entry", v.id);
    await expectInvoice(side, invoice.id, "fully paid", {
      paidTotal: 200000,
      remainingBalance: 0,
      paymentStatus: "PAID",
    });
  });

  await journey(`J3 no payment → UNPAID (${side})`, async () => {
    const partner = await newPartner(S.role, `J3${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    await expectInvoice(side, invoice.id, "no payment", {
      paidTotal: 0,
      remainingBalance: 200000,
      paymentStatus: "UNPAID",
    });
  });

  await journey(`J4 multiple partial payments → PAID (${side})`, async () => {
    const partner = await newPartner(S.role, `J4${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    const parts = [50000, 70000.5, 79999.5];
    let paid = 0;
    for (const amount of parts) {
      const v = await voucherCreateConfirmed(side, {
        partnerId: partner.id,
        amount,
        receivingAccountId: bank.id,
        allocations: [{ invoiceId: invoice.id, allocatedAmount: amount }],
      });
      await assertSourceBalanced(`instalment ${amount}`, v.id);
      paid += amount;
      if (paid < 200000)
        await expectInvoice(side, invoice.id, `after ${paid}`, {
          paidTotal: paid,
          remainingBalance: 200000 - paid,
          paymentStatus: "PARTIALLY_PAID",
        });
    }
    const s = await expectInvoice(side, invoice.id, "after the 3rd instalment", {
      paidTotal: 200000,
      remainingBalance: 0,
      paymentStatus: "PAID",
    });
    check(
      "settlement history lists 3 payments",
      s.entries.filter((e) => e.kind === "PAYMENT").length === 3,
      s.entries.length,
    );
  });

  await journey(`J5 overpayment (${side})`, async () => {
    const partner = await newPartner(S.role, `J5${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    const refused = await raw("POST", `${S.voucher}/confirmed`, {
      partnerId: partner.id,
      amount: 250000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 250000 }],
      idempotencyKey: key("over"),
    });
    check(
      "allocation > remaining refused ALLOCATION_EXCEEDS_INVOICE_BALANCE",
      refused.status === 400 && codeOf(refused) === "ALLOCATION_EXCEEDS_INVOICE_BALANCE",
      { status: refused.status, body: refused.body },
    );
    await expectInvoice(side, invoice.id, "after refused overpayment", {
      paidTotal: 0,
      paymentStatus: "UNPAID",
    });
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 250000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 200000 }],
    });
    const ve = await assertSourceBalanced("voucher 250,000", v.id);
    eq("cash line is the full 250,000", Math.abs(netOn(ve, BANK_GL)), 250000);
    await expectInvoice(side, invoice.id, "voucher larger than invoice", {
      paidTotal: 200000,
      remainingBalance: 0,
      paymentStatus: "PAID",
    });
    const ag = await agingOf(side, partner.id);
    eq(
      "aging: 50,000 excess stays unapplied",
      ag.partners.find((p) => p.partnerId === partner.id)?.unapplied,
      50000,
    );
    if (side === "customer") {
      const pos = await call(
        "GET",
        `/financial-transactions/receipts/position?partnerId=${partner.id}`,
      );
      check(
        "receipt position reports 50,000 unapplied",
        JSON.stringify(pos).includes("50000"),
        pos,
      );
    }
  });

  await journey(`J6 advance then allocate / change / unallocate (${side})`, async () => {
    const partner = await newPartner(S.role, `J6${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    const bank0 = await ledger(BANK_GL);
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 80000,
      receivingAccountId: bank.id,
      allocations: [],
    });
    const e1 = await assertSourceBalanced("advance entry", v.id);
    check("advance posts one entry", e1.length === 1, e1.length);
    const bank1 = await ledger(BANK_GL);
    eq("advance moved the bank by 80,000", bank1 - bank0, side === "customer" ? 80000 : -80000);
    await expectInvoice(side, invoice.id, "advance not yet allocated", {
      paidTotal: 0,
      paymentStatus: "UNPAID",
    });
    const allocated = await call("POST", `${S.voucher}/${v.id}/allocate`, {
      invoiceId: invoice.id,
      allocatedAmount: 50000,
    });
    const alloc = (allocated.allocations ?? []).find(
      (a) => (a.salesInvoiceId ?? a.purchaseInvoiceId) === invoice.id,
    );
    check(
      "allocate returns the fresh voucher with the line",
      !!alloc && near(alloc.allocatedAmount, 50000),
      allocated.allocations,
    );
    await expectInvoice(side, invoice.id, "after allocate 50,000", {
      paidTotal: 50000,
      remainingBalance: 150000,
      paymentStatus: "PARTIALLY_PAID",
    });
    const e2 = await entriesOf(v.id);
    check(
      "allocation adds NO second cash entry",
      e2.length === 1,
      e2.map((e) => e.entryNumber),
    );
    eq("bank ledger unchanged by the allocation", await ledger(BANK_GL), bank1);
    const patched = await call("PATCH", `${S.voucher}/${v.id}/allocations/${alloc.id}`, {
      allocatedAmount: 70000,
    });
    check("PATCH returns the voucher with updatedAt", !!patched.updatedAt, Object.keys(patched));
    await expectInvoice(side, invoice.id, "after PATCH 70,000", {
      paidTotal: 70000,
      remainingBalance: 130000,
      paymentStatus: "PARTIALLY_PAID",
    });
    const patchOver = await raw("PATCH", `${S.voucher}/${v.id}/allocations/${alloc.id}`, {
      allocatedAmount: 90000,
    });
    check(
      "PATCH above the voucher amount refused (old line kept)",
      patchOver.status >= 400 && patchOver.status < 500,
      { status: patchOver.status, body: patchOver.body },
    );
    await expectInvoice(side, invoice.id, "after refused PATCH", { paidTotal: 70000 });
    check("PATCH adds no entry", (await entriesOf(v.id)).length === 1);
    eq("bank ledger unchanged by PATCH", await ledger(BANK_GL), bank1);
    const lineId =
      (patched.allocations ?? []).find(
        (a) => (a.salesInvoiceId ?? a.purchaseInvoiceId) === invoice.id,
      )?.id ?? alloc.id;
    await call("POST", `${S.voucher}/${v.id}/allocations/${lineId}/unallocate`);
    await expectInvoice(side, invoice.id, "after unallocate", {
      paidTotal: 0,
      remainingBalance: 200000,
      paymentStatus: "UNPAID",
    });
    check("unallocate adds no entry (same currency)", (await entriesOf(v.id)).length === 1);
    eq("bank ledger unchanged by unallocate", await ledger(BANK_GL), bank1);
    const ag = await agingOf(side, partner.id);
    eq(
      "aging: 80,000 unapplied again",
      ag.partners.find((p) => p.partnerId === partner.id)?.unapplied,
      80000,
    );
  });

  await journey(`J7 one voucher across two invoices (${side})`, async () => {
    const partner = await newPartner(S.role, `J7${tag}`);
    const a = await S.createInvoice(partner.id, 120000);
    const b = await S.createInvoice(partner.id, 80000);
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 150000,
      receivingAccountId: bank.id,
      allocations: [
        { invoiceId: a.id, allocatedAmount: 120000 },
        { invoiceId: b.id, allocatedAmount: 30000 },
      ],
    });
    const ve = await assertSourceBalanced("voucher entry", v.id);
    check("one entry for the multi-invoice voucher", ve.length === 1, ve.length);
    await expectInvoice(side, a.id, "invoice A", {
      paidTotal: 120000,
      remainingBalance: 0,
      paymentStatus: "PAID",
    });
    await expectInvoice(side, b.id, "invoice B", {
      paidTotal: 30000,
      remainingBalance: 50000,
      paymentStatus: "PARTIALLY_PAID",
    });
    const sb = await settlement(side, b.id);
    check(
      "invoice B settlement lists the same voucher",
      sb.entries.some((e) => e.documentId === v.id && near(e.amount, 30000)),
      sb.entries,
    );
  });

  await journey(`J8 cancel a confirmed voucher (${side})`, async () => {
    const partner = await newPartner(S.role, `J8${tag}`);
    const invoice = await S.createInvoice(partner.id, 200000);
    await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 50000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 50000 }],
    });
    const v = await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 150000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 150000 }],
    });
    await expectInvoice(side, invoice.id, "before cancel", { paymentStatus: "PAID" });
    const bank1 = await ledger(BANK_GL);
    const cancelled = await call("POST", `${S.voucher}/${v.id}/cancel`);
    check("voucher CANCELLED", cancelled.status === "CANCELLED", cancelled.status);
    const original = (await entriesOf(v.id)).find((e) => !e.reversalOfEntryId);
    const detail = await call("GET", `/journal-entries/${original.id}`);
    check("original entry is reversed", !!detail.reversedByEntry, {
      status: detail.status,
      reversedByEntry: detail.reversedByEntry?.entryNumber,
    });
    if (detail.reversedByEntry) {
      const rev = await call("GET", `/journal-entries/${detail.reversedByEntry.id}`);
      assertBalanced("reversing entry", rev);
      eq(
        "reversal mirrors the bank line",
        netOn([{ ...rev, status: "POSTED" }], BANK_GL),
        side === "customer" ? -150000 : 150000,
      );
    }
    eq(
      "bank ledger back by 150,000",
      (await ledger(BANK_GL)) - bank1,
      side === "customer" ? -150000 : 150000,
    );
    await expectInvoice(side, invoice.id, "after cancel", {
      paidTotal: 50000,
      remainingBalance: 150000,
      paymentStatus: "PARTIALLY_PAID",
    });
    const again = await raw("POST", `${S.voucher}/${v.id}/cancel`);
    const after = await call("GET", `/journal-entries/${original.id}`);
    check(
      "second cancel does not reverse twice",
      after.reversedByEntry?.id === detail.reversedByEntry?.id &&
        (again.status >= 400 || again.body?.status === "CANCELLED"),
      { status: again.status, code: codeOf(again) },
    );
  });

  await journey(`J9 credit note (${side})`, async () => {
    const partner = await newPartner(S.role, `J9${tag}`);
    const invoice = await S.createInvoice(partner.id, 100000, 2);
    await voucherCreateConfirmed(side, {
      partnerId: partner.id,
      amount: 50000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 50000 }],
    });
    const invItem = invoice.items?.[0];
    const base = side === "customer" ? "/sales/returns" : "/purchasing/returns";
    const product = side === "customer" ? sellable : purchasable;
    const body =
      side === "customer"
        ? {
            partnerId: partner.id,
            salesInvoiceId: invoice.id,
            items: [{ ...line(product, 50000, 1), salesInvoiceItemId: invItem?.id }],
          }
        : {
            partnerId: partner.id,
            purchaseInvoiceId: invoice.id,
            items: [{ ...line(product, 50000, 1), purchaseInvoiceItemId: invItem?.id }],
          };
    const draft = await call("POST", base, body);
    await call("POST", `${base}/${draft.id}/submit`);
    await call("POST", `${base}/${draft.id}/approve`);
    const ret = await call("POST", `${base}/${draft.id}/confirm`);
    check("return CONFIRMED (posted)", ret.status === "CONFIRMED", ret.status);
    await assertSourceBalanced("return entry", ret.id);
    const s = await expectInvoice(side, invoice.id, "cash 50,000 + credit 50,000", {
      grandTotal: 100000,
      paidTotal: 50000,
      creditedTotal: 50000,
      remainingBalance: 0,
      paymentStatus: "SETTLED",
    });
    check(
      "settlement lists the credit note apart from the payment",
      s.entries.some((e) => e.kind === "CREDIT_NOTE" && near(e.amount, 50000)) &&
        s.entries.some((e) => e.kind === "PAYMENT"),
      s.entries,
    );
    const over = await raw("POST", `${S.voucher}/confirmed`, {
      partnerId: partner.id,
      amount: 1000,
      receivingAccountId: bank.id,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 1000 }],
      idempotencyKey: key("cn"),
    });
    check(
      "a settled invoice refuses a further collection",
      over.status === 400 && codeOf(over) === "ALLOCATION_EXCEEDS_INVOICE_BALANCE",
      { status: over.status, body: over.body },
    );
    const ag = await agingOf(side, partner.id);
    check(
      "aging: settled invoice not open",
      !ag.invoices.some((i) => i.invoiceId === invoice.id && num(i.remaining) > 0.005),
      ag.invoices,
    );
  });
}

// ------------------------------------------------------------------ customer-only
await journey("J10 refund of an unapplied customer receipt", async () => {
  const partner = await newPartner("CUSTOMER", "J10");
  const receipt = await voucherCreateConfirmed("customer", {
    partnerId: partner.id,
    amount: 30000,
    receivingAccountId: bank.id,
    allocations: [],
  });
  const open0 = items(
    await call("GET", `/financial-transactions/refunds/open-receipts?partnerId=${partner.id}`),
  );
  eq(
    "open-receipts: 30,000 unapplied",
    open0.find((r) => r.receiptId === receipt.id)?.unapplied,
    30000,
  );
  const bank1 = await ledger(BANK_GL);
  const over = await raw("POST", "/financial-transactions/refunds/confirmed", {
    partnerId: partner.id,
    amount: 30001,
    receivingAccountId: bank.id,
    allocations: [{ receiptId: receipt.id, allocatedAmount: 30001 }],
    idempotencyKey: key("rf-over"),
  });
  check("refund above the unapplied amount refused", over.status >= 400 && over.status < 500, {
    status: over.status,
    code: codeOf(over),
    body: over.body,
  });
  const refund = await call("POST", "/financial-transactions/refunds/confirmed", {
    partnerId: partner.id,
    amount: 10000,
    receivingAccountId: bank.id,
    allocations: [{ receiptId: receipt.id, allocatedAmount: 10000 }],
    idempotencyKey: key("rf"),
  });
  check("refund CONFIRMED", refund.status === "CONFIRMED", refund.status);
  const re = await assertSourceBalanced("refund entry", refund.id);
  eq("refund: Cr bank 10,000", netOn(re, BANK_GL), -10000);
  eq("refund: Dr AR 10,000 (partner line)", netOn(re, settings.accountsReceivableAccountId), 10000);
  check(
    "refund AR line carries the partner",
    re
      .flatMap((e) => e.lines)
      .some(
        (l) => l.accountId === settings.accountsReceivableAccountId && l.partnerId === partner.id,
      ),
  );
  eq("bank ledger −10,000", (await ledger(BANK_GL)) - bank1, -10000);
  const open1 = items(
    await call("GET", `/financial-transactions/refunds/open-receipts?partnerId=${partner.id}`),
  );
  eq(
    "receipt unapplied reduced to 20,000",
    open1.find((r) => r.receiptId === receipt.id)?.unapplied,
    20000,
  );
  const ag = await agingOf("customer", partner.id);
  eq(
    "aging unapplied 20,000",
    ag.partners.find((p) => p.partnerId === partner.id)?.unapplied ?? 0,
    20000,
  );
  const cancelReceipt = await raw("POST", `/financial-transactions/receipts/${receipt.id}/cancel`);
  check(
    "refunded receipt cannot be cancelled (RECEIPT_REFUNDED)",
    cancelReceipt.status >= 400 && codeOf(cancelReceipt) === "RECEIPT_REFUNDED",
    { status: cancelReceipt.status, body: cancelReceipt.body },
  );
});

// ------------------------------------------------------------------ D4 types
const counterIn = items(await call("GET", "/financial-transactions/counter-accounts?direction=IN"));
const counterOut = items(
  await call("GET", "/financial-transactions/counter-accounts?direction=OUT"),
);
const pickCounter = (list, types) =>
  list.find((a) => a.code === "311") ??
  list.find((a) => types.includes(a.accountType) && !a.currencyId);

await journey("J11 other receipt / other payment", async () => {
  const cin = pickCounter(counterIn, ["EQUITY", "LIABILITY"]);
  // Equity (owner drawing) — the demo DB's other OUT liabilities are agent
  // payables left unmapped by earlier fixtures (see journeys.md, observation O1).
  const cout = pickCounter(counterOut, ["EQUITY", "LIABILITY"]);
  check(
    "counter-accounts IN list is non-empty and excludes cash / bank / AR / AP",
    counterIn.length > 0 &&
      !counterIn.some((a) =>
        [
          BANK_GL,
          CASH_GL,
          settings.accountsReceivableAccountId,
          settings.accountsPayableAccountId,
        ].includes(a.id),
      ),
    counterIn.length,
  );
  check(
    "counter-accounts OUT list excludes cash / bank / AR / AP",
    counterOut.length > 0 &&
      !counterOut.some((a) =>
        [
          BANK_GL,
          CASH_GL,
          settings.accountsReceivableAccountId,
          settings.accountsPayableAccountId,
        ].includes(a.id),
      ),
    counterOut.length,
  );
  check(
    "VAT output (module-owned) is not in the IN list",
    !counterIn.some((a) => a.id === settings.vatOutputAccountId),
  );
  const bank0 = await ledger(BANK_GL);
  const or = await call("POST", "/financial-transactions/other-receipts/confirmed", {
    counterAccountId: cin.id,
    receivingAccountId: bank.id,
    amount: 7500,
    description: "R22J capital top-up",
    idempotencyKey: key("or"),
  });
  check(
    "other receipt CONFIRMED with OR- number",
    or.status === "CONFIRMED" && /^OR-/.test(or.transactionNumber),
    or.transactionNumber,
  );
  check("other receipt has no partner", !or.partnerId);
  const oe = await assertSourceBalanced("other receipt entry", or.id);
  eq("other receipt: Dr bank 7,500", netOn(oe, BANK_GL), 7500);
  eq(`other receipt: Cr counter ${cin.code} 7,500`, netOn(oe, cin.id), -7500);
  check(
    "other receipt lines: only bank + counter, no partner",
    oe
      .flatMap((e) => e.lines)
      .every((l) => [BANK_GL, cin.id].includes(l.accountId) && !l.partnerId),
  );
  const op = await call("POST", "/financial-transactions/other-payments/confirmed", {
    counterAccountId: cout.id,
    receivingAccountId: bank.id,
    amount: 2500,
    idempotencyKey: key("op"),
  });
  check(
    "other payment CONFIRMED with OP- number",
    op.status === "CONFIRMED" && /^OP-/.test(op.transactionNumber),
    op.transactionNumber,
  );
  const pe = await assertSourceBalanced("other payment entry", op.id);
  eq(`other payment: Dr counter ${cout.code} 2,500`, netOn(pe, cout.id), 2500);
  eq("other payment: Cr bank 2,500", netOn(pe, BANK_GL), -2500);
  check(
    "other payment lines: no partner",
    pe.flatMap((e) => e.lines).every((l) => !l.partnerId),
  );
  eq("bank ledger +7,500 − 2,500", (await ledger(BANK_GL)) - bank0, 5000);
  const vat = await raw("POST", "/financial-transactions/other-receipts/confirmed", {
    counterAccountId: settings.vatOutputAccountId,
    receivingAccountId: bank.id,
    amount: 100,
    idempotencyKey: key("vat"),
  });
  check(
    "VAT output counter-account refused COUNTER_ACCOUNT_NOT_ALLOWED",
    vat.status === 400 && codeOf(vat) === "COUNTER_ACCOUNT_NOT_ALLOWED",
    { status: vat.status, body: vat.body },
  );
  const ar = await raw("POST", "/financial-transactions/other-payments/confirmed", {
    counterAccountId: settings.accountsReceivableAccountId,
    receivingAccountId: bank.id,
    amount: 100,
    idempotencyKey: key("ar"),
  });
  check(
    "AR control counter-account refused COUNTER_ACCOUNT_NOT_ALLOWED",
    ar.status === 400 && codeOf(ar) === "COUNTER_ACCOUNT_NOT_ALLOWED",
    { status: ar.status, body: ar.body },
  );
  const bankAsCounter = await raw("POST", "/financial-transactions/other-receipts/confirmed", {
    counterAccountId: CASH_GL,
    receivingAccountId: bank.id,
    amount: 100,
    idempotencyKey: key("cb"),
  });
  check(
    "cash ledger as counter-account refused COUNTER_ACCOUNT_NOT_ALLOWED",
    bankAsCounter.status === 400 && codeOf(bankAsCounter) === "COUNTER_ACCOUNT_NOT_ALLOWED",
    { status: bankAsCounter.status, body: bankAsCounter.body },
  );
  const allocAttempt = await raw("POST", "/financial-transactions/other-receipts", {
    counterAccountId: cin.id,
    receivingAccountId: bank.id,
    amount: 100,
    allocations: [{ invoiceId: "00000000-0000-4000-8000-000000000000", allocatedAmount: 100 }],
  });
  check(
    "other receipt refuses allocations",
    allocAttempt.status >= 400 && allocAttempt.status < 500,
    { status: allocAttempt.status, code: codeOf(allocAttempt) },
  );
  const cancel = await call("POST", `/financial-transactions/other-receipts/${or.id}/cancel`);
  check("other receipt cancel → CANCELLED", cancel.status === "CANCELLED", cancel.status);
  const od = await call("GET", `/journal-entries/${oe[0].id}`);
  check("other receipt entry reversed by the engine", !!od.reversedByEntry, od.status);
  if (od.reversedByEntry)
    assertBalanced(
      "other receipt reversal",
      await call("GET", `/journal-entries/${od.reversedByEntry.id}`),
    );
});

await journey("J12 internal transfer", async () => {
  const bank0 = await ledger(BANK_GL);
  const cash0 = await ledger(CASH_GL);
  const tr = await call("POST", "/financial-transactions/transfers/confirmed", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: cash.id,
    amount: 3000,
    idempotencyKey: key("tr"),
  });
  check(
    "transfer CONFIRMED with TR- number",
    tr.status === "CONFIRMED" && /^TR-/.test(tr.transactionNumber),
    tr.transactionNumber,
  );
  const te = await assertSourceBalanced("transfer entry", tr.id);
  eq("transfer: Dr destination (cash) 3,000", netOn(te, CASH_GL), 3000);
  eq("transfer: Cr source (bank) 3,000", netOn(te, BANK_GL), -3000);
  const lines = te.flatMap((e) => e.lines);
  check(
    "transfer: no income / expense / partner line",
    lines.every(
      (l) =>
        l.account?.accountType === "ASSET" &&
        !l.partnerId &&
        [BANK_GL, CASH_GL].includes(l.accountId),
    ),
    lines.map((l) => `${l.account?.code}:${l.account?.accountType}`),
  );
  eq("bank ledger −3,000", (await ledger(BANK_GL)) - bank0, -3000);
  eq("cash ledger +3,000", (await ledger(CASH_GL)) - cash0, 3000);
  const same = await raw("POST", "/financial-transactions/transfers", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: bank.id,
    amount: 5,
  });
  check("same account refused TRANSFER_SAME_ACCOUNT", codeOf(same) === "TRANSFER_SAME_ACCOUNT", {
    status: same.status,
    body: same.body,
  });
  // A receiving account in a foreign currency (created once in this local DB).
  const sar = items(await call("GET", "/currencies?search=SAR")).find((c) => c.code === "SAR");
  let foreign = receiving.find((a) => a.code === "R22J-SAR");
  if (!foreign) {
    const ledgerAccount =
      (await call("GET", `/receiving-accounts?pageSize=100`)).items.find(
        (a) => a.code === "AGT-FX-RA-5EDAFA",
      )?.chartOfAccountId ?? BANK_GL;
    foreign = await call("POST", "/receiving-accounts", {
      name: "R22J SAR bank",
      code: "R22J-SAR",
      currencyId: sar.id,
      chartOfAccountId: ledgerAccount,
      isActive: true,
    });
  }
  const cross = await raw("POST", "/financial-transactions/transfers", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: foreign.id,
    amount: 5,
  });
  check(
    "cross-currency refused 422 TRANSFER_CROSS_CURRENCY",
    cross.status === 422 && codeOf(cross) === "TRANSFER_CROSS_CURRENCY",
    { status: cross.status, body: cross.body },
  );
});

await journey("J13 drafts, double confirm, idempotent retry", async () => {
  const partner = await newPartner("CUSTOMER", "J13");
  const invoice = await SIDE.customer.createInvoice(partner.id, 10000);
  const draft = await call("POST", "/financial-transactions/receipts", {
    partnerId: partner.id,
    amount: 4000,
    receivingAccountId: bank.id,
    allocations: [{ invoiceId: invoice.id, allocatedAmount: 4000 }],
  });
  check("receipt draft is DRAFT", draft.status === "DRAFT", draft.status);
  check("draft receipt has no journal entry", (await entriesOf(draft.id)).length === 0);
  await expectInvoice("customer", invoice.id, "draft does not settle", {
    paidTotal: 0,
    paymentStatus: "UNPAID",
  });
  const c1 = await call("POST", `/financial-transactions/receipts/${draft.id}/confirm`);
  check("confirm → CONFIRMED", c1.status === "CONFIRMED", c1.status);
  check("one entry after confirm", (await entriesOf(draft.id)).length === 1);
  const c2 = await raw("POST", `/financial-transactions/receipts/${draft.id}/confirm`);
  check(
    "second confirm refused or idempotent",
    c2.status >= 400 ? c2.status < 500 : c2.body?.status === "CONFIRMED",
    { status: c2.status, code: codeOf(c2) },
  );
  check("still exactly one entry after double confirm", (await entriesOf(draft.id)).length === 1);
  await expectInvoice("customer", invoice.id, "after confirm", {
    paidTotal: 4000,
    paymentStatus: "PARTIALLY_PAID",
  });

  const odraft = await call("POST", "/financial-transactions/other-receipts", {
    counterAccountId: pickCounter(counterIn, ["EQUITY"]).id,
    receivingAccountId: bank.id,
    amount: 600,
  });
  check(
    "other receipt draft has no entry",
    odraft.status === "DRAFT" && (await entriesOf(odraft.id)).length === 0,
    odraft.status,
  );
  await call("POST", `/financial-transactions/other-receipts/${odraft.id}/confirm`);
  const oc2 = await raw("POST", `/financial-transactions/other-receipts/${odraft.id}/confirm`);
  check("other receipt double confirm → one entry", (await entriesOf(odraft.id)).length === 1, {
    second: oc2.status,
  });

  const k = key("idem");
  const body = {
    partnerId: partner.id,
    amount: 1000,
    receivingAccountId: bank.id,
    allocations: [{ invoiceId: invoice.id, allocatedAmount: 1000 }],
    idempotencyKey: k,
  };
  const [r1, r2] = await Promise.all([
    call("POST", "/financial-transactions/receipts/confirmed", body),
    call("POST", "/financial-transactions/receipts/confirmed", body),
  ]);
  const r3 = await call("POST", "/financial-transactions/receipts/confirmed", body);
  check(
    "createConfirmed retry (concurrent + later) returns the same voucher",
    r1.id === r2.id && r2.id === r3.id,
    [r1.transactionNumber, r2.transactionNumber, r3.transactionNumber],
  );
  check("idempotent voucher has one entry", (await entriesOf(r1.id)).length === 1);
  await expectInvoice("customer", invoice.id, "after idempotent retries", { paidTotal: 5000 });
  const reuse = await raw("POST", "/financial-transactions/receipts/confirmed", {
    ...body,
    amount: 1500,
    allocations: [{ invoiceId: invoice.id, allocatedAmount: 1500 }],
  });
  check("same key with a different body refused (409)", reuse.status === 409, {
    status: reuse.status,
    code: codeOf(reuse),
  });
  const tk = key("tr-idem");
  const t1 = await call("POST", "/financial-transactions/transfers/confirmed", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: cash.id,
    amount: 10,
    idempotencyKey: tk,
  });
  const t2 = await call("POST", "/financial-transactions/transfers/confirmed", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: cash.id,
    amount: 10,
    idempotencyKey: tk,
  });
  check(
    "transfer createConfirmed retry returns the same voucher",
    t1.id === t2.id && (await entriesOf(t1.id)).length === 1,
  );
});

await journey("J14 future date and fee cap", async () => {
  const partner = await newPartner("CUSTOMER", "J14");
  const invoice = await SIDE.customer.createInvoice(partner.id, 1000);
  const fut = await raw("POST", "/financial-transactions/receipts/confirmed", {
    partnerId: partner.id,
    amount: 100,
    receivingAccountId: bank.id,
    transactionDate: futureDate(),
    allocations: [{ invoiceId: invoice.id, allocatedAmount: 100 }],
    idempotencyKey: key("fut"),
  });
  check(
    "future receipt refused VOUCHER_DATE_IN_FUTURE",
    fut.status === 400 && codeOf(fut) === "VOUCHER_DATE_IN_FUTURE",
    { status: fut.status, body: fut.body },
  );
  const futOr = await raw("POST", "/financial-transactions/other-receipts", {
    counterAccountId: pickCounter(counterIn, ["EQUITY"]).id,
    receivingAccountId: bank.id,
    amount: 100,
    transactionDate: futureDate(),
  });
  check(
    "future other receipt refused VOUCHER_DATE_IN_FUTURE",
    futOr.status === 400 && codeOf(futOr) === "VOUCHER_DATE_IN_FUTURE",
    { status: futOr.status, body: futOr.body },
  );
  const futTr = await raw("POST", "/financial-transactions/transfers", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: cash.id,
    amount: 100,
    transactionDate: futureDate(),
  });
  check(
    "future transfer refused VOUCHER_DATE_IN_FUTURE",
    futTr.status === 400 && codeOf(futTr) === "VOUCHER_DATE_IN_FUTURE",
    { status: futTr.status, body: futTr.body },
  );
  const back = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const past = await call("POST", "/financial-transactions/receipts/confirmed", {
    partnerId: partner.id,
    amount: 100,
    receivingAccountId: bank.id,
    transactionDate: back,
    allocations: [{ invoiceId: invoice.id, allocatedAmount: 100 }],
    idempotencyKey: key("past"),
  });
  const pe = await entriesOf(past.id);
  check(
    "D1: entry dated on the voucher date (not today)",
    pe.length === 1 && pe[0].entryDate.slice(0, 10) === back,
    { entryDate: pe[0]?.entryDate, back },
  );
  // Fee cap: the receipt fee is only settable through bank-line reconciliation
  // (covered by r22 integration tests); the store-order payment actual fee is
  // the API-reachable fee field.
  const payment = items(await call("GET", "/payments?pageSize=5")).find((p) => num(p.amount) > 0);
  if (payment) {
    const fee = await raw("POST", `/payments/${payment.id}/fee`, {
      actualFeeAmount: num(payment.amount) + 1,
    });
    check(
      "payment actual fee > amount refused FEE_EXCEEDS_AMOUNT",
      fee.status === 400 && codeOf(fee) === "FEE_EXCEEDS_AMOUNT",
      { status: fee.status, body: fee.body },
    );
    const after = await call("GET", `/payments/${payment.id}`);
    check(
      "refused fee left the payment unchanged",
      String(after.actualFeeAmount) === String(payment.actualFeeAmount),
      { before: payment.actualFeeAmount, after: after.actualFeeAmount },
    );
  } else check("payment available for fee-cap check", false, "no /payments rows");
});

await journey("J15 permissions (D9: confirm = journal-entries.post)", async () => {
  const department = items(await call("GET", "/departments?pageSize=5"))[0];
  const pw = `R22j!${randomBytes(9).toString("base64url")}9a`;
  const email = `r22j-je-${stamp.toLowerCase()}@oms-demo.local`;
  const user = await call("POST", "/users", {
    email,
    username: `r22j-je-${stamp.toLowerCase()}`,
    fullName: `R22J JE creator ${stamp}`,
    password: pw,
    mustChangePassword: false,
    departmentId: department.id,
    isActive: true,
  });
  await call("POST", `/users/${user.id}/permissions`, {
    permissionNames: ["accounting.journal-entries.view", "accounting.journal-entries.create"],
  });
  const limited = client(await login(email, pw));
  const counter = pickCounter(counterIn, ["EQUITY"]).id;
  const draft = await limited.raw("POST", "/financial-transactions/other-receipts", {
    counterAccountId: counter,
    receivingAccountId: bank.id,
    amount: 50,
  });
  check(
    "view+create user can create an other-receipt draft",
    draft.status === 201 || draft.status === 200,
    { status: draft.status, code: codeOf(draft) },
  );
  if (draft.body?.id) {
    const conf = await limited.raw(
      "POST",
      `/financial-transactions/other-receipts/${draft.body.id}/confirm`,
    );
    check("view+create user: confirm other receipt → 403", conf.status === 403, {
      status: conf.status,
      body: conf.body,
    });
    check("no entry posted by the refused confirm", (await entriesOf(draft.body.id)).length === 0);
  }
  const cc = await limited.raw("POST", "/financial-transactions/other-receipts/confirmed", {
    counterAccountId: counter,
    receivingAccountId: bank.id,
    amount: 50,
    idempotencyKey: key("perm"),
  });
  check("view+create user: create+confirm → 403", cc.status === 403, {
    status: cc.status,
    code: codeOf(cc),
  });
  const tr = await limited.raw("POST", "/financial-transactions/transfers/confirmed", {
    receivingAccountId: bank.id,
    targetReceivingAccountId: cash.id,
    amount: 5,
    idempotencyKey: key("perm-tr"),
  });
  check("view+create user: transfer create+confirm → 403", tr.status === 403, {
    status: tr.status,
    code: codeOf(tr),
  });
  const rc = await limited.raw("GET", "/financial-transactions/receipts?pageSize=1");
  check("view+create user: customer receipts list → 403 (no receipts grant)", rc.status === 403, {
    status: rc.status,
  });
  await raw("POST", `/users/${user.id}/lock`).catch(() => null);
});

await journey("J16 voucher integrity after all journeys", async () => {
  const report = await call("GET", "/accounting/reports/voucher-integrity");
  check(
    "voucher-integrity: 0 errors",
    report.errors === 0,
    report.issues?.filter((i) => i.severity !== "REVIEW"),
  );
  const ours = (report.issues ?? []).filter((i) => (i.partnerName ?? "").includes(stamp));
  check(
    "only REVIEW items from this run are the two intended overpayment advances (J5)",
    ours.every((i) => i.severity === "REVIEW" && i.code === "PARTIAL_WITH_UNAPPLIED") &&
      ours.length === 2,
    ours.map((i) => `${i.code}:${i.documentNumber}`),
  );
  // Every journal entry this run created (invoices, returns, vouchers,
  // reversals) is balanced.
  const mine = [];
  for (let page = 1; page <= 20; page++) {
    const batch = items(
      await call(
        "GET",
        `/journal-entries?pageSize=100&page=${page}&sortBy=createdAt&sortOrder=desc`,
      ),
    );
    mine.push(...batch.filter((e) => e.createdAt >= RUN_STARTED));
    if (batch.length < 100 || batch.some((e) => e.createdAt < RUN_STARTED)) break;
  }
  const unbalanced = mine.filter((e) => {
    const d = (e.lines ?? []).reduce((s, l) => s + num(l.debit), 0);
    const c = (e.lines ?? []).reduce((s, l) => s + num(l.credit), 0);
    return Math.abs(d - c) >= 0.005 || (e.lines ?? []).length < 2;
  });
  check(
    `all ${mine.length} entries created by this run are balanced`,
    mine.length > 0 && !unbalanced.length,
    unbalanced.map((e) => e.entryNumber),
  );
});

// ------------------------------------------------------------------ summary
const byJourney = {};
for (const r of results) {
  byJourney[r.journey] ??= { pass: 0, fail: 0 };
  byJourney[r.journey][r.ok ? "pass" : "fail"]++;
}
const failed = results.filter((r) => !r.ok);
const summary = {
  api: API,
  ranAt: new Date().toISOString(),
  stamp,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  byJourney,
};
writeFileSync(`${OUT}/journeys.json`, JSON.stringify({ summary, results }, null, 2));
console.log(`\n${summary.passed}/${summary.total} checks passed`);
for (const [j, c] of Object.entries(byJourney))
  console.log(`${c.fail ? "FAIL" : "PASS"}  ${j}  (${c.pass}/${c.pass + c.fail})`);
process.exitCode = failed.length ? 1 : 0;
