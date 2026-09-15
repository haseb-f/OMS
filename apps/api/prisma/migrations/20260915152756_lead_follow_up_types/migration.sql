-- AlterTable
ALTER TABLE "lead_follow_ups" ADD COLUMN     "follow_up_type_id" UUID;

-- CreateTable
CREATE TABLE "lead_follow_up_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lead_follow_up_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_follow_up_types_code_key" ON "lead_follow_up_types"("code");

-- CreateIndex
CREATE INDEX "lead_follow_up_types_deleted_at_is_active_sort_order_idx" ON "lead_follow_up_types"("deleted_at", "is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_follow_up_type_id_fkey" FOREIGN KEY ("follow_up_type_id") REFERENCES "lead_follow_up_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
