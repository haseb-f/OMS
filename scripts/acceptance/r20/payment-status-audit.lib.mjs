/**
 * R20 C — shared, read-only payment-status audit (GET only). Used by `r20-payment-status-audit.mjs` (report)
 * and `r20-repair-payment-status.mjs` (dry run / repair).
 *
 * For every sales + purchase invoice it recomputes "paid" from the CONFIRMED receipts' / supplier payments'
 * allocations (the voucher lists) and compares it with what each surface returns: invoice list, invoice
 * detail, the receipt editor's open-invoices list, AR / AP aging. It flags allocation shapes that would make
 * a status wrong — allocations kept by a cancelled voucher, allocations on a non-posted or cancelled invoice,
 * a voucher in another currency than its invoice, one invoice twice on a voucher, over-allocated vouchers /
 * invoices — and draft vouchers the R20 rules would refuse at Confirm.
 */

import { readFileSync } from "node:fs";

const EPS = 0.005;
export const n = (v) => Math.round(Number(v ?? 0) * 100) / 100;
export const items = (j) => j?.items ?? j?.data ?? (Array.isArray(j) ? j : []);

/** The one rule (apps/api/.../invoice-payment.util.ts) — restated only to check the API against it. */
export function expectedPayment(grandTotal, allocated, documentStatus) {
  const total = n(grandTotal);
  const paid = n(allocated);
  const remaining = Math.max(n(total - paid), 0);
  let status = paid <= 0 ? "UNPAID" : remaining <= 0 ? "PAID" : "PARTIALLY_PAID";
  if (documentStatus === "CANCELLED") status = "CANCELLED";
  return { allocatedTotal: paid, remainingBalance: remaining, paymentStatus: status };
}

const POSTED = new Set(["CONFIRMED", "CLOSED"]);

export const SIDES = [
  {
    side: "AR",
    invoicesPath: "/sales/invoices",
    detailPath: (id) => `/sales/invoices/${id}`,
    vouchersPath: "/financial-transactions/receipts",
    voucherPath: (id) => `/financial-transactions/receipts/${id}`,
    openPath: (partnerId) => `/financial-transactions/receipts/open-invoices?partnerId=${partnerId}`,
    agingPath: "/accounting/reports/ar-aging",
    key: "salesInvoiceId",
  },
  {
    side: "AP",
    invoicesPath: "/purchasing/invoices",
    detailPath: (id) => `/purchasing/invoices/${id}`,
    vouchersPath: "/financial-transactions/payments",
    voucherPath: (id) => `/financial-transactions/payments/${id}`,
    openPath: (partnerId) => `/financial-transactions/payments/open-invoices?partnerId=${partnerId}`,
    agingPath: "/accounting/reports/ap-aging",
    key: "purchaseInvoiceId",
  },
];

