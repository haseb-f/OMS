# R20 — release record (2026-10-14)

Owner authorised the combined release. `feat/r20` (A + B + C) fast-forwarded to `main`.

| Step                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release                                            | `c83ea82d` → Production deployment 7048746657 **success**; migration `20261013100000_r20_lead_assignee_opens` applied by the Production build (`openedByAssigneeAt` on every lead)                                                                                                                                                                                                                                  |
| Live check `r20-prod-live.mjs`                     | 19 / 19 — admin open of an employee's lead is a no-op (LD-2026-000002 stays unread, status QUALIFIED unchanged); `employee-periods` 200 with 5 periods; INV-2026-000091 100,000 / 100,000 / PARTIALLY_PAID; customer position received 200,000 · applied 100,000 · unapplied 100,000; voucher integrity 0 / 0; leads, employees (30 period boxes), invoices render ar 1440 + en 375 without overflow or page errors |
| Payment audit `r20-payment-status-audit.mjs` (GET) | every invoice: displayed status = confirmed allocations                                                                                                                                                                                                                                                                                                                                                             |
| Repair dry-run `r20-repair-payment-status.mjs`     | NOTHING_TO_REPAIR — no record changed                                                                                                                                                                                                                                                                                                                                                                               |

Integrated gates before release: API + web typecheck ✓, lint 0 errors, contrast ✓, builds ✓, web vitest 1321 / 1321,
API jest 2664 / 2669 + serial 236 / 238 (FX suites 34 / 34 alone, agent-assembly 2 / 2 alone after a machine sleep,
lead-eligibility 16 / 16 on the demo-based DB), local journeys A 38 / 38, C 23 / 23, B 100 boxes 0 mismatches.

## Not verified live / open

- The assignee's own open on Production: every Production lead belongs to a real staff account; no QA persona owns
  one, so the "employee opens → badge gone for manager / admin" step is proven locally (A 38 / 38) and by the
  integration spec, not on Production.
- After the backfill 45 of 47 Production leads read «لم يُفتح»: only opens proven by the old per-viewer record
  (`lead_views`) or `first_opened_at` for the assignee of that moment were kept — no open was invented.
- Unapplied receipts left for the owner: CR-2026-000096 (100,000, دار الهدى — INV-2026-000091 still owes 100,000) and
  CR-2026-000099 (50,000, مكتبة النور — INV-2026-000093 110,000 unpaid). The apply command is ready
  (`--allocate CR-2026-000099=INV-2026-000093 --allocate CR-2026-000096=INV-2026-000091`, no new cash entry).
- Decisions: invoice grid cards now coloured by payment status (changes `specs/round9-brand-grid/card-palettes.md`);
  NEW leads stay NEW after opening (move to IN_PROGRESS via «بدء المتابعة»); unassigned leads show no badge; aging
  totals still add currencies; an archived invoice with a balance drops out of aging.

## B2 — employee cards side by side (2026-10-14)

| Step                        | Result                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release                     | `98f07802` (merge of `feat/r20-employee-cards-2`) → Production deployment 7051059357 **success**; web only, no migration                                         |
| Gates (merged main)         | web typecheck ✓, lint 0 errors, vitest 184 files / 1324, contrast all pass (392 new currency × period pairs), next build ✓                                       |
| Value proof (local)         | 100 boxes 0 mismatches; R19 figures comparison 24 views / 188 cards 0 differences                                                                                |
| Live `r20-b2-prod-live.mjs` | 12 / 12 — two cards per row at 1440 (568 × 515 ar, 568 × 633 en dark, same top and size), five period rows each, one per row at 375, no overflow, no page errors |

Currency colours on every report card: EGP teal, SAR sky, USD blue, AED indigo, EUR violet, KWD orchid, others a stable
hue; the code is always written; negative amounts keep the danger colour. Demo orders «R20B2 demo» exist only locally.

## Owner-approved allocations (2026-10-14)

`r20-repair-payment-status.mjs --apply --allocate CR-2026-000099=INV-2026-000093 --allocate CR-2026-000096=INV-2026-000091`
(business operation "allocate" on the confirmed receipts — no new cash entry, one journal entry per receipt unchanged).

| Record                            | Before                                  | After                                                 |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| INV-2026-000091 (دار الهدى للنشر) | 200,000 · paid 100,000 · PARTIALLY_PAID | paid 200,000 · outstanding 0 · **PAID**               |
| INV-2026-000093 (مكتبة النور)     | 110,000 · paid 0 · UNPAID               | paid 50,000 · outstanding 60,000 · **PARTIALLY_PAID** |
| CR-2026-000096                    | 100,000 unapplied                       | 100,000 → INV-2026-000091                             |
| CR-2026-000099                    | 50,000 unapplied                        | 50,000 → INV-2026-000093                              |

Customer positions: دار الهدى received 200,000 = applied 200,000, unapplied 0; مكتبة النور received 50,000 = applied,
outstanding 60,000. Voucher integrity 0 errors / 0 review. Re-run: both SKIP (already applied). Evidence:
`evidence/c/prod-allocate-{dry-run,applied,rerun}.json`.
