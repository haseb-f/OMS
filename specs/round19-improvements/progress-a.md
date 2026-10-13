# R19 stream A — recipes + stocked assembly for agent-owned products

Branch `feat/r19-agent-assembly` (worktree `.claude/worktrees/agent-abebadcf15d05a303`), local only — not pushed,
not merged. Spec: `specs/round19-improvements/README.md` §A. No migration (the existing schema already carries the
owner snapshot on orders and movements; the order's required cost columns hold 0 for agent orders and are never
shown).

## What existed (verified in code) vs what was added

| Area             | Before R19                                                                                                                                                    | R19 A                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe ownership | one owner for box + components (`RECIPE_OWNER_MIXED`), versioning, cycle / unit / quantity checks; recipe component picker scoped to the product's agent      | unchanged (reused). New: an agent recipe carries no direct cost estimate (`RECIPE_AGENT_DIRECT_COST` at activation); recipe views and the cost estimate return `null` figures + `valued: false` for agent products                                                                                                                                                                                                              |
| Assembly engine  | locks products sorted, idempotent per key, consume + receive in one transaction, recipe snapshot, no journal for agent orders, direct cost refused for agents | same path. **Gap closed:** `ASSEMBLY_COMPONENT_COST_MISSING` blocked every agent assembly (agent goods have no cost). Agent assemblies are now **non-valued**: no cost read or required, movements without unit cost, no `applyAssemblyOutput` / `applyAssemblyReversal` / `returnComponentToAverage`, no posting; every cost figure of the order and preview is `null` (`valued: false`). Company path byte-for-byte unchanged |
| Availability     | plan used `onHand − reserved` per warehouse (`readStockAvailability`)                                                                                         | preview now exposes `onHand`, `reserved`, `available`, `shortage` per line and `finishedQuantity`. **Inventory Engine backstop:** `postProductionMovement` refuses a negative production movement that would take reserved units (`INVENTORY_RESERVED_STOCK`)                                                                                                                                                                   |
| Reversal         | permission `inventory.assembly.reverse`, reason required, refused when finished units are not available (`ASSEMBLY_OUTPUT_CONSUMED`)                          | reused; agent reversal is quantities only. Reserved / shipped / sold boxes block it (available = on hand − reserved)                                                                                                                                                                                                                                                                                                            |
| Traceability     | agent stock history: receipt / order / return                                                                                                                 | + events `ASSEMBLY_CONSUMED`, `ASSEMBLED`, `DISASSEMBLED`, `ASSEMBLY_RESTORED`; document `ASSEMBLY_ORDER` (number + recipe version, scoped to the agent); `GET /assembly?agentId=`                                                                                                                                                                                                                                              |
| Permissions      | assembly = internal `inventory.assembly.*`; agent users keep only `agent.*` keys (effective-permission formula)                                               | unchanged — proven: an agent ADMIN / SALES user granted `inventory.assembly.*` ends with no `inventory.*` key                                                                                                                                                                                                                                                                                                                   |
| Store orders     | ASSEMBLED products are plain stocked lines (only KIT expands)                                                                                                 | verified end-to-end: an agent order reserves / dispatches / delivers the box only; components never move again; return restores the box                                                                                                                                                                                                                                                                                         |

## Web

- Assembly dialog: **Owner** (company stock or an agent, `agents.view` holders) scopes the assembled-product picker
  (company flows never list agent goods); finished quantity to receive; per component required / available /
  shortage with "on hand · reserved for orders"; no cost column, estimate or direct-cost field for agent stock.
- Agent page → Stock tab: **Assemble boxes** (only with `inventory.assembly.create`; owner fixed to the agent).
- Assembly detail: Owner (agent link), "Not valued — agent-owned consignment stock" instead of cost totals, agent
  reversal wording. Assembly list: Agent filter.
- Recipe panel (agent product): no direct-cost estimate field / figure, one-line non-valued + same-agent note.
- Agent stock history: assembly rows link to the assembly order with "Assembly · version N" (portal: number only).

## Test evidence (local `oms_r19_a_int`)