async function all(get, path) {
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

/** `get(path)` → parsed JSON of a GET on the API (throws on non-2xx). */
export async function auditPaymentStatus(get) {
  const findings = [];
  const flag = (kind, detail) => findings.push({ kind, ...detail });
  const settings = await get("/accounting/posting-settings").catch(() => null);
  const functionalCode = settings?.functionalCurrency?.code ?? null;
  const summary = {};
  const invoiceTable = [];
  const drafts = [];

  for (const s of SIDES) {
    const invoices = await all(get, s.invoicesPath);
    const vouchers = await all(get, s.vouchersPath);
    const byId = new Map(invoices.map((inv) => [inv.id, inv]));
    const confirmedAllocated = new Map();
    const voucherCount = {};
    const currencyOf = (code) => code ?? functionalCode ?? "(functional)";
    for (const v of vouchers) {
      voucherCount[v.status] = (voucherCount[v.status] ?? 0) + 1;
      const lines = (v.allocations ?? []).filter((a) => a[s.key]);
      const allLines = v.allocations ?? [];
      if (v.status === "CANCELLED" && allLines.length > 0) {
        flag("ALLOCATION_ON_CANCELLED_VOUCHER", { side: s.side, voucher: v.transactionNumber, lines: allLines.length });
      }
      const seen = new Set();
      const draftReasons = [];
      for (const a of lines) {
        if (seen.has(a[s.key])) {
          flag("SAME_INVOICE_TWICE_ON_VOUCHER", { side: s.side, voucher: v.transactionNumber, status: v.status, invoiceId: a[s.key] });
          draftReasons.push("DUPLICATE_ALLOCATION");
        }
        seen.add(a[s.key]);
      }
      const sum = n(allLines.reduce((acc, a) => acc + Number(a.allocatedAmount), 0));
      if (sum - n(Number(v.amount) + Number(v.feeAmount ?? 0)) > EPS) {
        flag("VOUCHER_OVER_ALLOCATED", { side: s.side, voucher: v.transactionNumber, status: v.status, amount: n(v.amount), fee: n(v.feeAmount), allocated: sum });
      }
      for (const a of lines) {
        const inv = byId.get(a[s.key]);
        if (!inv) {
          flag("ALLOCATION_TO_UNLISTED_INVOICE", { side: s.side, voucher: v.transactionNumber, status: v.status, invoiceId: a[s.key], amount: n(a.allocatedAmount) });
          continue;
        }
        if (!POSTED.has(inv.status)) {
          flag("ALLOCATION_TO_NON_POSTED_INVOICE", { side: s.side, voucher: v.transactionNumber, status: v.status, invoice: inv.invoiceNumber, invoiceStatus: inv.status, amount: n(a.allocatedAmount) });
          draftReasons.push("INVOICE_NOT_POSTED");
        }
        if (inv.partnerId !== v.partnerId) {
          flag("ALLOCATION_TO_OTHER_PARTY", { side: s.side, voucher: v.transactionNumber, status: v.status, invoice: inv.invoiceNumber });
          draftReasons.push("OTHER_PARTY");
        }
        const vCur = currencyOf(v.currency?.code);
        const iCur = currencyOf(inv.currency?.code);
        if (vCur !== iCur) {
          flag("CURRENCY_MISMATCH", { side: s.side, voucher: v.transactionNumber, status: v.status, voucherCurrency: vCur, invoice: inv.invoiceNumber, invoiceCurrency: iCur, amount: n(a.allocatedAmount) });
          draftReasons.push("CURRENCY_MISMATCH");
        }
      }
      if (v.status === "DRAFT" && draftReasons.length > 0) {
        drafts.push({ side: s.side, id: v.id, voucher: v.transactionNumber, reasons: [...new Set(draftReasons)] });
      }
      if (v.status !== "CONFIRMED") continue;
      for (const a of lines) {
        confirmedAllocated.set(a[s.key], n((confirmedAllocated.get(a[s.key]) ?? 0) + Number(a.allocatedAmount)));
      }
    }

    const aging = await get(s.agingPath);
    const agingByInvoice = new Map((aging.invoices ?? []).map((row) => [row.invoiceId, row]));
    const partnersWithOpen = new Set();
    const statusCount = {};
    for (const inv of invoices) {
      const exp = expectedPayment(inv.grandTotal, confirmedAllocated.get(inv.id) ?? 0, inv.status);
      const key = `${inv.status}/${inv.paymentStatus}`;
      statusCount[key] = (statusCount[key] ?? 0) + 1;
      const listView = { allocatedTotal: n(inv.allocatedTotal), remainingBalance: n(inv.remainingBalance), paymentStatus: inv.paymentStatus };
      if (n(inv.allocatedTotal) > n(inv.grandTotal) + EPS) {
        flag("INVOICE_OVER_ALLOCATED", { side: s.side, invoice: inv.invoiceNumber, grandTotal: n(inv.grandTotal), allocated: n(inv.allocatedTotal) });
      }
      const differs = (view) =>
        Math.abs(view.allocatedTotal - exp.allocatedTotal) > EPS ||
        Math.abs(view.remainingBalance - exp.remainingBalance) > EPS ||
        view.paymentStatus !== exp.paymentStatus;
      if (differs(listView)) flag("LIST_STATUS_DIFFERS", { side: s.side, invoice: inv.invoiceNumber, list: listView, expected: exp });
      const detail = await get(s.detailPath(inv.id));
      const detailView = { allocatedTotal: n(detail.allocatedTotal), remainingBalance: n(detail.remainingBalance), paymentStatus: detail.paymentStatus };
      if (differs(detailView)) flag("DETAIL_STATUS_DIFFERS", { side: s.side, invoice: inv.invoiceNumber, detail: detailView, expected: exp });
      const agingRow = agingByInvoice.get(inv.id);
      const agingRemaining = agingRow ? n(agingRow.remaining) : 0;
      const agingExpected = POSTED.has(inv.status) ? exp.remainingBalance : 0;
      if (Math.abs(agingRemaining - agingExpected) > EPS) {
        flag("AGING_DIFFERS", { side: s.side, invoice: inv.invoiceNumber, aging: agingRemaining, expected: agingExpected });
      }
      if (POSTED.has(inv.status) && exp.remainingBalance > 0) partnersWithOpen.add(inv.partnerId);
      invoiceTable.push({
        side: s.side,
        invoice: inv.invoiceNumber,
        partner: inv.partner?.name,
        currency: inv.currency?.code ?? null,
        documentStatus: inv.status,
        grandTotal: n(inv.grandTotal),
        ...listView,
        recomputedPaid: exp.allocatedTotal,
        recomputedStatus: exp.paymentStatus,
      });
    }
    for (const partnerId of partnersWithOpen) {
      const rows = await get(s.openPath(partnerId));
      const offered = new Map(rows.map((row) => [row.invoiceId, row]));
      for (const inv of invoices.filter((i) => i.partnerId === partnerId && POSTED.has(i.status))) {
        const exp = expectedPayment(inv.grandTotal, confirmedAllocated.get(inv.id) ?? 0, inv.status);
        const row = offered.get(inv.id);
        if (exp.remainingBalance > 0 && !row) flag("OPEN_INVOICE_MISSING", { side: s.side, invoice: inv.invoiceNumber, remaining: exp.remainingBalance });
        if (row && Math.abs(n(row.remainingBalance) - exp.remainingBalance) > EPS) {
          flag("OPEN_INVOICE_DIFFERS", { side: s.side, invoice: inv.invoiceNumber, offered: n(row.remainingBalance), expected: exp.remainingBalance });
        }
      }
    }
    summary[s.side] = { invoices: invoices.length, vouchers: voucherCount, byStatus: statusCount, agingTotals: aging.totals };
  }

  const integrity = await get("/accounting/reports/voucher-integrity").catch((e) => ({ error: String(e) }));
  const findingsByKind = findings.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
  return {
    functionalCurrency: functionalCode,
    summary,
    findingsByKind,
    findings,
    drafts,
    integrity: integrity?.summary ?? integrity,
    invoices: invoiceTable,
  };
}

/** Signs in and returns `{ get, call, logout }` for the API (password never printed). */
export async function apiSession({ api, email, password }) {
  const login = await fetch(`${api}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { accessToken } = await login.json();
  if (!accessToken) throw new Error(`login failed (${login.status})`);
  const call = async (method, path, body) => {
    const r = await fetch(`${api}${path}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)?.slice(0, 300)}`);
    return json;
  };
  return {
    get: (path) => call("GET", path),
    call,
    logout: () =>
      fetch(`${api}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }),
  };
}

/** A `KEY=value` line of an env file (the value is never printed). */
export function readPassword(file, key) {
  if (process.env.PASSWORD) return process.env.PASSWORD;
  const prefix = new RegExp(`^\\s*(export\\s+)?${key}=`);
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => prefix.test(l));
  if (!line) throw new Error(`${key} not found in ${file}`);
  return line
    .replace(prefix, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}
