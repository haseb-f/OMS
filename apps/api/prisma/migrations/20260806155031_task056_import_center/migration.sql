-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('DRAFT', 'UPLOADING', 'MAPPING', 'VALIDATING', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "import_type" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'DRAFT',
    "file_name" TEXT NOT NULL,
    "file_content" TEXT NOT NULL,
    "column_mapping" JSONB,
    "source_connector" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_errors" (
    "id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "column_name" TEXT,
    "error_message" TEXT NOT NULL,
    "suggested_fix" TEXT,
    "raw_row_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_job_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_mapping_templates" (
    "id" UUID NOT NULL,
    "import_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "column_mapping" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "import_mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_templates_import_type_name_key" ON "import_mapping_templates"("import_type", "name");

-- AddForeignKey
ALTER TABLE "import_job_errors" ADD CONSTRAINT "import_job_errors_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
