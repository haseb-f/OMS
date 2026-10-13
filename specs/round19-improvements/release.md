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
