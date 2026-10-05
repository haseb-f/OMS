-- R13 — Product, Inventory & Costing restructure (spec: specs/product-inventory-costing/spec.md, migration.md).
--
-- ADDITIVE and NON-DESTRUCTIVE: no row is deleted or rewritten except the explicit backfills at the end (supply_method,
-- recipes copied as DRAFT). Cost columns are widened Decimal(12,2) -> Decimal(14,4): every existing value is preserved
-- exactly. The deprecated `product_components` table is left in place (dropping it needs explicit owner approval, spec O3).
--
-- Rollback (before any R13 data exists): drop the new tables/columns/indexes below; widened columns may stay (lossless).

-- CreateEnum
CREATE TYPE "ProductSupplyMethod" AS ENUM ('PURCHASED', 'ASSEMBLED', 'KIT');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('POSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "parent_product_id" UUID,
ADD COLUMN     "recipe_id" UUID,
ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "landed_cost_allocations" ADD COLUMN     "capitalized_amount" DECIMAL(12,2),
ADD COLUMN     "cogs_variance_amount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "landed_cost_documents" ADD COLUMN     "exchange_rate" DECIMAL(18,8);

-- AlterTable
ALTER TABLE "posting_settings" ADD COLUMN     "assembly_cost_account_id" UUID;

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN     "default_tax_id" UUID,
ADD COLUMN     "default_unit_id" UUID;

-- AlterTable
ALTER TABLE "product_cost_histories" ALTER COLUMN "previous_cost" SET DATA TYPE DECIMAL(14,4),
ALTER COLUMN "new_cost" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "product_cost_snapshots" ALTER COLUMN "cost" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "supply_method" "ProductSupplyMethod" NOT NULL DEFAULT 'PURCHASED',
ALTER COLUMN "current_cost" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "fulfillment_snapshot" JSONB,
ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(14,4);

-- CreateTable
CREATE TABLE "product_recipes" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3),
    "output_quantity" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "direct_cost_estimate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "activated_at" TIMESTAMP(3),
    "activated_by" UUID,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_lines" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_orders" (
    "id" UUID NOT NULL,
    "assembly_number" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "recipe_version" INTEGER NOT NULL,
    "recipe_snapshot" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "owner_agent_id" UUID,
    "component_cost" DECIMAL(14,2) NOT NULL,
    "direct_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "output_movement_id" UUID,
    "idempotency_key" TEXT,
    "status" "AssemblyStatus" NOT NULL DEFAULT 'POSTED',
    "notes" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "assembly_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_order_lines" (
    "id" UUID NOT NULL,
    "assembly_order_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "consumption_movement_id" UUID,
    "reversal_movement_id" UUID,

    CONSTRAINT "assembly_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_recipes_product_id_status_idx" ON "product_recipes"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipes_product_id_version_key" ON "product_recipes"("product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_lines_recipe_id_component_product_id_key" ON "product_recipe_lines"("recipe_id", "component_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_orders_assembly_number_key" ON "assembly_orders"("assembly_number");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_orders_idempotency_key_key" ON "assembly_orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "assembly_orders_product_id_created_at_idx" ON "assembly_orders"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key" ON "inventory_movements"("idempotency_key");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_default_unit_id_fkey" FOREIGN KEY ("default_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_default_tax_id_fkey" FOREIGN KEY ("default_tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_orders" ADD CONSTRAINT "assembly_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_orders" ADD CONSTRAINT "assembly_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_order_lines" ADD CONSTRAINT "assembly_order_lines_assembly_order_id_fkey" FOREIGN KEY ("assembly_order_id") REFERENCES "assembly_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_order_lines" ADD CONSTRAINT "assembly_order_lines_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_settings" ADD CONSTRAINT "posting_settings_assembly_cost_account_id_fkey" FOREIGN KEY ("assembly_cost_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "exchange_rates_from_currency_id_to_currency_id_effective_date_k" RENAME TO "exchange_rates_from_currency_id_to_currency_id_effective_da_key";

-- RenameIndex
ALTER INDEX "fixed_asset_depreciation_periods_fixed_asset_id_period_start_ke" RENAME TO "fixed_asset_depreciation_periods_fixed_asset_id_period_star_key";

-- ---------------------------------------------------------------------------
-- Integrity constraints that Prisma's schema language cannot express
-- ---------------------------------------------------------------------------
-- At most one ACTIVE recipe per product.
CREATE UNIQUE INDEX "product_recipes_one_active_per_product" ON "product_recipes" ("product_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_output_quantity_positive" CHECK ("output_quantity" > 0);
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_direct_cost_non_negative" CHECK ("direct_cost_estimate" >= 0);
ALTER TABLE "product_recipe_lines" ADD CONSTRAINT "product_recipe_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "assembly_orders" ADD CONSTRAINT "assembly_orders_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "assembly_order_lines" ADD CONSTRAINT "assembly_order_lines_quantity_positive" CHECK ("quantity" > 0);

-- Barcode is unique among non-deleted products (case/space-insensitive). The index is created only when no duplicates
-- exist so a deploy can never fail on legacy data; the application check is always enforced, and the duplicates are
-- listed by scripts/acceptance/r13/migration-dry-run for owner review instead of being merged or rewritten.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "products"
    WHERE "barcode" IS NOT NULL AND btrim("barcode") <> '' AND "deleted_at" IS NULL
    GROUP BY lower(btrim("barcode")) HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'R13: duplicate product barcodes exist — unique barcode index NOT created; review with migration-dry-run';
  ELSE
    CREATE UNIQUE INDEX "products_barcode_unique_active" ON "products" (lower(btrim("barcode")))
      WHERE "barcode" IS NOT NULL AND btrim("barcode") <> '' AND "deleted_at" IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Backfills (deterministic, never guessed)
-- ---------------------------------------------------------------------------
-- MANUFACTURED products currently behave as ordinary stocked items (no explosion anywhere) — ASSEMBLED preserves that
-- behaviour exactly. KIT is never inferred: it is a deliberate choice made on the product.
UPDATE "products" SET "supply_method" = 'ASSEMBLED' WHERE "type" = 'MANUFACTURED';

-- Legacy ProductComponent rows -> DRAFT recipe v1 per kit (never auto-activated: activation validates ownership, cycles
-- and units and is an explicit, reviewed action). Component unit = the component product's own stock unit.
INSERT INTO "product_recipes" ("id", "product_id", "version", "status", "output_quantity", "direct_cost_estimate", "notes", "created_at", "updated_at")
SELECT gen_random_uuid(), pc."kit_product_id", 1, 'DRAFT', 1, 0,
       'Migrated from legacy product_components (R13) — review and activate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "product_components" pc
GROUP BY pc."kit_product_id";

INSERT INTO "product_recipe_lines" ("id", "recipe_id", "component_product_id", "quantity", "unit_id", "sort_order")
SELECT gen_random_uuid(), r."id", pc."component_product_id", pc."quantity", p."unit_id",
       (row_number() OVER (PARTITION BY pc."kit_product_id" ORDER BY pc."created_at"))::int
FROM "product_components" pc
JOIN "product_recipes" r ON r."product_id" = pc."kit_product_id" AND r."version" = 1
JOIN "products" p ON p."id" = pc."component_product_id"
WHERE pc."quantity" > 0;

-- Document numbers through the shared Numbering Engine (never user-typed)
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'ASSEMBLY', 'Assembly Order', 'ASM', '{DOC}-{YEAR}-{SEQ}', 1, 6, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
