# Owner decisions — 2026-10-01

Supersedes the matching parts of `spec-1-orders.md` §1B and `spec-2-agent-pricing.md` (D-R5-1).

## O1. D-R5-1 — shipping difference: the company bears the shortfall and keeps the excess

Customer shipping collected (C) ≠ contractual agent shipping fee (F) is **allowed** (no longer
refused). The agent's economics are always as if C = F:

- At earning: one `CUSTOMER_SHIPPING_RETAINED` = C (the customer shipping belongs to the company),
  basis `{ agentShippingCharge: F, appliedToAgentShippingCharge: min(C, F), difference: C − F,
differenceBorneBy: 'COMPANY' }`. No extra agent debit for a shortfall, no agent credit for an
  excess.
- Examples (sales 1,000, commission 35%): F 100 / C 80 → agent entitlement 650 (company bears 20);
  F 100 / C 120 → 650 (company keeps 20); F = C = 100 → 650 (unchanged).
- Internal economics show F, C, the difference (company), the carrier cost and the margin; the agent
  sees F and C only.
- The rule is the platform policy (not per agreement); it is recorded on every affected ledger basis.

## O2. Default phone country: Saudi Arabia

Phone inputs default to SA (+966) unless the user picks another country; the last-used country no
longer overrides the default for a new entry, and the browser region is not used.

## O3. One phone number = one customer

A customer may have many orders, all on the **same customer record**. The same phone number must
never be stored on two customer records.

- Uniqueness is on the normalized E.164 number across a customer's phone and mobile, enforced by a
  dedicated unique key table (race-safe), on every write path: manual order, lead conversion, agent
  orders (portal + internal) and agent lead conversion, imports / Google Sheets sync, customer
  create/edit, order amendment customer correction.
- A phone match always attaches the order to the existing customer — including across scopes
  (company ↔ agent, agent ↔ agent). This replaces the earlier "new customer + review flag" for
  cross-scope matches. Agent isolation stays at the order level: an agent still sees only its own
  orders and the customer details it entered (order snapshot), never the master record's other data
  or other scopes' orders; a cross-scope match is still flagged for internal duplicate review and
  returns only `{ crossScope: true }` to the agent.
- Editing a customer's phone to a number held by another customer is refused with the existing
  customer named (internal) or a neutral message (agent).
- Leads may still repeat (a lead is not a customer).
- Existing duplicates (records created before this rule): never merged automatically. The backfill
  keeps the key on the oldest record; the others are listed for review (internal report) so Finance /
  Sales can merge deliberately.
