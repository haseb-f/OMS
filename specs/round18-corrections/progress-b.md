# R18 stream B — agent-owned consignment stock (no purchase cost)

Branch `feat/r18-agent-stock` (worktree `.claude/worktrees/agent-a2ee4e50e7b93fe86`), local only — not pushed,
not merged. Spec: `specs/round18-corrections/README.md` §B.

## What existed (verified in code) vs what was added

| Area                  | Before R18                                                                                                                                                                                                                                                                                                                                               | R18 B                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership             | `Product.ownerAgentId` (one owner per SKU); `InventoryMovement.ownerAgentId` snapshot stamped by `createMovement`; owner lock `PRODUCT_OWNER_LOCKED` (409) once any movement / order / document / recipe line exists                                                                                                                                     | unchanged; covered by the new integration spec                                                                                                                                                                                                                                                                                                                                                            |
| Receiving agent goods | Agent tab "Receive stock" = generic `POST /inventory/adjustment` (+). Posting provider skipped GL for agent movements, but: no document, no number, no date / reference, no opening vs receipt; `POST /inventory/opening-balance` accepted a `unitCost` on an agent product and wrote it as the product's company cost (`ProductCostService.recordCost`) | **Agent stock receipt** document (`AgentStockReceipt` + lines, number `ASR-YYYY-NNNNN`), kind OPENING (movement `OPENING_BALANCE`) or RECEIPT (new movement type `CONSIGNMENT_RECEIPT`); quantities only. Generic opening balance now refuses a cost on agent goods (`AGENT_STOCK_NOT_VALUED`, 422)                                                                                                       |
| Quantities            | `getAgentStock`: on-hand / reserved / available / shipped / returned                                                                                                                                                                                                                                                                                     | + `inTransit` (on-hand in the TRANSIT warehouse); `shipped` renamed `delivered` (Σ SALES_DELIVERY — agent goods leave stock at delivery out of transit)                                                                                                                                                                                                                                                   |
| History               | none per agent                                                                                                                                                                                                                                                                                                                                           | `GET /agents/:id/stock-movements` (internal, `agents.view`) and `GET /agent-portal/stock/movements` (portal, `agent.stock.view`, own agent only): every movement whose owner snapshot is the agent, with a derived event (OPENING, RECEIPT, RESERVED, RELEASED, DISPATCHED, BACK_FROM_TRANSIT, DELIVERED, RETURNED, ADJUSTED, WRITTEN_OFF, TRANSFERRED) and its document (receipt / order / agent return) |
| Cross-owner           | order entry: `MIXED_OWNER_ORDER` / `PRODUCT_NOT_AVAILABLE`; company documents `AGENT_PRODUCT_IN_COMPANY_DOCUMENT`                                                                                                                                                                                                                                        | + defence in depth in the reservation writer: a company order never reserves agent goods, an agent order never reserves another agent's goods (line stays SHORT)                                                                                                                                                                                                                                          |
| Valuation / GL        | company valuation (`getCompanyStockValue`, stock-card `stockValue`, integrity I6/I7) already excludes agent stock; agent orders issue no company invoice / COGS; adjustment provider skips agent movements                                                                                                                                               | unchanged — receipts never call the Posting Engine and carry no cost                                                                                                                                                                                                                                                                                                                                      |

## Rules (implemented)

- A receipt line posts exactly one append-only movement through `InventoryService.postAgentStockReceiptLine`
  (Inventory Engine is the only writer; product rows locked `FOR UPDATE` in sorted order; idempotency key
  `AGENT_STOCK_RECEIPT:<receipt>:<product>:<type>`; `referenceType = AGENT_STOCK_RECEIPT`). No unit cost, no
  product-cost record, no posting.
- Refused: product not owned by the receipt's agent (`AGENT_STOCK_OWNER_MISMATCH` — company goods go through
  purchasing / valued opening stock, so the company missing-cost guards stay theirs), inactive / untracked product
  (`AGENT_STOCK_PRODUCT_NOT_STOCKABLE`), warehouse that cannot receive (system-warehouse policy), OPENING for a
  product that already has stock movements (`AGENT_STOCK_OPENING_EXISTS`, 409), future date
  (`AGENT_STOCK_DATE_IN_FUTURE`), repeated product (`AGENT_STOCK_LINE_REPEATED`), inactive agent.
- Idempotent per client key (replay returns the same receipt, `replayed: true`; a concurrent duplicate resolves to
  the winner). Receipts are append-only; a correction is an inventory adjustment (agent goods: no GL).
- Permissions: list `agents.view`; record `inventory.movements.create`; kind OPENING additionally
  `inventory.opening-stock.create`. Agents see only their own history (portal, read-only).
- Ownership: changing `Product.ownerAgentId` after any movement stays refused (`PRODUCT_OWNER_LOCKED`, 409). No
  automatic conversion was built (see open decision OD-B1).

## UI

