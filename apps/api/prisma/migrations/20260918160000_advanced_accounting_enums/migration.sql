-- Prisma maps these columns as native Postgres enums. The previous
-- advanced-accounting migration created them as TEXT, so Production
-- inserts failed with 42704 (type "FixedAssetStatus" does not exist).

DO $$ BEGIN
  CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FixedAssetStatus" AS ENUM ('DRAFT', 'CAPITALIZED', 'DISPOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccountingScheduleStatus" AS ENUM ('PENDING', 'POSTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrepaidExpenseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccruedExpenseStatus" AS ENUM ('DRAFT', 'RECOGNIZED', 'SETTLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FxRevaluationStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fixed_assets'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "fixed_assets" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "fixed_assets"
      ALTER COLUMN "status" TYPE "FixedAssetStatus"
      USING "status"::"FixedAssetStatus";
    ALTER TABLE "fixed_assets"
      ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"FixedAssetStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fixed_assets'
      AND column_name = 'depreciation_method' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "fixed_assets" ALTER COLUMN "depreciation_method" DROP DEFAULT;
    ALTER TABLE "fixed_assets"
      ALTER COLUMN "depreciation_method" TYPE "DepreciationMethod"
      USING "depreciation_method"::"DepreciationMethod";
    ALTER TABLE "fixed_assets"
      ALTER COLUMN "depreciation_method" SET DEFAULT 'STRAIGHT_LINE'::"DepreciationMethod";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fixed_asset_depreciation_periods'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "fixed_asset_depreciation_periods" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "fixed_asset_depreciation_periods"
      ALTER COLUMN "status" TYPE "AccountingScheduleStatus"
      USING "status"::"AccountingScheduleStatus";
    ALTER TABLE "fixed_asset_depreciation_periods"
      ALTER COLUMN "status" SET DEFAULT 'PENDING'::"AccountingScheduleStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prepaid_expenses'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "prepaid_expenses" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "prepaid_expenses"
      ALTER COLUMN "status" TYPE "PrepaidExpenseStatus"
      USING "status"::"PrepaidExpenseStatus";
    ALTER TABLE "prepaid_expenses"
      ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"PrepaidExpenseStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prepaid_recognitions'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "prepaid_recognitions" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "prepaid_recognitions"
      ALTER COLUMN "status" TYPE "AccountingScheduleStatus"
      USING "status"::"AccountingScheduleStatus";
    ALTER TABLE "prepaid_recognitions"
      ALTER COLUMN "status" SET DEFAULT 'PENDING'::"AccountingScheduleStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accrued_expenses'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "accrued_expenses" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "accrued_expenses"
      ALTER COLUMN "status" TYPE "AccruedExpenseStatus"
      USING "status"::"AccruedExpenseStatus";
    ALTER TABLE "accrued_expenses"
      ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"AccruedExpenseStatus";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fx_revaluation_runs'
      AND column_name = 'status' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "fx_revaluation_runs" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "fx_revaluation_runs"
      ALTER COLUMN "status" TYPE "FxRevaluationStatus"
      USING "status"::"FxRevaluationStatus";
    ALTER TABLE "fx_revaluation_runs"
      ALTER COLUMN "status" SET DEFAULT 'POSTED'::"FxRevaluationStatus";
  END IF;
END $$;
