# ADR-0009: Payment Verification Module — Phase 1

Date: 2026-07-29
Status: Accepted

## Context

The Payment Verification module confirms a customer's payment before a Lead becomes
`PAID` (and therefore before a Sales Order can exist). The task gave a clear workflow
diagram and field list, but left several implementation-level shapes open — recorded
here.

## Decisions

**New `PaymentSource` reference-data entity, distinct from the existing generic
`PaymentMethod`.** `PaymentMethod` (ADR-0003/0006) was created as an intentional
placeholder with zero seeded values — "no commission calculations... only prepare the
entity." The task's "PAYMENT SOURCES" section gives six concrete values (Bank
Transfer, Wallet, InstaPay, Cash Deposit, Payment Gateway, Other) that are seeded
immediately, same convention as Currencies/Countries/Shipping Methods. Using the same
entity for both would have meant either seeding `PaymentMethod` with values it was
deliberately left empty for, or conflating two different concepts. `Payment` links
only to the new `PaymentSource`; the old `PaymentMethod` is untouched and still only
used by `SalesOrder`.

**No `customerId`/`salesOrderId` fields on `Payment` at all — not even as nullable
placeholders.** The RELATIONS section marks both as "(Optional) / Future." Unlike
`Lead.productId` (a placeholder for a module that will definitely exist and needs a
concrete column shape now), a Payment is recorded and verified _before_ any Sales
Order exists in this workflow, and no Customer entity exists anywhere in the system
yet. Adding speculative columns for links that can't be exercised yet would be
inventing structure ahead of need. Only `Payment.leadId` (nullable) was implemented.

**`Notes` (Payment Information) became a proper `PaymentNote` entity, not a plain
text field.** The task lists "Notes" once under "PAYMENT INFORMATION," but separately
requires an "Add Note" business operation and a "Note Added" timeline event — both
only make sense against a collection, not a single field. Same shape as
`SalesOrderNote`/`LeadNote`: create + list only, no edit/delete.

**No separate `PaymentStatusHistory` table.** `SalesOrder`'s decision #1 (ADR-0007)
explicitly required "never update, never delete" status history as its own table;
nothing equivalent was stated for Payment here. `PaymentActivity` (general timeline,
plain string `type`) covers status changes too, same as `LeadActivity` before the
Sales Order module introduced the stricter pattern.

**`Match`/`Verify`/`Reject` each enforce a status precondition** (`PENDING` →
`MATCHED` → `{VERIFIED | REJECTED}`), unlike most business operations elsewhere in
this codebase (CRM's status-changing operations, Sales Orders' `Return Order`) which
deliberately don't validate the current status. The difference: the given `PAYMENT
STATUS` diagram is a strict, single-direction flowchart with explicit branching
(`REJECTED` only shown branching _after_ `MATCHED`), unlike Sales Orders' "returns
allowed from any shipping stage" instruction, which explicitly _overrode_ strict
sequencing. Enforcing the literal diagram here, not inventing a shortcut from
`PENDING` straight to `REJECTED` even though that's plausible in reality.

**`Verify Payment` calls `LeadsService.markPaid()` directly, as a second, separate
transaction after the payment-verification transaction commits** — not one nested
transaction spanning both modules. `LeadsModule` now exports `LeadsService`
specifically for this. If `payment.leadId` is null, the cascade is skipped entirely
(the Lead link is optional, per RELATIONS). Verified live: verifying a payment linked
to a `NEW` lead flips that lead straight to `PAID`.

**`PaymentAutoMatchingService` is a registered-but-unused stub** (`findCandidateMatches()`
resolves immediately, no logic), mirroring the exact precedent set by CRM's
`ExcelImportService`/`GoogleSheetsImportService`/`LeadDuplicateDetectionService` and
Sales Orders' none-yet-needed equivalents — "architecture must support future
automatic matching" without implementing any matching logic, per the explicit
"DO NOT IMPLEMENT: Automatic Matching."

**Reference Number and Bank Account are optional; Sender Name is required.** Not
every payment source produces a formal reference number (e.g. a cash deposit slip);
Sender Name is required because it's the primary fact Accounting matches against the
bank statement.

## Consequences

- The Payment → Lead → Sales Order chain is now fully live end-to-end: creating a
  Payment, matching it, verifying it (Lead flips to `PAID`), and creating a Sales
  Order from that Lead all work in one continuous flow, verified live including the
  automatic `paymentVerifiedById` snapshot onto the resulting order.
- `PaymentSource` and `PaymentMethod` now coexist with genuinely different roles —
  future tasks should not conflate them.
- Bank import and real automatic matching remain fully unimplemented, as required —
  `Match Payment` has no data source other than a human calling the endpoint.
