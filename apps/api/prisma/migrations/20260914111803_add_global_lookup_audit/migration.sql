-- CreateEnum
CREATE TYPE "GlobalLookupAction" AS ENUM ('GLOBAL_CUSTOMER_LOOKUP', 'GLOBAL_ORDER_LOOKUP');

-- CreateEnum
CREATE TYPE "GlobalLookupMethod" AS ENUM ('PHONE', 'ORDER_NUMBER');

-- CreateTable
CREATE TABLE "global_lookup_audits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "GlobalLookupAction" NOT NULL,
    "method" "GlobalLookupMethod" NOT NULL,
    "query_value" TEXT NOT NULL,
    "matched_partner_id" UUID,
    "matched_store_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_lookup_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "global_lookup_audits_user_id_created_at_idx" ON "global_lookup_audits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "global_lookup_audits_matched_partner_id_idx" ON "global_lookup_audits"("matched_partner_id");

-- CreateIndex
CREATE INDEX "global_lookup_audits_matched_store_order_id_idx" ON "global_lookup_audits"("matched_store_order_id");

-- AddForeignKey
ALTER TABLE "global_lookup_audits" ADD CONSTRAINT "global_lookup_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
