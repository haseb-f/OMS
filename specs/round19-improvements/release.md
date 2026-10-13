# R19 — release record (2026-10-13)

Owner approved the local preview → `feat/r19` fast-forwarded to `main`.

| Step                                                                   | Result                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release                                                                | `1d659b5d` → Production deployment 7036908079 **success**; no migration in this round                                                                                                                                                   |
| R19 live check (read-only, `scripts/acceptance/r19/r19-prod-live.mjs`) | 9 / 9 — assembly list + agent filter 200, orders expose `valued`; sidebar `#1f2024` vs content `#ffffff` (light) and `#e8e9ec` vs `#0a0a0a` (dark), 16.3 : 1 each; sales-report cards at report size (6) in both themes; no page errors |
| R14 smoke                                                              | 19 / 19                                                                                                                                                                                                                                 |
| Login check (R18)                                                      | 10 / 10 — 44 px fields unchanged                                                                                                                                                                                                        |

No transactional journey on Production (no agent assembly was posted live); the full acceptance journey is
proven on the local integrated build (`checklist.md`, `evidence/a`, serial 238 / 238).

Open owner decisions: assembly fee for agents · mixed-owner boxes · partial reversal (see `checklist.md`).

## C2 — sales-report card refinement (owner approved 2026-10-13)

| Step                                        | Result                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Release                                     | `3ca35cc2` (`feat/r19-cards-refine` fast-forwarded) → Production deployment 7038927206 **success**; no migration                               |
| Live check (`r19-prod-live.mjs`, read-only) | 11 / 11 — colour identities on the Live cards in light + dark (teal, sky, blue, violet, orchid), report size, sidebar 16.3 : 1, no page errors |
| R14 smoke                                   | 19 / 19                                                                                                                                        |

Demo orders tagged "R19C2 demo" exist only in the local `oms_r19_c` database; Production data untouched.
