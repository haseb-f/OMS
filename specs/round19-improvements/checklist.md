# R19 — checklist (integrated branch `feat/r19` = A + B + C, local only)

## Status

|                |                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Implementation | done — A `fa3f9094 707b5235 5dba74be` + RTL fix `314684f7`, B `59dc87b2 d022c103`, C `98742c95 65255d6e 816ee159` |
| Verification   | done on the integrated tree (below)                                                                               |
| Deployment     | **not deployed** — awaiting owner review of the local preview; no migration in this round                         |

## Gates (integrated tree)

| Gate                                                 | Result                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| API typecheck / lint / build                         | ✓ / 0 problems / ✓                                                                                                                                |
| Web typecheck / lint / build                         | ✓ / 0 errors (9 pre-existing warnings) / ✓                                                                                                        |
| Web vitest                                           | 182 files, 1296 / 1296                                                                                                                            |
| API jest (`oms_r19_gate`, clean `oms_r17_int` clone) | 2648 / 2651 — `lead-eligibility` (fixture data: 16/16 on `oms_r18_final`-based clone), `store-orders-import.handler` (parallel load: 37/37 alone) |
| API serial                                           | 23 suites, 238 / 238 (incl. new `agent-assembly.integration.serial.spec.ts`)                                                                      |
| Contrast check                                       | all pairs pass (B +19 / theme, C +212)                                                                                                            |

## A — agent recipes + stocked assembly

- [x] Agent gift box recipe (2 × A + 1 × B), versioned; same-agent rule; cycle / quantity checks unchanged.
- [x] Preview: required / on hand / reserved / available / shortage / finished quantity; no cost for agent stock.
- [x] 100 boxes → A −200, B −100, box +100, owner = agent, linked to ASM + recipe version; 0 journal lines.
- [x] Shortage + reserved components refused with no partial movements; concurrent confirm posts once; retry returns the same order.
- [x] Box reserved / shipped / delivered without touching A / B; return restores the box.
- [x] Reversal refused while boxes are sold / reserved; allowed otherwise; quantities only.
- [x] Company assembly + costing unchanged (assembly spec 32 / 32).
- [x] Integrated browser journey 10 / 10 (`r19-a-agent-assembly-browser.mjs`, ASM-2026-000003, JE count 126 → 126).

## B — sidebar

- [x] Light: charcoal `#1f2024`; dark: soft light grey `#e8e9ec`; all states via `--sidebar-*` tokens; guard spec.
- [x] Company (expanded / collapsed / mobile drawer), agent + partner portals, ar + en, light + dark.

## C — sales-report cards

- [x] `size="report"` on the shared cards for Live, My performance, Employees, Teams, Payment mix (company `/reports/sales`, agent `/agent/reports`).
- [x] Values unchanged: 24 tab views, 74 cards, 0 differences; no overflow / truncation (long amounts at 375 + 1440).

## Limitations / owner decisions

- A: no assembly fee is charged to the agent (belongs in the agreement if wanted); company packaging + agent goods in one box refused (one owner per recipe); reversal is all-or-nothing per order.
- B: investor portal has a top bar, no sidebar (no investor persona to view); profile menu lives in the top bar.
- C: 1280–1439 px the Live row wraps 3 + 2; glass is subtle on plain light backgrounds.
