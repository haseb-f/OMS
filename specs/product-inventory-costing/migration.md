# R13 — Migration, reconciliation and rollback

Migration: `apps/api/prisma/migrations/20261006090000_r13_product_inventory_costing/migration.sql` (additive,
non-destructive). Tools (all READ-ONLY sessions, `default_transaction_read_only=on`; the local `oms` database is refused):

| Script (`apps/api/scripts/r13/`) | Purpose                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `r13-migration-dry-run.ts`       | Owner-review lists + reconciliation baseline, before **or** after the migration (detects the new columns). |
| `r13-before-after.ts`            | Compares two dry-run JSON files; exit 1 if any quantity / movement / cost / GL figure differs.             |
| `r13-integrity.ts`               | Invariants I1–I7 (same service as `GET /inventory/integrity` and the `/inventory/integrity` page).         |

Run with `pnpm --dir apps/api exec ts-node scripts/r13/<script>.ts` and an explicit `DATABASE_URL` (see each file header).
Evidence: `specs/product-inventory-costing/evidence/`.

## 1. Mapping old → new

| Old                                                                                                                                                                                                      | New                                                                                                                                                                                                                                                                                                                                                                                                | Rule                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Product.type` = `MANUFACTURED`                                                                                                                                                                          | `supplyMethod = ASSEMBLED`                                                                                                                                                                                                                                                                                                                                                                         | Only backfill on products. Behaviour preserved (it was an ordinary stocked item; no explosion existed).                                                                                           |
| `Product.type` = any other value                                                                                                                                                                         | `supplyMethod = PURCHASED` (column default)                                                                                                                                                                                                                                                                                                                                                        | `KIT` is never inferred — it is a deliberate choice on the product.                                                                                                                               |
| `Product.type` (6 values)                                                                                                                                                                                | kept as a **derived legacy column**                                                                                                                                                                                                                                                                                                                                                                | Re-derived by `deriveLegacyProductType()` on every write from itemType / flags / supplyMethod. Stored values are **not** rewritten by the migration (see §4 for rows whose stored value differs). |
| `itemType`, `isInventoryItem`, `isSellable`, `isPurchasable`, `ownerAgentId`                                                                                                                             | unchanged                                                                                                                                                                                                                                                                                                                                                                                          | Independent attributes (spec §2). Legacy NULL `itemType` stays NULL until reviewed.                                                                                                               |
| `product_components` rows                                                                                                                                                                                | one **DRAFT** `product_recipes` v1 per kit + `product_recipe_lines` (unit = the component's stock unit, positive quantities only)                                                                                                                                                                                                                                                                  | Never auto-activated — activation validates ownership, cycles and units. The old table is kept, deprecated and unread (drop = owner decision O3).                                                 |
| Cost columns `Decimal(12,2)` (`products.current_cost`, `product_cost_snapshots.cost`, `product_cost_histories.previous_cost/new_cost`, `inventory_movements.unit_cost`, `sales_invoice_items.unit_cost`) | `Decimal(14,4)`                                                                                                                                                                                                                                                                                                                                                                                    | Lossless widening — every stored value preserved exactly (proved by fingerprint, §5).                                                                                                             |
| —                                                                                                                                                                                                        | new: `inventory_movements.idempotency_key / parent_product_id / recipe_id`, `sales_invoice_items.fulfillment_snapshot`, `landed_cost_*` split columns + `exchange_rate`, `posting_settings.assembly_cost_account_id`, `product_categories.default_unit_id / default_tax_id`, tables `product_recipes`, `product_recipe_lines`, `assembly_orders`, `assembly_order_lines`, number series `ASSEMBLY` | All nullable / defaulted; no existing row is changed.                                                                                                                                             |
| barcode                                                                                                                                                                                                  | partial unique index `products_barcode_unique_active` on `lower(btrim(barcode))`                                                                                                                                                                                                                                                                                                                   | Created only when no duplicate exists (dry run: **0 duplicates** locally); application check always enforced.                                                                                     |

**Preserved:** every id, every foreign key / free reference (`reference_type/reference_id`, journal `source_type/source_id`),
all movement history (quantities, before/after snapshots, costs, owners, timestamps), all journal entries and lines, cost
snapshots and cost history, investment opportunities and allocations, `product_components`.

## 2. Dry-run procedure

1. Back up (§6).
2. `r13-migration-dry-run.ts` on the **pre-migration** database → `dry-run-<db>.json/.md` (supply method shown _as the
   migration will set it_; DRAFT recipes shown _as they will be created_).
3. Owner reviews §4 lists.
4. Apply the migration to a **clone** (`CREATE DATABASE <clone> TEMPLATE <db>` + `prisma migrate deploy`), dry-run the clone,
   then `r13-before-after.ts --before=… --after=…` — must PASS.
5. `r13-integrity.ts` on the clone — expected I1–I5, I7 PASS; I6 WARN with its known causes (§5).
6. Only then the real deploy path (O6), followed by steps 4–5 against production in read-only mode
   (`--allow-remote`, owner-run).

## 3. Before / after result (local proof)

`oms_r7_final` (pre-R13 source, last migration `20261005140000_r12_country_default_currency_usd`) was cloned to
`oms_r13_mig` and migrated with `prisma migrate deploy` (only `20261006090000_r13_product_inventory_costing` applied).

**Result: PASS — 29/29 checks equal** (`evidence/before-after-oms_r7_final-vs-oms_r13_mig.md`):

| Figure                                                                                                   | Before = After                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Products (deleted) / attribute fingerprint                                                               | 715 (95) / identical                                                                       |
| Movements / per-type counts / row fingerprint (qty, before/after, cost@4dp, owner, reference, createdAt) | 626 / identical / identical                                                                |
| Product × warehouse balances (on-hand / reserved)                                                        | 180, all identical; Σ on-hand 10 725                                                       |
| Company stock value (Σ round2(onHand × average))                                                         | 396 820.56                                                                                 |
| Cost fingerprints (current cost, 14 snapshots, 31 history rows, invoice line costs)                      | identical                                                                                  |
| Journal entries / lines / Σ Dr = Σ Cr / line fingerprint                                                 | 5 462 / 12 131 / 22 794 576.99 / identical                                                 |
| GL inventory account (INV) posted balance / COGS accounts                                                | 374 909.36 / 9 644.64                                                                      |
| Invoice line COGS / SALES_DELIVERY movement value                                                        | 9 930.26 / 0.00                                                                            |
| Allowed differences                                                                                      | 1 DRAFT recipe (= 1 legacy kit, same line count); supply method = projection (1 ASSEMBLED) |

Integrity on the migrated clone (`evidence/integrity-oms_r13_mig.md`): I1–I5, I7 **PASS**, I6 **WARN** (pre-existing
difference, identical before the migration).

Working database `oms_r13` (`evidence/integrity-oms_r13.md`, `dry-run-oms_r13.md`) additionally holds fixtures left by
the integration specs (981 products, 778 movements): I1–I4, I7 PASS, I6 WARN, **I5 FAIL — 36 findings, all on
`R13C-*` test invoices** whose kit-component movements and journals were deleted by the kit-fulfillment spec's afterAll
while the invoices (with their snapshots) were left behind. Test-fixture artefact, not product behaviour; the E1
integration spec cleans documents + journals + movements in one transaction to avoid exactly this.

## 4. Ambiguous classifications (from the dry run, for owner decision)

| Item                                          |                  Count | Detail                                                                                                                                                                                                |
| --------------------------------------------- | ---------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNCLASSIFIED `itemType` (NULL)                |                      7 | `CMP-9E9C40/A894BF/D5A91D-34/-44` (SALES_ONLY, untracked) and `SHIP-SYNC-TEST-b72608ba` (SERVICE) — test/demo items; classify (PRODUCT vs SERVICE) or archive.                                        |
| Stored legacy `type` ≠ derived                |                     10 | `R6SHIP-*-D` demo items: itemType SERVICE but stored `PURCHASE_AND_SALE` (purchasable). The next save re-derives `SERVICE`; nothing is rewritten by the migration.                                    |
| Attribute rule violations                     |                     10 | `AGT-F7-*` agent items: itemType SERVICE **and** stock-tracked (`PRODUCT_SERVICE_RULE`). A save of these products will be rejected until the owner decides PRODUCT (keep stock) vs SERVICE (untrack). |
| ASSEMBLED / kit products                      |                      1 | `PRD-2026-000008` (MANUFACTURED → ASSEMBLED) with 1 legacy component → 1 DRAFT recipe v1. Decide: ASSEMBLED (stocked, build via assembly) or KIT (sold from components); then activate.               |
| Stock with no cost                            | 164 (43 company-owned) | Company items have on-hand but `current_cost` NULL → valued at 0 in the sub-ledger, and an invoice is refused until a cost exists. Needs a cost or opening value per item.                            |
| Duplicate barcodes                            |                      0 | Unique index will be created.                                                                                                                                                                         |
| Investment-eligible items the new rule blocks |                      0 | (Grandfathered anyway — existing links are never changed.)                                                                                                                                            |
| Agent stock in company journals               |                      0 | —                                                                                                                                                                                                     |

## 5. Material historical corrections for review (deliberately NOT changed)

Each needs an explicit owner decision; R13 only reports them (I6 metrics, dry run).

1. **Valuation ↔ GL difference 21 911.20** (sub-ledger 396 820.56 vs INV 374 909.36, identical before and after the
   migration). Known contributors computed from the data:
   - opening-balance movements valued 20 231.00 with **no** opening entry on the inventory account (0.00) — the Opening
     Balance wizard owns the GL side and was not used for these quantities;
   - 1 historical stock gain/loss movement never posted (5 177.48) — pre-R13 damage/expired/count/adjustment;
   - 159 document movements (mostly legacy STORE_ORDER deliveries before the M1 fix) with no journal for their document
     (−225.87 net);
   - rounding bound 0.55. Remainder after known causes: −3 271.41 (to analyse with the accountant).
     Options: post a reviewed opening / correction entry through the Posting Engine, or accept as pre-go-live history.
2. **Unposted historical damage / expired / count movements** — posting is forward-only since R13 (F11); history is not
   back-posted.
3. **Unclassified items and rule-violating agent items** (§4) — classification is an owner choice, never guessed.
4. **Legacy un-keyed duplicate movements** — I3 lists them as WARN (none locally); never auto-corrected.
5. **Stock without cost** (43 company items) — needs a cost decision before those items are invoiced.
6. **`product_components` table / `Product.type` column** — kept; dropping them is destructive (O3).

## 6. Backup

Local (before any migration test):

```bash
docker exec oms-postgres pg_dump -U oms -d oms_r7_final -Fc -f /tmp/oms_r7_final_pre_r13.dump
docker cp oms-postgres:/tmp/oms_r7_final_pre_r13.dump ./backups/
# restore: createdb + pg_restore -d <new db> /tmp/oms_r7_final_pre_r13.dump
```

Production (owner action, before the deploy that carries the R13 migration): take a Supabase **point-in-time backup /
manual backup** from the Supabase dashboard (Database → Backups) **and** a logical dump with the owner's credentials
(`pg_dump -Fc "$PROD_DATABASE_URL" > oms_prod_pre_r13.dump`). The agent never runs either against production.

## 7. Rollback

The migration is additive. Before any R13 data exists (no assembly orders, no kit sales, no activated recipes), the
schema can be rolled back with:

```sql
BEGIN;
DROP TABLE IF EXISTS assembly_order_lines, assembly_orders, product_recipe_lines, product_recipes;
DROP INDEX IF EXISTS products_barcode_unique_active;
DROP INDEX IF EXISTS inventory_movements_idempotency_key_key;
ALTER TABLE inventory_movements DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS parent_product_id,
  DROP COLUMN IF EXISTS recipe_id;
