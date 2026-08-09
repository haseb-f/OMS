-- CreateTable
CREATE TABLE "analytic_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "analytic_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytic_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "analytic_plan_id" UUID NOT NULL,
    "parent_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "analytic_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytic_distribution_lines" (
    "id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "analytic_plan_id" UUID NOT NULL,
    "analytic_account_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "analytic_distribution_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "doc_code" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT '{DOC}-{YEAR}-{SEQ}',
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "separator" TEXT NOT NULL DEFAULT '-',
    "year_reset" BOOLEAN NOT NULL DEFAULT true,
    "month_reset" BOOLEAN NOT NULL DEFAULT false,
    "day_reset" BOOLEAN NOT NULL DEFAULT false,
    "last_reset_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytic_plans_code_key" ON "analytic_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "analytic_accounts_code_key" ON "analytic_accounts"("code");

-- CreateIndex
CREATE INDEX "analytic_distribution_lines_document_type_document_id_idx" ON "analytic_distribution_lines"("document_type", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytic_distribution_lines_document_type_document_id_analy_key" ON "analytic_distribution_lines"("document_type", "document_id", "analytic_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_document_type_key" ON "number_series"("document_type");

-- AddForeignKey
ALTER TABLE "analytic_accounts" ADD CONSTRAINT "analytic_accounts_analytic_plan_id_fkey" FOREIGN KEY ("analytic_plan_id") REFERENCES "analytic_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytic_accounts" ADD CONSTRAINT "analytic_accounts_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "analytic_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytic_distribution_lines" ADD CONSTRAINT "analytic_distribution_lines_analytic_plan_id_fkey" FOREIGN KEY ("analytic_plan_id") REFERENCES "analytic_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytic_distribution_lines" ADD CONSTRAINT "analytic_distribution_lines_analytic_account_id_fkey" FOREIGN KEY ("analytic_account_id") REFERENCES "analytic_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
