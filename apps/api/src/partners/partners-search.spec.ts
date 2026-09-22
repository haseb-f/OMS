import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { PartnersModule } from './partners.module';
import { PartnersService } from './partners.service';

/** Partner search is Arabic-normalized (common/text/arabic-search): alef/taa-marbuta/yaa variants and tashkeel never hide a Partner. Real local Postgres. */
describe('PartnersService — Arabic-normalized search', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PartnersService;
  const tag = randomUUID().slice(0, 8);
  let partnerId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        PhoneModule,
        PartnersModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(PartnersService);
    const partner = await prisma.partner.create({
      data: {
        partnerNumber: `PT-TEST-${tag}`,
        name: `احمد محمد صالح ${tag}`,
      },
    });
    partnerId = partner.id;
  });

  afterAll(async () => {
    await prisma.partner.deleteMany({ where: { id: partnerId } });
    await moduleRef.close();
  });

  it.each(['احمد محمد صالح', 'أحمد محمد صالح', 'إحمد مُحَمَّد صالح'])(
    'finds the stored "احمد محمد صالح" when searching "%s"',
    async (text) => {
      const { items } = await service.findAll({
        search: `${text} ${tag}`,
        pageSize: 50,
      });
      expect(items.map((p) => p.id)).toContain(partnerId);
    },
  );
});
