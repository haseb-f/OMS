# Spec 3 — Payment review and reconciliation UX

Presentation and workflow clarity only. Posting rules, permissions, currency validation, duplicate
prevention, partial-payment rules, reconciliation evidence, posted-record immutability, controlled
reversal and provider clearing vs bank receipt are **unchanged** (see
`payment-declaration-reconciliation/spec.md`). Added server work is limited to bulk endpoints that
call the existing single-record services.

## 3A. One vocabulary, one progression

Single source `apps/web/src/config/payments/payment-vocabulary.ts` (labels AR/EN + tone + stage)
used by Payment Review, the reconciliation workspace, order detail, agent portal and badges.

| Stage | Name (EN / AR)                                                  | Meaning                                                             | Record state                    |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| 1     | Declared · awaiting review / مُبلغ عنه · بانتظار المراجعة       | Sales/agent reported a customer payment; nothing verified           | `Payment.PENDING`               |
| 2     | Statement line / حركة كشف                                       | Imported provider/bank transaction                                  | `PaymentStatementLine`          |
| 3     | Matched · not posted / مطابق · غير مُرحّل                       | Statement amount allocated to the declaration, not yet fully posted | `Payment.MATCHED`, line MATCHED |
| 4     | Confirmed & posted / مؤكد ومُرحّل                               | Finance posted the customer receipt (clearing/cash)                 | `Payment.VERIFIED`              |
| 5     | Settled to bank / مُسوّى للبنك                                  | Provider paid the cleared funds to the bank                         | `settlementStatus = SETTLED`    |
| —     | Disputed / متنازع عليه · Rejected / مرفوض · Exception / استثناء | Off-path states                                                     |                                 |

"Confirmed", "Matched" and "Settled" are never used interchangeably; tones are identical everywhere
(declared = warning, matched = info, confirmed = success, settled = success with bank icon,
awaiting settlement = info, partially settled = warning, disputed/exception = destructive, rejected
= neutral).

**Payment Review becomes the Finance "Payments" workbench** (`/finance/payment-review`, same nav
entry, label "Payments review" / "مراجعة المدفوعات"): a stage strip at the top with count and
outstanding amount per currency for each stage — Declarations awaiting review · Unmatched statement
lines · Exceptions · Awaiting confirmation (matched, not posted) · Awaiting settlement — each chip
filters the list or opens the method workspace tab. Each chip carries a one-line description of what
it does and what remains.

## 3B. Match panel (side sheet)

A shared `PaymentMatchPanel` (`ui/sheet`, end side, full-screen on phones) opened from Payment
Review rows, the Matching tab and order detail:

- Left: the declaration — order number (link), customer, declared amount + currency, declared date,
  method, reference, evidence attachments.
- Right: the statement transaction (or ranked suggestions) — amount + currency, transaction date,
  reference, payer phone/name, import source.
- Evidence row: matched signals (reference / order / phone / name / amount / date / currency) and a
  discrepancy line (amount difference, currency mismatch, date gap) in destructive/warning tone.
- Footer actions with the exact effect sentence ("Posts customer receipt for SAR 450.00 to clearing
  account 1130 for order SO-…").
- Technical metadata (row hash, dedupe key, raw row, import id) in a collapsed section.

## 3C. Semantic compact actions

Shared `PaymentActionButton` presets over `EnterpriseButton` (`size="sm"`, icon + text):

| Intent             | Variant / tone                  | Label                                           |
| ------------------ | ------------------------------- | ----------------------------------------------- |
| Confirm & post     | `success`                       | Confirm & post · تأكيد وترحيل                   |
| Match / review     | `default` (primary accent)      | Match… · مطابقة… / Review · مراجعة              |
| Reject declaration | `destructive` soft, reason      | Reject declaration · رفض الإبلاغ                |
| Unmatch            | `outline`                       | Unmatch · إلغاء المطابقة (only when not posted) |
| Reverse posting    | `outline` + destructive confirm | Reverse posting · عكس الترحيل (names the JE)    |
| Refund customer    | separate flow link              | Refund customer · استرداد للعميل                |

Every commit shows payment number, amount + currency, order and the accounting effect before
confirmation. Invalid actions stay visible but disabled with a tooltip reason (e.g. "Settled —
reverse the settlement first", "Currency differs from the order").

Bulk (Payment Review list): Confirm & post (non-reconciled methods only), Reject declarations (one
shared reason), Accept strong suggestions (Matching tab). New endpoints
`POST payments/bulk/confirm`, `POST payments/bulk/reject`,
`POST payment-reconciliation/methods/:methodId/matches/bulk-accept` — each re-validates every item
under the existing service/transaction, de-duplicates ids, and returns
`{ succeeded: [...], failed: [{ id, code, message }] }`; UI shows eligible count before commit and a
per-item failure list after.

## 3D. Integrity (regression)

Existing integration suites must pass unchanged; bulk endpoints add tests for partial failure,
permission denial, duplicate ids, settled/posted refusal and currency mismatch.

## Acceptance

Journey: declaration (order) → statement import → match in panel → confirm & post → settle to bank,
with labels consistent on order detail, review, workspace and agent portal; reject vs refund and
unmatch vs reverse clearly distinct; bulk confirm with one ineligible item reports it individually.
