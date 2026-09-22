import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { CountriesModule } from './countries.module';
import { CountriesService } from './countries.service';
import {
  normalizeArabicSearch,
  normalizedArabicColumnSql,
} from '../common/text/arabic-search';

/** The structured body of a rejected BadRequestException (typed, no asymmetric `any` matchers). */
async function rejectionBody(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  const error = await promise.then(
    () => {
      throw new Error('Expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse() as {
    code: string;
    message: string;
  };
}

/**
 * Countries — ISO code validation, archived-duplicate protection, referenced
 * archive blocking and multi-field/Arabic-normalized search. Runs against the
 * real local Postgres (same pattern as the other integration specs); the
 * search cases read the seeded canonical Saudi Arabia row, the write cases
 * use a throwaway country on a free two-letter code.
 */
describe('CountriesService', () => {
  let moduleRef: TestingModule;
  let service: CountriesService;
  let prisma: PrismaService;
  let testCode: string;
  let spareCode: string;
  const testName = `دولة اختبار ${Date.now()}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        CountriesModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(CountriesService);
    prisma = moduleRef.get(PrismaService);

    const used = new Set(
      (await prisma.country.findMany({ select: { code: true } })).map(
        (c) => c.code,
      ),
    );
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    [testCode, spareCode] = ['Q', 'X', 'Z']
      .flatMap((first) => [...letters].map((second) => first + second))
      .filter((code) => !used.has(code));
  });

  afterAll(async () => {
    const rows = await prisma.country.findMany({
      where: { name: testName },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    await prisma.city.deleteMany({ where: { countryId: { in: ids } } });
    await prisma.masterDataActivityLog.deleteMany({
      where: { entityId: { in: ids } },
    });
    await prisma.country.deleteMany({ where: { id: { in: ids } } });
    await moduleRef.close();
  });

  describe('code validation', () => {
    it.each(['ٍِSA', 'S', 'SAU', 'S1', 'سع'])(
      'rejects "%s" with a clear 400',
      async (code) => {
        const body = await rejectionBody(
          service.create({ code, name: `${testName} invalid` }),
        );
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.message).toContain('ISO 3166-1');
      },
    );

    it('rejects an invalid code on update as well', async () => {
      const sa = await prisma.country.findFirstOrThrow({
        where: { code: 'SA' },
      });
      await expect(service.update(sa.id, { code: 'ٍِSA' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('archive / duplicate / restore lifecycle', () => {
    it('trims + upper-cases the code, blocks archiving while referenced, and forces restore instead of re-creating', async () => {
      const created = await service.create({
        code: ` ${testCode.toLowerCase()} `,
        name: testName,
      });
      expect(created.code).toBe(testCode);

      const city = await prisma.city.create({
        data: { code: 'T1', name: `${testName} city`, countryId: created.id },
      });
      expect((await rejectionBody(service.archive(created.id))).code).toBe(
        'DEPENDENCY_ERROR',
      );
      await prisma.city.delete({ where: { id: city.id } });

      await service.archive(created.id);

      // Same code, and separately the same name, both hit the ARCHIVED row.
      for (const dto of [
        { code: testCode, name: `${testName} other` },
        { code: spareCode, name: testName },
      ]) {
        const body = await rejectionBody(service.create(dto));
        expect(body.code).toBe('DUPLICATE');
        expect(body.message).toContain('مؤرشفة');
      }

      const restored = await service.restore(created.id);
      expect(restored.deletedAt).toBeNull();
    });
  });

  describe('search', () => {
    it.each([
      'Saudi',
      'Saudi Arabia',
      'السعودية',
      'سعودية',
      'السعوديه',
      'SA',
      'SAU',
      '+966',
      '966',
    ])('finds Saudi Arabia by "%s"', async (search) => {
      const { items } = await service.findAll({ search, pageSize: 1000 });
      expect(items.map((c) => c.code)).toContain('SA');
    });

    it('SQL column normalization matches the JS helper', async () => {
      const samples = [
        'أحمد',
        'إبراهيم',
        'السعودية',
        'مصطفى',
        'مُحَمَّد',
        'مـحـمـد',
      ];
      for (const sample of samples) {
        const [row] = await prisma.$queryRaw<{ v: string }[]>(
          Prisma.sql`SELECT ${normalizedArabicColumnSql(`'${sample}'`)} AS v`,
        );
        expect(row.v).toBe(normalizeArabicSearch(sample));
      }
    });
  });
});
