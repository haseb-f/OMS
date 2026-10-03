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

/**
 * R6 B5 — "select the first N" on a Master Data list (`GET /partners/ids?limit=`)
 * returns exactly the first N rows of the list in its CURRENT sort, with an
 * id tie-break so rows sharing the sort value are always in the same order.
 * Real local Postgres.
 */
describe('Master Data ids — deterministic first N (partners)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: PartnersService;
  const tag = `DEMO-R6-20261001-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];

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
    // Five partners with the SAME name — every row ties on the sort field.
    for (let i = 0; i < 5; i += 1) {
      const partner = await prisma.partner.create({
        data: { partnerNumber: `${tag}-${i}`, name: tag },
      });
      ids.push(partner.id);
    }
  });

  afterAll(async () => {
    await prisma.partner.deleteMany({ where: { id: { in: ids } } });
    await moduleRef.close();
  });

  it('breaks ties on the sort field by id, in the list and in /ids alike', async () => {
    const { items } = await service.findAll({
      search: tag,
      sortBy: 'name',
      sortOrder: 'asc',
      pageSize: 50,
    });
    const listed = items.map((partner) => partner.id);
    expect(new Set(listed)).toEqual(new Set(ids));
    // Same query, same order — every time.
    const again = await service.findAll({
      search: tag,
      sortBy: 'name',
      sortOrder: 'asc',
      pageSize: 50,
    });
    expect(again.items.map((partner) => partner.id)).toEqual(listed);

    const all = await service.findAllIds({
      search: tag,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    expect(all.ids).toEqual(listed);
    expect(all.total).toBe(5);
  });

  it('`limit` selects the first N rows of the current sort, not an arbitrary subset', async () => {
    const descending = await service.findAll({
      search: tag,
      sortBy: 'partnerNumber',
      sortOrder: 'desc',
      pageSize: 50,
    });
    const firstThree = descending.items
      .slice(0, 3)
      .map((partner) => partner.id);

    const picked = await service.findAllIds({
      search: tag,
      sortBy: 'partnerNumber',
      sortOrder: 'desc',
      limit: 3,
    });
    expect(picked.ids).toEqual(firstThree);
    // `total` is still the full match count, so the UI can say "3 of 5".
    expect(picked.total).toBe(5);
  });

  it('offset pages never repeat or skip a tied row', async () => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const { items } = await service.findAll({
        search: tag,
        sortBy: 'name',
        sortOrder: 'desc',
        page,
        pageSize: 2,
      });
      seen.push(...items.map((partner) => partner.id));
    }
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });
});
