# R13 handoff

**State (2026-10-06):** RELEASED to Production — `main` = `fc88026f`, Vercel Production deployment 6880819835 `success`
(owner approval of the local review, 2026-10-06). Verified read-only on Production as the QA admin
(`evidence/prod/r13-prod-survey-post.{json,md}`): new fields/routes live, migration applied, 41 products unchanged.

**Combined release:** the parallel workstream _R13 accounting & reporting_ (`claude/hopeful-feynman-2hzaxf`, specs
`round13-accounting-reporting/`) was still active and is NOT released — it awaits its own owner decisions O-1…O-10, visual
review and its Production pre-flight SQL (`proposals/payment-matches-duplicates.sql`). It is integrated and tested on
`integration/r13-combined` (`825197e9`: conflicts resolved — one shared `useIdempotencyKey` hook, additive i18n; all 5
migrations apply in order on a clone; API 190/190 suites, serial 14/14, web 140/140, both builds green). When it is approved:
re-merge its latest commits, re-run the gates, then push a NEW commit to `main` (a SHA first pushed to a branch does not
trigger a Production deploy on Vercel).

**Production integrity after deploy:** I1 FAIL = 12 historical movements of `PRD-2026-000001 @ WH-000001` written on
2026-09-18 within minutes (QA runs before the R13 row locks; no new violation since). I6 WARN = sub-ledger 4 147 059.83 vs GL
97 163.06, explained almost entirely by 27 opening-balance movements (4 049 800.00) with no opening journal on the inventory
account; remainder 428.19. Both are historical financial matters — reported, NOT corrected (needs the owner).

## Review locally

- Stack: `.claude/launch.json` → `api-r13` (:4805, DB `oms_r13_demo`) and `web-r13` (:4801), production builds.
- Demo records are tagged `[R13-DEMO]`; demo personas `demo-r7-*@oms.local` (password in `tmp/r7-final/.r7.env`).
- Pages: Products (new form), product detail → Recipe tab, Inventory → Assembly, Stock (owner column), Inventory → Integrity.
- Re-run proof: `scripts/acceptance/r13/r13-journeys.mjs` (111 checks), `r13-browser.mjs` (176 checks), `apps/api/scripts/r13/*` (integrity, dry-run, before/after).

## Approvals needed before release (spec §10)

1. Visual/functional approval of the local review (form + journeys A–F).
2. Run `r13-migration-dry-run` against a **Production backup/clone** (read-only) and review its list (migration.md §4–5) — the local numbers are from the verification DB, not Production.
3. Owner decisions O1–O8 (defaults applied; nothing blocks): GRN/three-way match, mixed-owner agreements, dropping `product_components` / `Product.type` (destructive — explicit approval), landed-cost reversal, service-only orders in the shipping queue, rollout of migration + permissions, returns of lines sold before a product became a kit, physical-count difference basis.
4. Grant the new rights to the right roles (nobody receives them by migration): `inventory.assembly.create`, `inventory.assembly.reverse`, `inventory.assembly.direct_cost`, `products.recipes.manage`; set **Accounting settings → Assembly cost account** before any assembly with a direct cost.

## Release path (after approval)

Merge to `main` → push (Vercel production deploy runs `prisma migrate deploy`; the R13 migration is additive and was proven lossless on a clone) → verify Production read-only via API/UI.

## Known limits (not hidden)

Integer stock quantities (no fractional units), single-hop unit conversion, no lots/serials/bins, no FIFO/standard cost, no GRN, nested kits not supported, the activity log text stays English, a raced second invoice confirm answers 400 "changed by someone else" (data stays correct).

## Combined release package (prepared, NOT pushed — 2026-10-06)

Local branches only (never push the reset migration to any branch before the release commit — Vercel Preview builds
also run `prisma migrate deploy`): `feat/r13-followups` (drop legacy table, purchase-return O9, guarded test-data reset)
merged into local `integration/r13-combined` with the parallel R13 accounting & reporting branch. On a fresh clone all 7
migrations apply in order and the reset is a no-op off Production; API 191/191 suites (2336), serial 14/14 (152),
web 140/140 (999), typecheck clean.

Before the combined release can ship, the owner must:

1. Approve the R13 accounting & reporting workstream (its decisions O-1…O-10, visual review, pre-flight SQL).
2. Confirm the reset switches (`reset-plan.md` §7): R-O1 keep the QA opening entry (posting needs a fiscal-year opening —
   recommended yes), R-O2 delete investment opportunities + product links, keep investor profiles (recommended yes),
   R-O3 keep CRM leads (recommended yes).
3. R-O4: disable or clear the Google Sheets order sync sources first, or the next sync re-imports the deleted test orders.
4. R-O5: take a Supabase backup (and `pg_dump`) immediately before the release; rollback = restore it, then
   `prisma migrate resolve --applied 20261007130000_r13_reset_production_test_data` so it is not re-run.
5. Confirm that Vercel Preview does NOT use the Production database (otherwise only push the final commit to `main`).

Release steps: re-merge the accounting branch's latest commits into `integration/r13-combined`, re-run the gates, fast-forward
`main`, push a NEW commit (branch-pushed SHAs do not trigger a Production deploy), then verify with
`scripts/acceptance/r13/r13-prod-survey.mjs` (PHASE=post) and `GET /inventory/integrity` (expect I1–I7 PASS, I6 difference 0).
