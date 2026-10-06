-- R13 follow-up — drop the deprecated legacy Kit BOM table (owner approval, 2026-10-06, spec decision O3).
--
-- `product_components` was superseded by the versioned `product_recipes` / `product_recipe_lines` (the one canonical
-- component relationship). Migration 20261006090000_r13_product_inventory_costing copied every row into a DRAFT recipe
-- v1 and nothing has read the table since. Production held no legacy component rows (R13 Production survey).
--
-- Timestamped after the parallel R13 accounting & reporting migrations so the history stays in order on every database.
-- This is the only destructive change of R13; `products.type` (derived legacy column) is kept.
DROP TABLE IF EXISTS "product_components";
