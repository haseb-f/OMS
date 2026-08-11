-- DropIndex
DROP INDEX "product_categories_name_key";

-- CreateIndex
-- Partial unique index: uniqueness is enforced only among active
-- (non-archived) rows, so archiving a category frees its name up for reuse.
-- Not expressible in schema.prisma's DSL (no `WHERE` clause on @@unique),
-- hence the raw SQL.
CREATE UNIQUE INDEX "product_categories_name_active_key" ON "product_categories"("name") WHERE "deleted_at" IS NULL;
