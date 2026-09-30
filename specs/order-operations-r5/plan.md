# Round 5 — Order operations, agent pricing, payment UX, visual refinement

Status: **ACTIVE** (owner brief 2026-09-30). This round supersedes earlier UX/pricing assumptions
where they conflict — notably `agents-fulfillment-partners/commission-policy.md` A6/A7 (carrier cost
in the agent-Admin report; destination-only agent shipping rates, open question C2).

Owner/integrator: session "OMS order operations & agent pricing (Round 5)". No other session was
running at inspection time (2026-09-30); earlier sessions are idle and their work is released.

Screenshots referenced by the brief were **not attached**; the baseline is the code at `7e8bc1f`
(= Production) plus the local preview.

## Specs

| #   | Spec                                                  | File                      | Release gate                       |
| --- | ----------------------------------------------------- | ------------------------- | ---------------------------------- |
| 1   | Editable orders, duplicate prevention, compact detail | `spec-1-orders.md`        | functional — releasable on its own |
| 2   | Agent product linking and shipping tariffs            | `spec-2-agent-pricing.md` | functional — releasable on its own |
| 3   | Payment review and reconciliation UX                  | `spec-3-payments.md`      | functional — releasable on its own |
| 4   | Report header collapse, soft cards, toolbar polish    | `spec-4-visual.md`        | **owner visual approval first**    |

## Dependencies

```
Spec 2 (tariff + pricing status + snapshot)  ─┐
Spec 1B (duplicate check + idempotent create) ─┼─► Spec 1A (amendments: recompute pricing,
                                               │    commission, payment sufficiency)
                                               └─► Spec 1C (compact detail shows pricing state,
                                                    amend + duplicate-review actions)
Spec 3 (payment vocabulary + match panel) ─────► Spec 1C reuses the payment vocabulary
Spec 4 (shared toolbar/card primitives) — independent; web-only
```

Business/pricing foundations (Spec 2, Spec 1B) land before the dependent amendment workflow and
detail page (Spec 1A/1C).

## Ownership and isolation

| Workstream  | Branch / worktree                                   | Local DB         | Owns (primary files)                                                                                                                                                              |
| ----------- | --------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W2 pricing  | `feat/r5-agent-pricing` `D:/Systems/OMS-r5-pricing` | `oms_r5_pricing` | `agents/**` (orders, pricing, commission, admin agreements, portal report), shipment carrier assignment hook, products ownership UI, agent Products tab                           |
| W1B dup     | `feat/r5-duplicates` `D:/Systems/OMS-r5-dup`        | `oms_r5_dup`     | `store-orders` create path, `partners` duplicate lookup, lead convert dialog, store-order create dialog, agent customer resolution (read-only reuse)                              |
| W3 pay      | `feat/r5-payments` `D:/Systems/OMS-r5-pay`          | `oms_r5_pay`     | `payments/**`, `payment-reconciliation/**`, `payment-settlements/**` (bulk endpoints only), web `components/payments/**`, `finance/payment-*` pages                               |
| W4 visual   | `feat/r5-visual` `D:/Systems/OMS-r5-visual`         | (main local DB)  | `components/ui/**`, `theme/**`, `globals.css`, `components/dashboard/**`, `components/accounting/financial-report/**`, `shared/data-table/list-surface.tsx`, `filter-popover.tsx` |
| W1A/C amend | `feat/r5-order-amend` (after W2 + W1B merge)        | `oms_r5_amend`   | `store-orders` amendment service/controller, `/store-orders/[id]` page, agent order detail edit                                                                                   |

Conflict rules: a workstream edits another workstream's files only for a minimal, documented hook.
Each workstream adds **one** additive Prisma migration with its own timestamp; no destructive
migration. `schema.prisma` merges are resolved by the integrator.

## Release sequence

1. W2, W1B, W3 → independent review (financial correctness, authorization) → fix → merge to `main`
   → gates on merged `main` → push (Production) → verify deployed SHA and journeys.
2. W1A/C on top → review → fix → release the same way.
3. W4 → local preview + before/after screenshots → **owner approval** → release. Until approved it
   stays on its branch; nothing in 1–2 depends on it.

## Quality gates (every workstream, then again on merged `main`)

API: `pnpm --filter api typecheck`, `lint`, `test` (real local Postgres), `build`.
Web: `pnpm --filter web typecheck`, `lint`, `test`, `build`.
Browser: one pass per released increment on the affected pages (AR/EN, RTL/LTR, 390px, dark).

Demo data is tagged `DEMO-R5-20260930-*`. No real financial history is edited or deleted.
