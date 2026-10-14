# R22 — receipts, payments, invoice settlement (checkpoints)

Owner brief 2026-10-14 (receipts / payments / settlement + UI). Deploy authorised once the complete round passes
(standing authorisation, handoff §5). Process: investigate → failing regression cases → root causes + repair plan →
implement → independent accounting review → integrated gates → release → live verification → Arabic handoff.

| When       | State                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-14 | Start. main = origin = Prod `f77ee307`. Branch `feat/r22`. DBs: `oms_r22_int` (clean, oms_r17_int), `oms_r22_demo`, `oms_r22_ui` (oms_r20_final clones). |
| 2026-10-14 | Phase 1 launched: I-A accounting trace (both directions, Prod read-only audit, failing tests) · I-B UI / voucher-type / table investigation.             |
