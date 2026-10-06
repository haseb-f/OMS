-- R13 B2: optional idempotency key on financial transactions (expense
-- vouchers, receipts, supplier payments). Nullable — existing rows keep NULL;
-- a unique index ignores NULLs in PostgreSQL.
ALTER TABLE "financial_transactions" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "financial_transactions_idempotency_key_key" ON "financial_transactions"("idempotency_key");
