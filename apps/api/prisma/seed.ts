import 'dotenv/config';
import { PrismaClient, ShippingMethodType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const currencies = [
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SR' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
];

const countries = [
  { code: 'EG', name: 'Egypt' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'AE', name: 'United Arab Emirates' },
];

const shippingMethods = [
  { name: 'Internal Delivery', type: ShippingMethodType.INTERNAL_DELIVERY },
  { name: 'Shipping Company', type: ShippingMethodType.EXTERNAL_COMPANY },
];

const paymentSources = [
  { name: 'Bank Transfer' },
  { name: 'Wallet' },
  { name: 'InstaPay' },
  { name: 'Cash Deposit' },
  { name: 'Payment Gateway' },
  { name: 'Other' },
];

async function main() {
  await Promise.all(
    currencies.map((currency) =>
      prisma.currency.upsert({
        where: { code: currency.code },
        update: {},
        create: currency,
      }),
    ),
  );

  await Promise.all(
    countries.map((country) =>
      prisma.country.upsert({
        where: { code: country.code },
        update: {},
        create: country,
      }),
    ),
  );

  await Promise.all(
    shippingMethods.map((method) =>
      prisma.shippingMethod.upsert({
        where: { name: method.name },
        update: {},
        create: method,
      }),
    ),
  );

  await Promise.all(
    paymentSources.map((source) =>
      prisma.paymentSource.upsert({
        where: { name: source.name },
        update: {},
        create: source,
      }),
    ),
  );

  // Payment Methods (the older, generic reference-data entity): no specific methods
  // were specified for this task — which ones a business accepts is a business
  // decision, not an architectural one, so none are seeded here. The entity and its
  // CRUD endpoints exist and are ready.
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
