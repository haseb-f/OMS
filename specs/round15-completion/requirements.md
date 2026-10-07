# R15 — requirement checklist (owner brief 2026-10-07)

Every requirement of the brief is one row. Status values: `open` → `built` (code merged on `integration/r15`) →
`verified` (proved by a test / journey / browser check that was **run by the lead on the integrated tree**, evidence
named) → `released` (proved again on Production). An agent's report or a green deploy never moves a row.

## 1. Agent overview and unified order entry

| Id   | Acceptance criterion                                                                                                                                                                                                                 | Status | Evidence |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- |
| 1.1  | Agent overview (company admin view of an agent, agent-admin portal overview, agent-employee overview) uses the shared reporting-card components (InsightCard / InsightGroup / SummaryCard on InsightSurface) — no page-specific card | open   |          |
| 1.2  | Cards: semantic tone colours, soft glass surfaces, readable figures/labels, visible hover + keyboard focus on interactive tiles, RTL ar + LTR en, mobile                                                                             | open   |          |
| 1.3  | Company admin sees only agents allowed by their permissions                                                                                                                                                                          | open   |          |
| 1.4  | Agent admin sees only their own agent's authorized figures                                                                                                                                                                           | open   |          |
| 1.5  | Agent employee sees only their own permitted activity (server-scoped)                                                                                                                                                                | open   |          |
| 1.6  | No company cost / carrier cost / margin field reaches an agent user (API response audit)                                                                                                                                             | open   |          |
| 1.7  | Agent + agent-employee order entry uses the same shared compact sequential form as company sales (one component, no divergent copy)                                                                                                  | open   |          |
| 1.8  | Agent rules preserved: product availability/ownership, employee/agent assignment, agreed pricing + shipping, payment declaration, field visibility/permissions                                                                       | open   |          |
| 1.9  | Same customer matching, phone handling, required-field indicators, validation and mobile behaviour in both experiences                                                                                                               | open   |          |
| 1.10 | Journey: a company salesperson and an agent salesperson each complete an order using only their authorized products/actions                                                                                                          | open   |          |

## 2. Permission-controlled Excel and Google Sheets imports

| Id   | Acceptance criterion                                                                                                                          | Status | Evidence |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 2.1  | Distinct permissions for lead import and order import, for company users and agent users; no admin role needed when the permission is held    | open   |          |
| 2.2  | Excel import of leads and store orders                                                                                                        | open   |          |
| 2.3  | Google Sheets import through an authorized connection — private sheets, never requires public sharing                                         | open   |          |
| 2.4  | Template / column-mapping step                                                                                                                | open   |          |
| 2.5  | Preview + validation before confirmation; row-level errors with actionable explanations                                                       | open   |          |
| 2.6  | Summary of successful / rejected / skipped rows                                                                                               | open   |          |
| 2.7  | Safe retry: re-importing the same rows never recreates orders                                                                                 | open   |          |
| 2.8  | Same business rules as manual entry: phone normalisation, customer reuse, repeated-lead policy, product/pricing/stock/ownership/payment rules | open   |          |
| 2.9  | Intentional repeat-customer order distinguished from an accidental duplicate import                                                           | open   |          |
| 2.10 | An imported payment label never posts a collection (at most a declaration)                                                                    | open   |          |
| 2.11 | Records default to the importing user and their company/agent scope; assigning to others needs an explicit permission                         | open   |          |
| 2.12 | Server-enforced: columns cannot override agent identity, owner, restricted shipping fields or financial permissions                           | open   |          |
| 2.13 | Continuous Google Sheets sync distinguished from one-time import; no duplicate ingestion between the two paths                                | open   |          |

## 3. Agent shipping agreements

