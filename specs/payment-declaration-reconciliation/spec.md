# Spec — Sales Payment Declaration + Dynamic Reconciliation

**Status: QUEUED.** This milestone activates automatically after milestone `system-audit-ui` passes its
acceptance criteria (see `specs/system-audit-ui/handoff.md`). Nothing has started yet: no plan, no
tasks and no implementation subagents. When it activates, inspect the final integrated state, then
plan → implement → review → test → deploy → verify.

Owner brief, verbatim, received 2026-09-26:

## Goal

Sales reports whether the customer paid; Finance reconciles and posts. Prepaid fulfillment becomes
ready after Sales declares payment, WITHOUT waiting for Finance reconciliation.
Use shared dynamic components/services. Preserve unrelated WIP and existing financial history.

## 1. Sales flow: declare payment, not enter a voucher

Remove manual "Add/Register Payment" from the Sales-role store-order workflow. Instead provide:

- "Has the customer paid?" Yes/No.
- Payment method when Yes.
- Optional payment reference/proof.

For a fully prepaid order, Yes automatically creates ONE unverified payment claim for the validated
order total and currency. No amount re-entry or accounting-account selection by Sales.
Validate positive prices, currency and required fields. If partial/mixed payment is supported, use an
explicit separate flow; never interpret a partial payment as full payment.
Preserve the declaration through lead → order conversion. Saving again or retrying must not duplicate
the claim.
"Customer reported paid" is NOT "Finance verified/posted." Label both clearly.

## 2. Fulfillment readiness — explicit business rule

When a valid lead becomes a confirmed prepaid order and Sales marks the customer as paid:

- SHIPPING → Ready for Shipping.
- PICKUP → eligible for preparation/pickup readiness; no shipping label.
- Do NOT wait for Finance matching/verification to permit fulfillment.
- Preserve other valid blockers, such as unavailable stock or cancelled orders.
- Never mark Shipped, Delivered or Collected automatically.

Shipping staff control shipping/delivery; authorized staff record collection. Preserve existing COD
rules. Finance discrepancies discovered later must flag the order for action, not silently rewrite
shipment history. Changes to a declaration after fulfillment or financial posting require a
permissioned, audited correction.

Acceptance: a prepaid order can proceed to shipping while its payment remains "Awaiting Finance
Reconciliation."

## 3. Payment-method configuration

Add "Requires reconciliation" to method create/edit.

- Enabled: automatically expose a statement/reconciliation workspace for that method; its claims enter
  that queue.
- Disabled: skip external-statement matching; Finance confirms/posts through the normal review flow.
- Sales declarations never create posted receipts/JEs by themselves.
- Preserve existing records when the setting changes; no silent retroactive processing.

Support Tabby, Tamara, InstaPay, Geidea and future methods without provider-specific pages or code
branches.

## 4. Actual method statements

One shared workspace per enabled payment method, supporting:

- Excel/CSV import: mapping, preview and row validation.
- Google Sheets connection and repeatable synchronization.
- Manual statement transaction entry by authorized Finance users.

Store actual provider transactions separately from Sales payment claims.
Fields: provider reference, customer name/phone, amount, currency, date/status, optional order
reference, fees and net settlement. Preserve batch/file/sheet/row provenance and audit history.
Deduplicate across imports, syncs and retries. Changed/deleted source rows become review exceptions;
never silently alter matched or posted records.

## 5. Reconciliation

Suggest eligible claims using:

1. Exact provider/payment/order reference.
2. Normalized phone.
3. Normalized customer name.

Cross-check method, amount, currency, date and provider status. Show match reasons. Name/phone alone
must not automatically confirm a payment.
Support explicit partial/multiple allocations where applicable; prevent over-allocation and ambiguous
matches.

Actions:

- Confirm Match & Post.
- Reject suggestion, leaving the underlying claim unchanged.
- Separate claim rejection/dispute action with reason.
- Audited match correction using appropriate accounting reversal rules.

Show reported, awaiting reconciliation, verified/posted and disputed states clearly; do not collapse
them into one Paid flag.

## 6. Canonical accounting and idempotency

Reuse the existing payment posting service:

- Sales declaration creates an unverified claim only.
- Statement import creates no accounting entry.
- Finance confirmation creates exactly one appropriate receipt and balanced JE.
- Already-posted payments are linked/reconciled without reposting.
- Prevent duplicates from concurrent confirmation, retries and repeated Yes/save actions.
- Preserve EGP base-currency accounting, original currency and frozen dated rates.
- Distinguish provider clearing/receivables, fees and bank settlement. A provider match does not
  itself prove bank receipt.
- Financial confirmation must not drive shipping state transitions.

Document account mappings and correction semantics in the spec. Do not invent financial policy.

## 7. Shared UX and permissions

- Sales: simple paid Yes/No declaration plus method; no voucher creation/account selection.
- Finance: statement imports/sync, matching, exceptions and posting.
- Shipping: readiness, dispatch/delivery or pickup collection; visibility of payment declaration
  versus verification.

Use shadcn/ui, Arabic/English, RTL/LTR, mobile/desktop. Include related-record previews and links:
claim → provider transaction → order → receipt → JE.
Display separate summaries by currency, import/sync results and actionable errors. Keep Google
credentials secure; request connection only if needed.

## Delivery

Create `specs/payment-declaration-reconciliation/` with spec.md, plan.md, tasks.md, verification.md and
handoff.md. Inspect existing payment records, permissions and fulfillment gates first. Define explicit
state transitions and migration compatibility. Do not reinterpret historical posted payments as new
claims. Use subagents with bounded ownership; Master integrates and reviews. Proceed autonomously
through routine tests, commits, push and deployment. Ask before destructive changes to existing
Production data.

## Mandatory browser acceptance (https://oms.haseb.org, actual QA roles)

1. Lead → prepaid order → Sales Yes + method → exactly one pending claim.
2. Shipping order becomes Ready for Shipping BEFORE Finance reconciliation; shipment is permitted
   subject to other valid blockers.
3. Pickup follows its own workflow without labels; payment never auto-marks delivery/collection.
4. Reconciliation-enabled method receives the claim; disabled method uses Finance review without
   statement matching.
5. Excel/CSV, Google Sheets sync and manual statement entry work.
6. Match → Finance confirm → receipt/JE/GL reconcile without altering fulfillment.
7. Retry/save/resync/double-click cannot duplicate claims or postings.
8. Ambiguous matches, mismatched currency/amount, disputes and correction permissions work.
9. Previously posted payments remain intact and are never posted twice.

Run relevant tests, typecheck, lint and production build; deploy and retest. Keep tagged demo data,
screenshots, logs and exact source→JE evidence. Update the Arabic role guides. Report every criterion
as Production verified / Unverified / Blocked. Verify HEAD = origin/main = Production SHA. Do not
claim completion while the Sales → fulfillment → Finance separation is incorrect.

## Inspection notes carried from system-audit-ui (not requirements)

- Commit f52828c already makes every confirmed SHIPPING store order start at `READY_FOR_SHIPPING`
  (fulfillment `READY`) regardless of payment, and PICKUP at `NOT_READY` / `AWAITING_PREPARATION`;
  the payment-driven readiness transition was removed from `store-order-payment-sync.service.ts`.
  Re-verify against section 2 on activation (TEST-01 finding, 2026-09-26).
