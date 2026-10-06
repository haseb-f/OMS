# R13 handoff

**State:** LOCAL on `feat/r13-product-model` (canonical repo), not pushed, not released. Awaiting owner review + approvals.

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