| Id   | Acceptance criterion                                                                                                                                  | Status | Evidence |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 3.1  | Written explanation of how an agent shipping agreement is created, activated and applied today (verified against UI + backend)                        | open   |          |
| 3.2  | Simple setup under the agent's settings: agent, currency, shipping/payment-service combination, agreed charge, effective dates, draft/active/inactive | open   |          |
| 3.3  | Supports prepaid carrier, carrier COD and internal courier COD charges                                                                                | open   |          |
| 3.4  | Customer shipping amount, agent tariff, company carrier cost and company margin stay distinct; no double deduction                                    | open   |          |
| 3.5  | Customer shipping collections belong to the company and are accounted consistently with the agent tariff                                              | open   |          |
| 3.6  | Only the internal shipping employee selects the actual service; agent users gain no carrier-assignment right                                          | open   |          |
| 3.7  | Activation validated; no ambiguous overlapping active tariffs                                                                                         | open   |          |
| 3.8  | Applicable agreement snapshotted when the charge becomes binding; later changes never reprice history                                                 | open   |          |
| 3.9  | Missing agreement → actionable message, never a silent zero                                                                                           | open   |          |
| 3.10 | Carrier cost and margin hidden from agent users                                                                                                       | open   |          |
| 3.11 | Worked example: an order receives the correct tariff and it appears in the agent statement                                                            | open   |          |

## 4. Company partners: navigation, accounts, portal

| Id   | Acceptance criterion                                                                                                                                    | Status | Evidence |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 4.1  | «الشركاء» is its own top-level sidebar section                                                                                                          | open   |          |
| 4.2  | Matching Home module tile with an icon for authorized users                                                                                             | open   |          |
| 4.3  | Builds on the R14 partner module (no duplicate module)                                                                                                  | open   |          |
| 4.4  | Authorized workflow to create or link the partner's own user account after the agreement is configured                                                  | open   |          |
| 4.5  | Partner setup shows start, end/duration, profit share % and basis, closing frequency, agreement status, linked user account                             | open   |          |
| 4.6  | A partner user sees only their own statement and summaries (server-enforced)                                                                            | open   |          |
| 4.7  | Expiry defined: after the end date historical statements stay accessible, rights and transactions are never erased                                      | open   |          |
| 4.8  | Statement per closing period: period + closing status, agreement + %, calculated entitlement, approved due, paid, remaining, payment/adjustment history | open   |          |
| 4.9  | Provisional live estimate clearly distinguished from approved closed-period entitlement                                                                 | open   |          |
| 4.10 | Polished reporting cards with hover/focus, concise labels, full mobile support                                                                          | open   |          |
| 4.11 | No unrelated partners, customer-level records or company financials beyond the partner's scope                                                          | open   |          |
| 4.12 | Journey: a partner logs in and sees only their own period statements                                                                                    | open   |          |

## 5. Store orders: reservation, dispatch, delivery, collection, returns

| Id   | Acceptance criterion                                                                                                                                      | Status | Evidence |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 5.1  | Payment status never controls reservation, dispatch, delivery or return                                                                                   | open   |          |
| 5.2  | Reservation when a stock-requiring order is created (manual, lead conversion, import, agent) regardless of prepaid/COD                                    | open   |          |
| 5.3  | Available-to-sell drops immediately; the reservation is visible as allocated to the order; the same quantity cannot be allocated twice                    | open   |          |
| 5.4  | Reservation is not a sale/expense; owned stock unchanged by reservation; physical / reserved / available / in-transit distinguished; no double count      | open   |          |
| 5.5  | Insufficient-stock behaviour defined explicitly; never silently oversold                                                                                  | open   |          |
| 5.6  | Dispatch: removed from warehouse, transferred to an in-transit location, order/shipment link + valuation kept, visible immediately                        | open   |          |
| 5.7  | Dispatch never creates a collection entry                                                                                                                 | open   |          |
| 5.8  | Delivery: transit → customer, COGS per the documented policy, no double deduction; estimated operational cost vs posted cost distinguished                | open   |          |
| 5.9  | Company goods, agent-owned goods (no company inventory/COGS), kits/assembled, services/non-stock, partial shipments/deliveries handled                    | open   |          |
| 5.10 | Collection only after confirmed online/prepaid payment or confirmed COD collection; declaration ≠ verified collection                                     | open   |          |
| 5.11 | Carrier-collected money distinguished from bank/cash settlement; cash never recognised twice; delivery-before-settlement and prepaid-before-delivery work | open   |          |
| 5.12 | Return allowed for prepaid orders; linked from the order/invoice; full or partial; quantities + reason                                                    | open   |          |
| 5.13 | Physical receipt + inspection restores stock (saleable → stock, damaged → damaged location) only at receipt, not at request                               | open   |          |
| 5.14 | Credit note / reversal; refund or customer credit only where money was collected; pending/manual refund shown honestly; refund ≠ credit note              | open   |          |
| 5.15 | Erroneous payment reversed through the audited process, never deleted; returned agent goods keep their ownership                                          | open   |          |
| 5.16 | Order exposes linked reservations, movements, shipments, invoice/credit notes, cost entries, collections, refunds                                         | open   |          |
| 5.17 | Idempotency + concurrency across manual actions, imports, integrations, callbacks; cancellation releases reservations; retries never duplicate            | open   |          |

