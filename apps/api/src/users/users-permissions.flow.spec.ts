import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';

describe('Users + Auth permission payload', () => {
  let moduleRef: TestingModule;
  let users: UsersService;
  let auth: AuthService;
  let prisma: PrismaService;
  let dbUnreachable = false;
  const createdUserIds: string[] = [];

  const suffix = () => randomUUID().slice(0, 8);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        UsersModule,
      ],
    }).compile();
    await moduleRef.init();
    users = moduleRef.get(UsersService);
    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUnreachable = true;
      console.warn(
        'Users + Auth permission payload skipped: Postgres is not reachable.',
      );
    }
  });

  afterAll(async () => {
    if (!prisma || dbUnreachable) {
      if (moduleRef) await moduleRef.close();
      return;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    if (moduleRef) await moduleRef.close();
  });

  function liveIt(name: string, fn: () => Promise<void>) {
    it(name, async () => {
      if (dbUnreachable) return;
      await fn();
    });
  }

  liveIt(
    'returns store-orders.view and implied sales.view from /auth/me after a matrix grant',
    async () => {
      const tag = suffix();
      const created = await users.create({
        email: `perm-flow-${tag}@example.com`,
        username: `perm_flow_${tag}`,
        fullName: 'Permission Flow User',
        password: 'PermPassw0rd!',
      });
      createdUserIds.push(created.id);

      const saved = await users.setPermissions(created.id, {
        permissionNames: ['store-orders.view'],
      });
      expect(saved.granted).toEqual(
        expect.arrayContaining(['store-orders.view', 'sales.view']),
      );

      const me = await auth.getCurrentUser(created.id);
      expect(me.permissions).toEqual(
        expect.arrayContaining(['store-orders.view', 'sales.view']),
      );
      expect(me.permissions).not.toContain('store-orders.edit');
    },
  );

  liveIt(
    'applies a later permission change on the next session payload',
    async () => {
      const tag = suffix();
      const created = await users.create({
        email: `perm-change-${tag}@example.com`,
        username: `perm_change_${tag}`,
        fullName: 'Permission Change User',
        password: 'PermPassw0rd!',
      });
      createdUserIds.push(created.id);

      await users.setPermissions(created.id, {
        permissionNames: ['store-orders.view'],
      });
      const first = await auth.getCurrentUser(created.id);
      expect(first.permissions).toContain('store-orders.view');
      expect(first.permissions).not.toContain('partners.view');

      await users.setPermissions(created.id, {
        permissionNames: ['store-orders.view', 'partners.view'],
      });
      const second = await auth.getCurrentUser(created.id);
      expect(second.permissions).toEqual(
        expect.arrayContaining(['store-orders.view', 'partners.view']),
      );
    },
  );

  liveIt(
    'returns an empty grant list for a user with zero module permissions',
    async () => {
      const tag = suffix();
      const created = await users.create({
        email: `perm-empty-${tag}@example.com`,
        username: `perm_empty_${tag}`,
        fullName: 'Empty Permission User',
        password: 'PermPassw0rd!',
      });
      createdUserIds.push(created.id);

      const me = await auth.getCurrentUser(created.id);
      expect(me.permissions).toEqual([]);
      expect(me.isSuperAdmin).toBe(false);
    },
  );
});
