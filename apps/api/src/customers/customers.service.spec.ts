import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneModule } from '../common/phone/phone.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from './customers.module';
import { CustomersService } from './customers.service';

/**
 * Existing-data compatibility (Canonical Phone Normalization spec, section
 * 3) — `findByNormalizedPhones` must match a normalized target phone
 * against Customer rows whose stored `phone`/`mobile` is in a raw/mixed
 * format, never assuming the database already holds clean E.164. Never
 * merges, never rewrites — read-only lookup.
 */
describe('CustomersService — findByNormalizedPhones', () => {
  let moduleRef: TestingModule;
  let service: CustomersService;
  let prisma: PrismaService;
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        CustomersModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(CustomersService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (createdCustomerIds.length) {
      await prisma.customer.deleteMany({
        where: { id: { in: createdCustomerIds } },
      });
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  /** A fresh random Saudi national number per test — collision-proof against any other fixture in the shared dev database. */
  function randomSaudiNational(): string {
    return String(500000000 + Math.floor(Math.random() * 99999999));
  }

  async function createRawCustomer(
    rawPhone: string,
    mobile: string | null = null,
  ) {
    const customer = await prisma.customer.create({
      data: {
        name: `Phone Match Test ${randomUUID().slice(0, 8)}`,
        customerNumber: `TEST-${randomUUID().slice(0, 8)}`,
        phone: rawPhone,
        mobile,
      },
    });
    createdCustomerIds.push(customer.id);
    return customer;
  }

  it('matches a customer whose stored phone uses the "00" international prefix instead of "+"', async () => {
    const national = randomSaudiNational();
    const customer = await createRawCustomer(`00966${national}`);
    const result = await service.findByNormalizedPhones([`+966${national}`]);
    expect(result.get(`+966${national}`)?.id).toBe(customer.id);
  });

  it('matches via the mobile column when phone does not match, even stored as bare digits (no "+")', async () => {
    const national = randomSaudiNational();
    const customer = await createRawCustomer('00000000000', `966${national}`);
    const result = await service.findByNormalizedPhones([`+966${national}`]);
    expect(result.get(`+966${national}`)?.id).toBe(customer.id);
  });

  it('resolves several target phones in a single batched lookup', async () => {
    const saudiNational = randomSaudiNational();
    const egyptNational = String(
      1000000000 + Math.floor(Math.random() * 99999999),
    );
    const first = await createRawCustomer(`00966${saudiNational}`);
    const second = await createRawCustomer(`20${egyptNational}`);
    const unmatched = `+966${randomSaudiNational()}`;
    const result = await service.findByNormalizedPhones([
      `+966${saudiNational}`,
      `+20${egyptNational}`,
      unmatched,
    ]);
    expect(result.get(`+966${saudiNational}`)?.id).toBe(first.id);
    expect(result.get(`+20${egyptNational}`)?.id).toBe(second.id);
    expect(result.has(unmatched)).toBe(false);
  });

  it('returns an empty map without querying when given no phones', async () => {
    const result = await service.findByNormalizedPhones([]);
    expect(result.size).toBe(0);
  });

  it('never modifies the customer row it matches', async () => {
    const national = randomSaudiNational();
    const raw = `00966${national}`;
    const customer = await createRawCustomer(raw);
    await service.findByNormalizedPhones([`+966${national}`]);
    const reloaded = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(reloaded.phone).toBe(raw);
  });
});