## 6. Sales-report visibility

| Id  | Acceptance criterion                                                                                                           | Status | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------ | -------- |
| 6.1 | Company and agent sales employees see only their own reports/metrics and their own rank (no other employees' detailed results) | open   |          |
| 6.2 | Company managers see authorized company-wide reports                                                                           | open   |          |
| 6.3 | Agent managers see only their agent's team                                                                                     | open   |          |
| 6.4 | Applied consistently to overview cards, reports, charts, ranking, drill-downs, exports and API responses (server-side)         | open   |          |
| 6.5 | Permission inheritance + existing grants audited; broad permissions do not restore full reporting access                       | open   |          |

## 7. Development data and migrations

| Id  | Acceptance criterion                                                                                                  | Status | Evidence |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 7.1 | Any reset is the smallest necessary, recorded (what / why), keeps configuration + logins, touches no unrelated module | open   |          |
| 7.2 | No local test-payment deletion presented as an external refund                                                        | open   |          |
| 7.3 | Migrations apply on a clean install and on the deployed schema                                                        | open   |          |

## 8. Verification and deployment

| Id  | Acceptance journey / gate                                                                     | Status | Evidence |
| --- | --------------------------------------------------------------------------------------------- | ------ | -------- |
| J1  | Company and agent overviews show the approved cards with correctly scoped data                | open   |          |
| J2  | Authorized company and agent sales users import leads and orders from Excel and Google Sheets | open   |          |
| J3  | Unauthorized users cannot import or manipulate ownership through imported columns             | open   |          |
| J4  | Agent order entry matches the approved company experience                                     | open   |          |
| J5  | An agent agreement is created, activated and correctly applied                                | open   |          |
| J6  | A partner logs in and sees only their own period statements                                   | open   |          |
| J7  | Creation reserves stock; dispatch moves it to transit; delivery completes stock/cost effects  | open   |          |
| J8  | Prepaid and COD orders follow independent collection timing                                   | open   |          |
| J9  | A prepaid order is returned, received, credited and refunded without duplicate effects        | open   |          |
| J10 | Concurrent requests and repeated callbacks do not duplicate transactions                      | open   |          |
| J11 | Sales users see only their reports and own rank; managers see the broader scope               | open   |          |
| J12 | Arabic/English and desktop/mobile flows work end to end                                       | open   |          |
| G1  | Independent accounting review + independent permission review                                 | open   |          |
| G2  | Final integrated tree: api tsc/build/lint/jest (+serial), web tsc/lint/vitest/build           | open   |          |
| G3  | One combined deployment; deployed frontend/API version + migrations confirmed                 | open   |          |
| G4  | Live journeys verified in the browser with the relevant roles on Production                   | open   |          |
| G5  | Arabic handoff + Arabic user guide updated to the released behaviour                          | open   |          |
