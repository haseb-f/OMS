# Spec 1 — Editable orders, duplicate prevention, compact order detail

Scope: `StoreOrder` (manual, imported, lead-converted and agent orders). The B2B
`SalesOrderDocument` keeps its Draft-only editing; the legacy `SalesOrder` is out of scope.

## 1A. Amend orders until delivery

### Editable window

| Order state                                                                                                  | Amendment                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| No shipment, or latest shipment `LABEL_CREATED`/`NEEDS_RESHIPMENT`/`DELIVERY_FAILED`; pickup not `COLLECTED` | Allowed (guided)                                                                                                                                |
| Latest shipment `SHIPPED` / `OUT_FOR_DELIVERY`                                                               | Commercial and customer-contact fields only; items, quantities, address and fulfillment method refused (`ORDER_IN_TRANSIT`) — use return/reship |
| `DELIVERED`, `RETURN_*`, pickup `COLLECTED`/`RETURNED`, cancelled, archived                                  | Locked (`ORDER_LOCKED_AFTER_DELIVERY`) — return / refund / adjustment workflows only                                                            |

### What can change

Customer (switch to another customer, or correct the linked customer's name/phone/email), items
(add/remove/product/quantity/agreed amount), currency, payment arrangement (Prepaid/COD), pricing
mode and agreed total (agent orders), fulfillment method, destination (country/city/address),
notes/owner (existing). Every amendment carries a **required reason**.

### Two-step guided workflow

`POST store-orders/:id/amendments/preview` → impact report (no writes).
`POST store-orders/:id/amendments` with `{ expectedVersion, reason, changes, acknowledgements[] }`.

The preview lists each impact with a code; blocking impacts explain the required prior step;
non-blocking impacts must be acknowledged (codes echoed in `acknowledgements`) before commit.

| Impact                                                   | Treatment                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Totals change                                            | Recomputed (company: line agreed amounts; agent: full re-quote through `AgentOrdersService.prepare` → new snapshot; the previous snapshot is kept in the amendment row)                                                                                                                                           |
| Pending/disputed declarations (not posted)               | Kept with original currency and amount; declared status and discrepancy re-evaluated against the new total (acknowledge)                                                                                                                                                                                          |
| Verified (posted) payments                               | Never edited. New total ≥ paid → payment status re-evaluated; new total < paid → order becomes OVERPAID and the preview points to the customer refund flow (acknowledge)                                                                                                                                          |
| Currency change with any posted payment or matched claim | **Blocked** — "Reverse or refund payment {number} ({amount} {ccy}) first"; with only pending declarations → allowed, declarations flagged for Finance review (acknowledge)                                                                                                                                        |
| Non-cancelled sales invoice exists                       | Controlled amendment: draft invoice → cancelled and regenerated after commit; posted invoice → reversed through the existing invoice cancellation/credit path (Posting Engine), then regenerated. If the existing path cannot reverse it, **blocked** with the exact next step. Never overwrite a posted document |
| Shipment `LABEL_CREATED` (label issued, not handed over) | Items/address/fulfillment changes require acknowledgement "Label {tracking} must be cancelled and reissued"; commit marks the shipment `NEEDS_RESHIPMENT`-style flag `labelReissueRequired` + activity; Shipping sees it on the shipment panel                                                                    |
| Shipment in transit                                      | See window table (no silent change to shipped contents or carrier instructions)                                                                                                                                                                                                                                   |
| Agent order, commission not yet earned                   | Re-quoted, commission snapshot replaced (old kept in amendment row)                                                                                                                                                                                                                                               |
| Agent order, commission earned / agent stock issued      | Blocked — use the agent return / adjustment workflow                                                                                                                                                                                                                                                              |
| Agent shipping pricing (Spec 2)                          | Destination / payment type change re-resolves tariff (or back to `PENDING_METHOD`)                                                                                                                                                                                                                                |
| Stock                                                    | Store orders do not reserve stock (verified); agent stock is issued only at dispatch, which the window already excludes — so no stock movement is edited                                                                                                                                                          |

### Permissions and concurrency

- Internal: new permission `store-orders.amend` (granted where `store-orders.edit` is granted by the
  migration). Customer identity edits also require `partners.edit` (existing).
- Agent users: `agent.orders.edit` (new; Admin: all agent orders; Sales: own orders), portal route
  `POST agent-portal/orders/:id/amendments[/preview]`. Agents cannot amend when a posted payment,
  invoice or earned commission exists (those are internal financial records), cannot touch another
  agent's data (404), and never see internal costs.
- `StoreOrder.version Int @default(0)`; every amendment and every existing mutating order path that
  changes commercial data increments it; stale `expectedVersion` → 409 `ORDER_VERSION_CONFLICT`
  ("This order was changed by {user} at {time}. Reload to see the latest version.").
- All writes in one transaction under `lockStoreOrderRow`.

### Audit

New append-only `StoreOrderAmendment`: orderId, version (after), reason, actorId, createdAt,
`changes` (field → {old,new}, line diffs), `impacts` (codes + acknowledgements), `previousSnapshot`
(agent terms / pricing). Plus one `StoreOrderActivity` `ORDER_AMENDED` row summarizing it. Shown in the
detail page history section.

## 1B. Duplicate warning on order creation

Applies to: manual create dialog, lead conversion, agent order form (portal + internal).

`POST store-orders/duplicate-check` `{ phone, name, countryId?, agentId? }` →

- **Phone match** (normalized E.164 via `PhoneNumberService`, independent of creating employee):
  `{ kind: 'PHONE', customer: {id, name, phoneMasked}, orders: [accessible orders, active/unfulfilled
first: number, date, status, total] }`.
- **Name-only match** (case/whitespace-insensitive, Arabic-normalized: alef/ya/ta-marbuta
  variants): `{ kind: 'NAME', candidates: [...] }` — soft warning.
- **Cross-scope match** (record outside the caller's scope — another agent's, or a company customer
  seen from an agent user): `{ kind: 'PHONE', crossScope: true }` only — no name, id or orders.

Create endpoints accept `duplicateResolution`:
`{ decision: 'USE_EXISTING_CUSTOMER' | 'INTENTIONAL_NEW_ORDER' | 'DIFFERENT_CUSTOMER', customerId? }`.
The server re-runs the check; a phone match without a resolution → 409
`DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` (with the same scoped payload). Phone match always reuses the
existing customer identity (no duplicate Partner). Name-only: `USE_EXISTING_CUSTOMER` links it;
`DIFFERENT_CUSTOMER` creates a new one; **never auto-merged on name alone**. Cross-scope: the order is
created in the caller's scope and flagged `duplicateReviewStatus = PENDING` for an authorized
internal reviewer (`store-orders.duplicate_review`), who sees both sides and resolves
(`CONFIRMED_DISTINCT` / `CONFIRMED_DUPLICATE` → cancel via normal flow). Intentional repeat purchases
(`INTENTIONAL_NEW_ORDER`) are recorded on the order activity and not flagged.

UI: an inline warning panel under the phone field (debounced) with the existing orders listed and
three actions — **Open existing order**, **New order for this customer**, **Edit details**. Submit is
disabled until a choice is made. Name-only shows a softer panel with **Same customer** / **Different
customer**.

### Idempotent submission

`StoreOrder.creationIdempotencyKey String? @unique`. The create dialog, lead conversion and agent
form generate one key per form instance (regenerated only after success). A retry with the same key
returns the already-created order (200, `idempotentReplay: true`); the agent path's existing
activity-row key stays valid and is also written to the column.

## 1C. Compact order detail

Header: order number, customer, date, and **two distinct status badges** — Payment (declared /
confirmed / settled per Spec 3 vocabulary) and Fulfillment. One **next action** button computed from
state (e.g. Declare payment → Awaiting Finance review (no action) → Assign shipping → Mark handed over;
Resolve duplicate review; Confirm customer total), plus Amend and a compact overflow (print slip,
invoice, archive).

Body: one compact card with customer (name, phone, destination), items table, and totals
(merchandise, discount, shipping with pricing state, payable, paid, outstanding). Collapsed by
default (progressive disclosure, remembered per user): Payments & financial history, Shipment
history, Amendments & activity, Technical details (ids, source, snapshots). Profitability stays an
internal-only tab. Agent order detail (portal) follows the same layout with agent-safe data.

## Acceptance

1. Amend unpaid order (items/qty/price/currency) → totals recomputed, amendment audited, version +1.
2. Declared-paid order: amend amount → declaration kept, discrepancy re-evaluated; currency change
   flags declaration for review.
3. Financially posted undelivered order: amount down → OVERPAID + refund pointer, posted payment
   unchanged; currency change blocked with the exact prior step.
4. Delivered / collected → amendment refused; in-transit → items/address refused, price allowed.
5. Concurrent amendments: second commit with stale version → 409.
6. Label issued → acknowledgement required, shipment flagged for reissue.
7. Agent order amend re-quotes pricing and commission; earned → blocked; agent cannot amend another
   agent's order (404) or a posted-payment order.
8. Duplicate phone (different employee created the first order) → warning with orders; submit
   without resolution → 409; intentional new order reuses the customer. Name-only → soft; no merge.
   Agent sees no other agent's data; cross-scope → review flag.
9. Double click / retry with the same key → one order.
