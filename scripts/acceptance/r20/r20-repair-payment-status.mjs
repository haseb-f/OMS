#!/usr/bin/env node
/**
 * R20 C — repair of invoice payment statuses / allocations, through business operations only. DRY RUN by
 * default (GET only); `--apply` writes. Never SQL, never deletes a transaction, never invents a payment.
 *
 * Invoice payment status is not stored anywhere: list, detail, open invoices, aging and exports derive it
 * from the confirmed allocations every time (invoice-payment.util). So a wrong status can only come from
 * wrong ALLOCATIONS. The audit (`payment-status-audit.lib.mjs`) classifies what it finds:
 *
 *   DERIVED     a surface disagrees with the confirmed allocations → a code defect, fixed by the release;
 *               nothing to write (re-run after the release must show none).
 *   REPAIRABLE  a DRAFT voucher the R20 rules refuse at Confirm only because one invoice appears on two of
 *               its lines → `PATCH` the draft with one line per invoice (sum kept). Idempotent: once merged,
 *               a re-run finds nothing. Applied with `--apply` only.
 *   REVIEW      needs an owner decision, never applied here: a CONFIRMED voucher with another currency than
 *               its invoice, the same invoice twice, an allocation to a non-posted / cancelled invoice or to
 *               another party, an over-allocated voucher or invoice; a draft with a currency / party /
 *               non-posted-invoice problem. The correction is the R18 pattern (Cancel = audited reversal,
 *               then a replacement voucher), one voucher at a time.
 *   INFO        confirmed money kept unapplied while the same party has open invoices (e.g. CR-2026-000096,
 *               owner decision OD-A1) — listed, never changed.
 *
 *   node scripts/acceptance/r20/r20-repair-payment-status.mjs [--apply] [--out <file.json>]
 *        [--allocate CR-2026-000099=INV-2026-000093[:amount]]   (owner-approved INFO allocations only)
 *   (Production default as the QA admin; API / EMAIL / PASSWORD_FILE / PASSWORD_KEY for local runs.)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  SIDES,
  apiSession,
  auditPaymentStatus,
  items,
  n,
  readPassword,
} from "./payment-status-audit.lib.mjs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.BASE ?? "https://oms.haseb.org";
const API = process.env.API ?? `${BASE}/api`;
const EMAIL = process.env.EMAIL ?? "qa-admin@oms.haseb.org";
const password = readPassword(
  process.env.PASSWORD_FILE ?? "D:/Systems/OMS/tmp/.qa.env",
  process.env.PASSWORD_KEY ?? "QA_PASSWORD",
);
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex > 0 ? process.argv[outIndex + 1] : null;

const DERIVED_KINDS = new Set([
  "LIST_STATUS_DIFFERS",
  "DETAIL_STATUS_DIFFERS",
  "AGING_DIFFERS",
  "OPEN_INVOICE_MISSING",
  "OPEN_INVOICE_DIFFERS",
]);

const session = await apiSession({ api: API, email: EMAIL, password });
const before = await auditPaymentStatus(session.get);

const derived = before.findings.filter((f) => DERIVED_KINDS.has(f.kind));
const repairable = before.drafts.filter(
  (d) => d.reasons.length === 1 && d.reasons[0] === "DUPLICATE_ALLOCATION",
);
const repairableIds = new Set(repairable.map((d) => d.id));
const review = [
  ...before.findings.filter(
    (f) =>
      !DERIVED_KINDS.has(f.kind) &&
      f.status !== "DRAFT" &&
      // A functional-currency voucher (no currency) against a functional-currency invoice is the same money.
      !(f.kind === "CURRENCY_MISMATCH" && f.voucherCurrency === f.invoiceCurrency),
  ),
  ...before.drafts.filter((d) => !repairableIds.has(d.id)).map((d) => ({ kind: "DRAFT_REFUSED_AT_CONFIRM", ...d })),
];

// INFO — unapplied confirmed money while the party has open invoices (never changed here).
const info = [];
for (const s of SIDES) {
  const vouchers = [];
  for (let page = 1; ; page += 1) {
    const json = await session.get(`${s.vouchersPath}?status=CONFIRMED&page=${page}&pageSize=200`);
    const batch = items(json);
    vouchers.push(...batch);
    if (batch.length < 200) break;
  }
  const open = new Map();
  for (const partnerId of new Set(vouchers.map((v) => v.partnerId).filter(Boolean))) {
    open.set(partnerId, items(await session.get(s.openPath(partnerId))));
  }
  for (const v of vouchers.filter((x) => x.status === "CONFIRMED")) {
    const unapplied = n(
      Number(v.amount) +
        Number(v.feeAmount ?? 0) -
        (v.allocations ?? []).reduce((sum, a) => sum + Number(a.allocatedAmount), 0),
    );
    const openInvoices = open.get(v.partnerId) ?? [];
    if (unapplied > 0.005 && openInvoices.length > 0) {
      info.push({
        kind: "UNAPPLIED_WHILE_INVOICES_OPEN",
        side: s.side,
        voucher: v.transactionNumber,
        partner: v.partner?.name,
        unapplied,
        openInvoices: openInvoices.map((i) => `${i.invoiceNumber} ${n(i.remainingBalance)}`),
      });
    }
  }
}

/**
 * Owner-approved allocations of INFO money (`--allocate CR-2026-000099=INV-2026-000093[:amount]`, repeatable):
 * the posted receipt's unapplied money is applied to the named open invoice of the SAME party through the
 * Allocate business operation — no new cash / bank entry. Amount defaults to min(unapplied, invoice
 * remaining). Idempotent: a voucher that already applies money to that invoice is skipped. Never inferred —
 * only what the owner names.
 */