ALTER TABLE sales_invoice_items DROP COLUMN IF EXISTS fulfillment_snapshot;
ALTER TABLE landed_cost_allocations DROP COLUMN IF EXISTS capitalized_amount, DROP COLUMN IF EXISTS cogs_variance_amount;
ALTER TABLE landed_cost_documents DROP COLUMN IF EXISTS exchange_rate;
ALTER TABLE posting_settings DROP COLUMN IF EXISTS assembly_cost_account_id;
ALTER TABLE product_categories DROP COLUMN IF EXISTS default_unit_id, DROP COLUMN IF EXISTS default_tax_id;
ALTER TABLE products DROP COLUMN IF EXISTS supply_method;
DROP TYPE IF EXISTS "AssemblyStatus", "RecipeStatus", "ProductSupplyMethod";
DELETE FROM number_series WHERE document_type = 'ASSEMBLY';
DELETE FROM _prisma_migrations WHERE migration_name = '20261006090000_r13_product_inventory_costing';
COMMIT;
```

The widened cost columns stay `Decimal(14,4)` (lossless; narrowing back to 2 dp would round 4-dp averages written after
R13 and is not recommended). Once R13 documents exist (assemblies, kit sales, keyed movements), rollback is a **forward
fix** (application revert keeping the schema), never a drop — dropping would orphan movements and journals. Code rollback
= redeploy the previous commit; the additive schema is compatible with it.
