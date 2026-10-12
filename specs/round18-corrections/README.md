# Round 18 — focused corrections (owner brief 2026-10-12)

Deploy authorised for this scope once verification passes (no extra visual approval).
Streams: **A** payments (lead session, first priority) · **B** agent-owned consignment stock · **C** report cards + login.

## A. Partial payments and statements (critical)

**Reported:** invoice 200,000, only 100,000 paid, bank shows 200,000 collected.

**Reproduced on Production (read-only):** INV-2026-000091 (دار الهدى للنشر) 200,000 → receipt
CR-2026-000095 amount **200,000**, allocation **100,000**, confirmed 33 s after the invoice through the
"Receive Payment" deep link. The invoice correctly reads PARTIALLY_PAID / 100,000 outstanding; the
bank account (البنك الرئيسي) was debited 200,000 and the customer got a silent 100,000 advance.

**Root cause (entry layer, not posting/joins):** the receipt/payment editors prefill the voucher
_amount_ (money moved) with the invoice balance, and the amount stays fixed when the allocation is
lowered; confirm posts the whole amount to cash/bank and keeps the difference unallocated with no
warning. Posting, allocation sums, aging, statements and bank listing compute correctly from what
was entered. Server-side gaps found in the same audit: a draft's amount could be lowered below its
stored allocations (PATCH amount only), confirm never re-checked Σ allocations ≤ amount + fee, the
posting provider absorbed a negative remainder as FX, and the legacy bank "Confirm Match" accepted a
claim of a different amount than the bank line.

**Fix**

1. Editors (customer receipt + supplier payment, one shared hook `useVoucherAmount`): a prefilled
   amount follows the allocation lines until the user types an amount.
2. Confirm shows a warning dialog whenever part of the amount stays unapplied while the party has
   invoices: full amount posted to cash/bank, the rest an advance — "Post {amount}" or go back.
3. API: Σ allocations ≤ amount + fee enforced on update (stored lines), on confirm, and in posting
   (negative remainder refused, never FX); bank Confirm Match requires equal amounts.
4. Repair (traceable, idempotent, through business operations): cancel CR-2026-000095 (reverses its
   entry, frees the allocation) and record its replacement 100,000 allocated to INV-2026-000091,
   same date / account, referencing CR-2026-000095. CR-2026-000096 (100,000 cash, unallocated) is a
   separate voucher — reported, not changed.
5. Read-only integrity audit (`GET /accounting/integrity/vouchers`): over-allocated vouchers,
   invoices allocated above total, entry amount ≠ voucher amount, duplicate entries per voucher,
   bank rows whose matched document amount differs, mixed partial/unapplied vouchers for review.

**Acceptance (A)**

- [ ] 200,000 invoice + 100,000 receipt: invoice 200,000 / allocated 100,000 / outstanding 100,000 /
      PARTIALLY_PAID; bank debit 100,000; statement and GL reconcile.
- [ ] Same for a supplier invoice + partial supplier payment.
- [ ] Two partial receipts on one invoice; one receipt over two invoices; no double counting.
- [ ] Unallocated advance still allowed (explicit), later allocatable.
- [ ] Draft / confirmed / cancelled (reversed) and refunds: only CONFIRMED allocations count; a
      cancelled receipt reverses its entry once.
- [ ] Credit note (sales return) and refund effects, FX difference posted, date filters.
- [ ] Duplicate submit (idempotency key) and double confirm post once.
- [ ] Over-allocation refused at update, confirm and posting; bank match of a different amount refused.
- [ ] Production repaired: before/after reconciliation of INV-2026-000091, both receipts, the bank
      account balance and the partner statement.

## B. Agent-owned consignment stock (no purchase cost)

Agent ownership already exists per product (`Product.ownerAgentId`, snapshot on each movement).
Gap: a simple custody receipt (opening stock + subsequent receipts) with product, quantity,
warehouse, date, reference, notes, no cost or purchase invoice; quantities on-hand / reserved /
available / in-transit / delivered / returned per agent; movement history linked to receipts,
orders, shipments, returns; no company inventory / payable / COGS entries for the goods; excluded
from company valuation; missing-cost checks still protect company stock; ownership change refused
once movements exist (controlled conversion only).

**Acceptance (B)**

- [ ] Receive 10 agent units (no cost) → reserve 3 → dispatch → deliver → return 1: quantities and
      ownership reconcile; zero company goods-valuation / purchase / COGS lines.
- [ ] Another agent's order cannot consume that stock.
- [ ] Company-owned stock still requires cost (missing-cost guard unchanged).
- [ ] Valuation report excludes agent stock; physical quantity report shows it.

## C. Login field + report cards

- [ ] Login inputs 46 px → 44 px (−2 px; keeps a 44 px touch target), 16 px text, touch target ≥ 40 px, focus / validation /
      autofill / password toggle unchanged.
- [ ] One shared report-card recipe on agent reports, investor reports and every other summary-card
      screen (audit of consumers): glass surface, semantic tint, readable title, prominent value,
      hover lift without layout shift, equal keyboard focus, reduced motion, touch appearance.
- [ ] No data-scope change: partners / investors / agents see only their own figures.

## Release

- [ ] API + web: typecheck, lint, build, unit + integration suites on the merged tree.
- [ ] One release to Production; migrations applied; read-only live checks + the repair evidence.