- **Receipt screen: `/agents/stock-receipts`** (nav: Agents → Agent stock receipts; Home destination
  `agents-stock-receipts` en + ar). List across agents (agent filter, search by number / agent reference,
  export, print) + "Receive agent stock" dialog (agent, type, warehouse, date default today, agent reference,
  notes, product / quantity lines — no cost field). `?receipt=<id>` opens one receipt (movement links).
- Agent page → Products & stock tab: stock table now with In transit / Delivered, the same receipt dialog (agent
  fixed), the agent's receipts and the movement history.
- Agent portal `/agent/stock`: In transit / Delivered columns + read-only movement history (orders link to the
  portal order page).
- Inventory movements: new type label "Agent Stock Receipt" / «استلام مخزون وكيل», filter option, link to the receipt.

## Migration

`apps/api/prisma/migrations/20261012100100_r18_agent_stock_receipts` — additive, idempotent (guarded DDL):
`InventoryMovementType` + `CONSIGNMENT_RECEIPT`, enum `AgentStockReceiptKind`, tables `agent_stock_receipts` /
`agent_stock_receipt_lines` (FKs, unique receipt number / idempotency key / movement id), number series
`AGENT_STOCK_RECEIPT` (ASR). Applied on local `oms_r18_b` and re-run by hand (no-op). Reverse steps in the header.

## Test evidence (local `oms_r18_b`)

- New `agents/stock/agent-stock.integration.serial.spec.ts` — 3/3 pass:
  receipt OPENING 6 + RECEIPT 4 = **10 agent units, no cost** (movement `unitCost` null, `currentCost` null, no
  cost-history row; replay → same receipt; second OPENING → `AGENT_STOCK_OPENING_EXISTS`) → agent B quote with
  agent A's product → `MIXED_OWNER_ORDER`; agent B order crafted with A's product stays **SHORT, reserved 0** →
  agent A order **reserves 3** (on-hand 10 / reserved 3 / available 7) → dispatch (in transit 3, available 7) →
  delivery (on-hand 7, delivered 3, 0 invoices) → return 1 → final **on-hand 8 / reserved 0 / available 8 /
  in transit 0 / delivered 3 / returned 1**; every movement owner = agent A; **journal entry count unchanged,
  0 lines on the category inventory / COGS accounts, company valuation 0 items**; history shows OPENING, RECEIPT,
  RESERVED, RELEASED, DISPATCHED, DELIVERED, RETURNED with receipt / order / return numbers; agent B history 0;
  owner change → `PRODUCT_OWNER_LOCKED` (to agent B and to company). Refusals: other agent / company product
  `AGENT_STOCK_OWNER_MISMATCH`, future date, repeated line, generic opening balance with cost on agent goods
  `AGENT_STOCK_NOT_VALUED`, nothing left behind. Company stock: valuation keeps the valued product only (40.00),
  stock card of the agent product `stockValue` null, warehouse balances show both owners, **uncosted company
  goods still fail recognition at delivery with `MISSING_COST`** and no invoice.
- Mutation check: removing the new reservation owner filter makes the cross-agent order RESERVED (spec fails) —
  the guard is load-bearing.
- New unit spec `agent-stock-rules.spec.ts` 5/5 (event derivation, date, repeated line).
- Affected suites (serial + integration): stock-lifecycle, agent-orders, agent-finance, agent-portal (HTTP),
  agent-overview-leaks, agent-stock — 6 suites / **114 tests pass**; inventory-integrity, inventory-hardening,
  fulfillment-recognition, agent-portal-products — pass.
- API full `jest` (non-serial): 223 suites, **2629 pass / 2 fail** — both in `lead-eligibility.integration.spec`,
  environmental: the DB had 1,483 users after repeated full runs and the service caps `excluded` at 200; the same
  spec passes 16/16 on a fresh copy of the template (`oms_r17_int`) with this branch's code.
- API `tsc --noEmit` clean, eslint clean on touched files.
- Web: `tsc --noEmit` clean, eslint clean on touched files, vitest navigation + agents + agent-portal +
  inventory/traceability config + control-surface/selector-triggers + master-data — 28 files / 194 tests pass
  (one expected update: the agents module overview now lists `agents-stock-receipts`), new `agent-stock.spec.ts`
  3/3; `next build` succeeds (route `/agents/stock-receipts` built).
- No browser pass was run.

## Open owner decisions

- **OD-B1 Controlled ownership conversion.** Not built. Converting company goods to an agent (or back) needs an
  accounting answer: is it a sale / purchase to the agent (payable / receivable at what value?) or a write-off?
  Today the safe path is: new SKU for the new owner, negative adjustment on the old one (company goods: posted
  at average cost; agent goods: no GL), receipt on the new SKU.
- **OD-B2** Returns from transit (never delivered) come back as transfers and are not counted in `returned`
  (only post-delivery returns are) — confirm the agent statement wording.