const allocateArgs = process.argv
  .map((arg, index) => (arg === "--allocate" ? process.argv[index + 1] : null))
  .filter(Boolean)
  .map((spec) => {
    const [voucher, rest] = spec.split("=");
    const [invoice, amount] = (rest ?? "").split(":");
    return { voucher, invoice, amount: amount ? Number(amount) : null };
  });
const plannedAllocations = [];
for (const spec of allocateArgs) {
  const side = SIDES[0]; // customer receipts → sales invoices (supplier payments: same operation on /payments)
  const voucherRow = items(
    await session.get(`${side.vouchersPath}?search=${encodeURIComponent(spec.voucher)}&pageSize=20`),
  ).find((v) => v.transactionNumber === spec.voucher);
  const invoiceRow = voucherRow
    ? items(await session.get(side.openPath(voucherRow.partnerId))).find(
        (i) => i.invoiceNumber === spec.invoice,
      )
    : null;
  const unapplied = voucherRow
    ? n(
        Number(voucherRow.amount) +
          Number(voucherRow.feeAmount ?? 0) -
          (voucherRow.allocations ?? []).reduce((sum, a) => sum + Number(a.allocatedAmount), 0),
      )
    : 0;
  const already = voucherRow?.allocations?.some((a) => a.salesInvoice?.invoiceNumber === spec.invoice);
  const amount = invoiceRow
    ? n(spec.amount ?? Math.min(unapplied, Number(invoiceRow.remainingBalance)))
    : 0;
  plannedAllocations.push({
    ...spec,
    voucherId: voucherRow?.id ?? null,
    voucherStatus: voucherRow?.status ?? "NOT_FOUND",
    invoiceOpen: !!invoiceRow,
    unapplied,
    invoiceRemaining: invoiceRow ? n(invoiceRow.remainingBalance) : null,
    amount,
    action: already
      ? "SKIP (already applied to that invoice)"
      : !voucherRow || voucherRow.status !== "CONFIRMED" || !invoiceRow || amount <= 0 || amount > unapplied + 0.005
        ? "REFUSED (not a confirmed voucher with unapplied money / not an open invoice of the same party)"
        : `ALLOCATE ${amount}`,
  });
}

const applied = [];
if (APPLY) {
  for (const plan of plannedAllocations.filter((p) => p.action.startsWith("ALLOCATE"))) {
    const side = SIDES[0];
    const invoiceId = items(await session.get(side.openPath(
      (await session.get(side.voucherPath(plan.voucherId))).partnerId,
    ))).find((i) => i.invoiceNumber === plan.invoice)?.invoiceId;
    if (!invoiceId) continue;
    await session.call("POST", `${side.voucherPath(plan.voucherId)}/allocate`, {
      invoiceId,
      allocatedAmount: plan.amount,
    });
    applied.push({ voucher: plan.voucher, operation: `Allocate ${plan.amount} → ${plan.invoice} (no new cash entry)` });
  }
  for (const draft of repairable) {
    const side = SIDES.find((s) => s.side === draft.side);
    const voucher = await session.get(side.voucherPath(draft.id));
    if (voucher.status !== "DRAFT") continue; // confirmed / deleted since the audit: nothing to merge
    const merged = new Map();
    for (const line of voucher.allocations ?? []) {
      const invoiceId = line[side.key];
      if (!invoiceId) continue;
      merged.set(invoiceId, n((merged.get(invoiceId) ?? 0) + Number(line.allocatedAmount)));
    }
    if (merged.size === (voucher.allocations ?? []).length) continue; // already one line per invoice
    const updated = await session.call("PATCH", side.voucherPath(draft.id), {
      allocations: [...merged].map(([invoiceId, allocatedAmount]) => ({ invoiceId, allocatedAmount })),
    });
    applied.push({
      voucher: voucher.transactionNumber,
      operation: "PATCH draft: one allocation line per invoice (sum kept)",
      lines: { before: voucher.allocations.length, after: updated.allocations.length },
    });
  }
}
const after = APPLY && applied.length ? await auditPaymentStatus(session.get) : null;
await session.logout();

const report = {
  api: API,
  at: new Date().toISOString(),
  mode: APPLY ? "apply" : "dry-run",
  verdict:
    derived.length + repairable.length + review.length === 0
      ? "NOTHING_TO_REPAIR — every invoice's payment status on list, detail, open invoices and aging equals its confirmed allocations; no allocation needs a correction."
      : "SEE_CLASSES",
  counts: {
    invoices: Object.fromEntries(Object.entries(before.summary).map(([k, v]) => [k, v.invoices])),
    derived: derived.length,
    repairable: repairable.length,
    review: review.length,
    info: info.length,
    plannedAllocations: plannedAllocations.length,
    applied: applied.length,
  },
  integrity: before.integrity,
  derived,
  repairable,
  review,
  info,
  plannedAllocations,
  applied,
  after: after ? { findingsByKind: after.findingsByKind, drafts: after.drafts } : null,
  invoices: before.invoices,
};
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
}
const { invoices, ...head } = report;
console.log(JSON.stringify(head, null, 2));
