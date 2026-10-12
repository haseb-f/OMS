# R18 — acceptance checklist (integrated branch `feat/r18-payments` = A + B + C)

## Gates on the final integrated tree

| Gate                                                    | Result                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API typecheck / lint / build                            | ✓ / 0 errors / ✓                                                                                                                                                                    |
| Web typecheck / lint / build                            | ✓ / 0 errors (9 pre-existing warnings, untouched files) / ✓                                                                                                                         |
| Web vitest                                              | 179 files, 1275 / 1275                                                                                                                                                              |
| API jest (clean clone `oms_r18_gate2` of `oms_r17_int`) | 2646 / 2650 — `lead-eligibility` (fixture data: 16/16 on `oms_r18_gate`, `oms_r17_a`-based) and `store-orders-import.handler` + `sales-flow.hardening` (parallel load: 57/57 alone) |
| API serial (`oms_r18_gate2`)                            | 22 suites, 236 / 236                                                                                                                                                                |
| Migration `20261012100100_r18_agent_stock_receipts`     | applied on `oms_r18_gate`, `oms_r18_gate2`, `oms_r18_final`; re-run no-op                                                                                                           |

## A — payments

- [x] Owner's case 200,000 / 100,000: PARTIALLY_PAID, outstanding 100,000, bank 100,000, AR / aging / statement reconcile (integration).
- [x] Supplier partial payment (integration); two partial receipts + refused third; one receipt over two invoices; advance then allocate (aging unapplied / net).
- [x] Cancel = reversal once; idempotent submit + double confirm post once.
- [x] Over-allocation refused at update / confirm / posting; FX partial receipt; bank match of a different amount refused.
- [x] Browser (local build, `evidence/a/results.json` 12 / 12): Receive Payment → lower allocation → amount follows → posts 100,000 with no warning; typed 200,000 with 100,000 applied → warning (ar desktop, en 375 px) → back posts nothing; no horizontal scroll.
- [x] Production repair of CR-2026-000095 applied after release: cancelled (reversal JV-2026-000417) + replacement CR-2026-000097 100,000 → INV-2026-000091 (JV-2026-000418); re-run idempotent (`evidence/repair-CR-2026-000095*.json`); integrity 0 errors / 0 review.
- [x] Follow-up found in the live pass: a saved partial receipt marked its invoice line "fully paid" (line capacity = its own amount). Fixed with `allocation-capacity.ts` (invoice open balance + the line once confirmed); journey 13 / 13; web vitest 1278 / 1278.

## B — agent consignment stock

- [x] 10 received (no cost) → reserve 3 → dispatch → deliver → return 1 → on hand 8 / reserved 0 / available 8 / delivered 3 / returned 1; no goods JE lines (integration, `progress-b.md`).
- [x] Another agent cannot order or reserve it; company goods still fail with MISSING_COST; valuation excludes agent stock; owner change refused.
- [x] Browser (`evidence/b/results.json` 11 / 11): receipt at /agents/stock-receipts (no cost input), ASR number, on-hand +10, JE count unchanged, portal movement visible to the owner agent only, portal stock at 375 px.

## C — login + report cards

- [x] Login fields + submit 46 → 44 px, 16 px text, reveal button centred (`evidence/c/login-check-local.json`).
- [x] One card recipe (glass, tint, rise via `translate`, focus = hover + ring, reduced motion, touch); consumer audit + guard spec (`progress-c.md`).

## Open owner decisions

- OD-B1 controlled ownership conversion (accounting treatment) — refusal + documented path today.
- OD-B2 goods returned from transit are not counted as "returned" (only returns after delivery).
- OD-A1 CR-2026-000096 (100,000 cash, unallocated) — keep as advance, allocate to INV-2026-000091's remaining 100,000, or cancel.
- OD-A2 provider / carrier settlement fee = gross − received has no cap: a partial remittance settled in full books the shortfall as fee (per-claim settle amounts exist) — confirm whether to add a threshold.
