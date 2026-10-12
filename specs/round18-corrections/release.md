# R18 — release record (2026-10-12)

| Step                                     | Result                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release 1                                | `24e16576` (A + B + C) → Production deployment 7014798872 **success**; migration `20261012100100_r18_agent_stock_receipts` applied by the Production build (`/agent-stock-receipts` 200, stock rows expose `inTransit` / `delivered`) |
| Repair                                   | CR-2026-000095 cancelled (reversal JV-2026-000417) + replacement CR-2026-000097 100,000 → INV-2026-000091 (JV-2026-000418), via business operations; re-run idempotent                                                                |
| Release 2 (follow-up from the live pass) | `f9ea24a0` — saved partial receipt line no longer reads "fully paid" → deployment 7015281223 **success**                                                                                                                              |
| Live checks (read-only)                  | R14 smoke 19 / 19 · login 10 / 10 (44 px, 16 px text, toggle centred) · live browser 6 / 6 · voucher integrity 0 errors / 0 review (11 vouchers, 11 entries)                                                                          |

## Reconciliation — INV-2026-000091 (دار الهدى للنشر)

| Figure                                           | Before                                           | After                                                                       |
| ------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Invoice total / allocated / outstanding / status | 200,000 / 100,000 / 100,000 / PARTIALLY_PAID     | 200,000 / 100,000 / 100,000 / PARTIALLY_PAID                                |
| Receipt applied to the invoice                   | CR-2026-000095 — amount 200,000, applied 100,000 | CR-2026-000097 — amount 100,000, applied 100,000 (CR-2026-000095 CANCELLED) |
| البنك الرئيسي (from 2026-10-11)                  | +200,000 (JV-2026-000415) = 200,000              | +200,000 −200,000 (JV-2026-000417) +100,000 (JV-2026-000418) = **100,000**  |
| Partner statement                                | Dr 200,000 / Cr 300,000 → −100,000               | Dr 400,000 / Cr 400,000 → 0                                                 |
| AR aging (all customers) unapplied               | 207,650                                          | 107,650                                                                     |

The statement nets to 0 only because CR-2026-000096 (100,000 cash, unallocated, separate voucher) is still an
advance on the account: open 100,000 − advance 100,000. Owner decision OD-A1 (keep, allocate to INV-2026-000091,
or cancel). Evidence: `evidence/repair-CR-2026-000095*.json`, `evidence/prod-post-deploy.json`, `evidence/live/`.

## Not done / open

- OD-A1 CR-2026-000096 · OD-A2 settlement-fee threshold · OD-B1 ownership conversion · OD-B2 "returned" wording
  (see `checklist.md`).
- Investor portal pages share the updated card component but have no demo account to view (unit-covered).
- No transactional live journeys on Production beyond the repair (agent stock receipt, payments) — proven on the
  local integrated build (`evidence/a`, `evidence/b`).
