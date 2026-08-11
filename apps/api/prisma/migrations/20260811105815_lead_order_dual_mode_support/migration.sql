-- AlterTable
ALTER TABLE "countries" ADD COLUMN     "calling_code" TEXT,
ADD COLUMN     "default_currency_id" UUID,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "iso3" CHAR(3),
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "numeric_code" CHAR(3);

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payment_sources" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "receiving_accounts" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_default_currency_id_fkey" FOREIGN KEY ("default_currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