- New `apps/api/src/assembly/agent-assembly.integration.serial.spec.ts` — **2/2 pass**: receipt 230 A + 110 B (ASR)
  → recipe 2 A + 1 B v1 (estimate `valued: false`, all null) → preview 100: required 200 / 100, available 230 / 110,
  shortage 0, finished 100, max 110, no cost → agent order reserves 20 A: preview 106 shows A on hand 230 /
  reserved 20 / available 210 / shortage 2, create refused `ASSEMBLY_INSUFFICIENT_STOCK`, 0 movements → assemble
  100: **A −200, B −100, box +100**, 3 movements all `ownerAgentId` = agent, `recipeId`, `unitCost` null, linked to
  the order; retry with the same key → same order, `replayed: true` → two concurrent confirms of 5 (A available 10):
  exactly one posts (+3 movements), the other `ASSEMBLY_INSUFFICIENT_STOCK`; the 20 reserved A untouched → agent
  order of 10 boxes reserve → dispatch → deliver: box on hand 95 / delivered 10, **A and B unchanged**, all order
  movements on the box, 0 invoices → return 1: box 96 → reversal of the 100-box order refused (sold) and of the
  5-box order refused while 92 boxes are reserved (`ASSEMBLY_OUTPUT_CONSUMED`, nothing moved) → a further 2-box
  assembly reversed: A +4, B +2, box −2, non-valued → final A 30 (20 reserved), B 10, box 96 (92 reserved,
  delivered 10, returned 1); **journal entries and lines unchanged**, no cost history / snapshot, `currentCost`
  null, company valuation 0 items; history shows RECEIPT → ASSEMBLY_CONSUMED / ASSEMBLED (ASM number, v1) →
  RESERVED / DISPATCHED / DELIVERED / RETURNED → DISASSEMBLED / ASSEMBLY_RESTORED; agent B sees nothing; list by
  agent. Second test: another agent's and a company component `RECIPE_OWNER_MIXED`, agent recipe with an estimate
  `RECIPE_AGENT_DIRECT_COST`, agent direct cost `ASSEMBLY_AGENT_DIRECT_COST`, shortage preview, engine backstop
  `INVENTORY_RESERVED_STOCK`, agent roles never hold `inventory.*`.
- **Mutation checks:** (1) forcing `valued = true` in `buildPlan` (old behaviour) → both tests fail with
  `ASSEMBLY_COMPONENT_COST_MISSING`; (2) disabling the engine reserved-stock guard → the backstop test fails. Both
  restored.
- Existing `assembly.integration.serial.spec.ts` 32/32 (company fixture A 2×10 + B 1×15 + direct 5 → unit 40,
  balanced journal, reversals, variance — unchanged); its agent case updated to the R19 rule (non-valued, `null`
  costs, legacy component cost untouched).
- Assembly / recipes / inventory / agent-stock / store-order stock-lifecycle / valuation suites: 18 suites, 189
  tests pass. Wider run: see the final report.
- API `tsc --noEmit` clean, eslint clean on touched files. Web `tsc --noEmit` clean, eslint clean, vitest full
  **180 files / 1280 tests pass**; `next build` succeeds.
- Browser (local preview, demo DB `oms_r19_a`): `scripts/acceptance/r19/r19-a-agent-assembly-browser.mjs`
  MODE=before 5/5, MODE=after 10/10 (100 boxes posted through the dialog, A 30 / B 10 / box 100, journal count
  126 → 126). Screenshots in `evidence/a/before` (dialog blocked by `ASSEMBLY_COMPONENT_COST_MISSING`, 0.00 cost
  columns) and `evidence/a/after`.

## Open owner decisions

- **OD-A1 Assembly-service charge.** Nothing is charged to the agent for assembling (no fee added automatically,
  as briefed). If the company bills agents for assembly labour, it belongs in the agent agreement (a per-order /
  per-unit fee like the COD collection fee) — rate and earning event to be decided.
- **OD-A2 Packaging owned by the company.** A box that uses company packaging plus agent goods is refused (one owner
  per recipe). If needed: either the agent buys the packaging (sale to agent) or the packaging is received as
  agent stock — accounting answer required.
- **OD-A3 Partial reversal.** Reversal is all-or-nothing per assembly order (existing rule); disassembling part of
  an order (e.g. 4 of 5 boxes) is not built.
