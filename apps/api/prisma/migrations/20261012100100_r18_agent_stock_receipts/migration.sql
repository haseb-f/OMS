-- R18 B (specs/round18-corrections/README.md §B) — agent-owned consignment
-- stock without purchase cost.
--
--   * InventoryMovementType gains CONSIGNMENT_RECEIPT: a later custody receipt
--     of agent goods (the opening stock keeps OPENING_BALANCE). Physical
--     quantity only — never valued, never posted.
--   * agent_stock_receipts / agent_stock_receipt_lines: the receipt document
--     (agent, warehouse, kind OPENING | RECEIPT, business day, the agent's own
--     reference, notes) and its lines, each linked 1:1 to the inventory
--     movement it posted. Append-only (no updated_at / deleted_at).
--   * number_series row AGENT_STOCK_RECEIPT ("ASR-2026-00001").
--
-- Additive and idempotent: every DDL is guarded; nothing existing changes.
-- Reverse (manual): DROP the two tables, the AgentStockReceiptKind type and
-- the number_series row. The enum value cannot be removed in place (no row
-- carries it unless a receipt was posted).

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'CONSIGNMENT_RECEIPT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentStockReceiptKind') THEN
    CREATE TYPE "AgentStockReceiptKind" AS ENUM ('OPENING', 'RECEIPT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "agent_stock_receipts" (
    "id" UUID NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "kind" "AgentStockReceiptKind" NOT NULL,
    "receipt_date" DATE NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "agent_stock_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_stock_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "movement_id" UUID NOT NULL,

    CONSTRAINT "agent_stock_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_stock_receipts_receipt_number_key"
  ON "agent_stock_receipts"("receipt_number");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_stock_receipts_idempotency_key_key"
  ON "agent_stock_receipts"("idempotency_key");
CREATE INDEX IF NOT EXISTS "agent_stock_receipts_agent_id_receipt_date_idx"
  ON "agent_stock_receipts"("agent_id", "receipt_date");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_stock_receipt_lines_movement_id_key"
  ON "agent_stock_receipt_lines"("movement_id");
CREATE INDEX IF NOT EXISTS "agent_stock_receipt_lines_receipt_id_idx"
  ON "agent_stock_receipt_lines"("receipt_id");
CREATE INDEX IF NOT EXISTS "agent_stock_receipt_lines_product_id_idx"
  ON "agent_stock_receipt_lines"("product_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipts_agent_id_fkey') THEN
    ALTER TABLE "agent_stock_receipts" ADD CONSTRAINT "agent_stock_receipts_agent_id_fkey"
      FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipts_warehouse_id_fkey') THEN
    ALTER TABLE "agent_stock_receipts" ADD CONSTRAINT "agent_stock_receipts_warehouse_id_fkey"
      FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipts_created_by_fkey') THEN
    ALTER TABLE "agent_stock_receipts" ADD CONSTRAINT "agent_stock_receipts_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipt_lines_receipt_id_fkey') THEN
    ALTER TABLE "agent_stock_receipt_lines" ADD CONSTRAINT "agent_stock_receipt_lines_receipt_id_fkey"
      FOREIGN KEY ("receipt_id") REFERENCES "agent_stock_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipt_lines_product_id_fkey') THEN
    ALTER TABLE "agent_stock_receipt_lines" ADD CONSTRAINT "agent_stock_receipt_lines_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_stock_receipt_lines_movement_id_fkey') THEN
    ALTER TABLE "agent_stock_receipt_lines" ADD CONSTRAINT "agent_stock_receipt_lines_movement_id_fkey"
      FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Document numbers through the shared Numbering Engine (never user-typed).
INSERT INTO "number_series" (
  "id", "document_type", "label", "doc_code", "template",
  "next_number", "padding", "separator",
  "year_reset", "month_reset", "day_reset", "active",
  "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'AGENT_STOCK_RECEIPT', 'Agent Stock Receipt', 'ASR', '{DOC}-{YEAR}-{SEQ}', 1, 5, '-', true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("document_type") DO NOTHING;
