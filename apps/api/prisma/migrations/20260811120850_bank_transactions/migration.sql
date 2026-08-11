-- CreateEnum
CREATE TYPE "BankTransactionMatchStatus" AS ENUM ('UNMATCHED', 'POTENTIAL', 'MATCHED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL,
    "transaction_id" TEXT,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "value_date" TIMESTAMP(3),
    "account" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "debit" DECIMAL(12,2),
    "credit" DECIMAL(12,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_id" UUID,
    "balance" DECIMAL(12,2),
    "bank_name" TEXT,
    "branch" TEXT,
    "notes" TEXT,
    "fingerprint" TEXT NOT NULL,
    "match_status" "BankTransactionMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "match_candidates" JSONB,
    "matched_payment_id" UUID,
    "matched_at" TIMESTAMP(3),
    "matched_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_fingerprint_key" ON "bank_transactions"("fingerprint");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_payment_id_fkey" FOREIGN KEY ("matched_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_by_id_fkey" FOREIGN KEY ("matched_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
