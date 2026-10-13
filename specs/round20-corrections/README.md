# Round 20 — three corrections (owner brief 2026-10-13)

Streams in worktrees, integrated on `feat/r20`; local preview + evidence → owner approval → `main`
(Production) → live verification (agreed process).

## A. Lead "لم يُفتح" (unopened) indicator — `feat/r20-lead-opened`

Found: `LeadsService.firstOpen` sets `Lead.firstOpenedAt` only when the lead is NEW **and** the
NEW → IN_PROGRESS workflow transition succeeds; any other case (lead not NEW, transition refused,
reassigned lead) never records the open, so the indicator stays. The open also changes the business
status, which the owner now forbids.

Target: a server-side open event per assignee (who, when, first + last open), recorded only by the
assigned employee opening the real detail screen; lists, prefetch, managers and admins never record it;
the badge disappears in employee, manager and admin views (table + grid) after the assignee's open;
opening never changes the business status; repeat opens idempotent with an audit timestamp;
reassignment keeps history and the new assignee starts unopened; company / agent scope enforced; list
caches invalidated.

- [ ] Assignee opens an unread lead → badge gone for employee, manager, admin (table + grid); status unchanged.
- [ ] Manager / admin opening alone → still unopened for the employee.
- [ ] Reassign → new assignee unopened, previous open history kept.
- [ ] Repeat open safe; list / prefetch never marks; agent / company boundaries.

## B. Employee performance — one card per employee, five period boxes — `feat/r20-employee-periods`

Each employee: one outer card (clear identity) with five boxes — Today, Yesterday, Last 7 days,
This month, Last month — each with qualifying order count and sales value per currency. Established
sales definitions + Cairo reporting day; period boundaries stated explicitly (incl. whether "last 7 days"
includes today — keep the Live report's definition); cancelled / returns / refunds treated as the Live
report does. Five coordinated period colours = the R19 C2 period identities (teal, sky, blue, violet,
orchid). Responsive (no five-in-a-row on phones), no truncation / overflow, hover / focus, reduced
motion, touch. Scope: employee = own card (+ permitted rank), manager = authorised scope, agent manager
= own agent's employees only; no other employee's data in API or exports. One aggregated, scoped,
paginated query — never a request per employee per period; currencies never summed.

- [ ] Five boxes with correct totals per employee (matches Live report per employee and period).
- [ ] Role isolation (employee / manager / admin / agent manager / other agent) in API and export.
- [ ] ar / en, desktop / mobile, light / dark, hover / focus / reduced motion.

## C. Invoice payment status + receipt allocation — `feat/r20-payment-status`

Invoice status = confirmed, non-reversed allocations vs total (200,000 / 100,000 → مدفوعة جزئيًا).
Audit invoice → receipt → allocation → JE → statement → bank / cash → status on every screen (invoice
list / grid / detail / print / export, customer profile, statements, aging, open-invoices) and the
supplier path. Receipt entry: customer's eligible open invoices with totals, previous payments,
remaining, new allocation; multi-invoice; preselect from invoice; no invoice = explicit unapplied
advance; no cross-customer / company, no over-allocation; currency policy; allocating a posted
receipt never creates a second cash entry; retries / concurrency safe; statuses follow reversal /
cancellation / reallocation / refund. Identify wrong statuses / allocations on Production (read-only)
and repair verified issues idempotently through business operations.

- [ ] Unpaid / partial / paid; multiple receipts on one invoice; one receipt over several invoices.
- [ ] Unapplied receipt; reversal; duplicate submit; supplier side.
- [ ] Every invoice screen + export shows the same status as the engine.
