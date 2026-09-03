import 'dotenv/config';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { verifyPassword } from '../auth/password.util';

/**
 * End-to-end user create / hash / login / edit / reset against the real
 * local database — the login path must succeed with the same plaintext that
 * was submitted or generated, never a frontend-only simulation.
 */
describe('Users + Auth password flow', () => {
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
        'Users + Auth live flow skipped: Postgres is not reachable in this environment.',
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

  function storeCreated(id: string) {
    createdUserIds.push(id);
  }

  async function testDepartmentId() {
    const existing = await prisma.department.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (
      await prisma.department.create({
        data: {
          code: `DEPT-TEST-${suffix()}`,
          name: 'Test Department',
          isActive: true,
        },
      })
    ).id;
  }

  async function createUser(
    dto: Omit<Parameters<UsersService['create']>[0], 'departmentId'> & {
      departmentId?: string;
    },
  ) {
    return users.create({
      ...dto,
      departmentId: dto.departmentId ?? (await testDepartmentId()),
    });
  }

  liveIt(
    'creates a user with a typed password, hashes it, and logs in',
    async () => {
      const tag = suffix();
      const email = `auth-flow-manual-${tag}@example.com`;
      const password = 'ManualPass1!';
      const created = await createUser({
        email: `  ${email.toUpperCase()}  `,
        username: `  manual_${tag}  `,
        fullName: 'Manual Password User',
        password,
      });
      storeCreated(created.id);
      expect(created.email).toBe(email);
      expect('temporaryPassword' in created).toBe(false);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        select: { passwordHash: true },
      });
      expect(stored.passwordHash).not.toBe(password);
      expect(stored.passwordHash.startsWith('$2')).toBe(true);
      expect(await verifyPassword(password, stored.passwordHash)).toBe(true);

      const login = await auth.login({
        email: email.toUpperCase(),
        password,
      });
      expect(login.accessToken).toBeTruthy();
      expect(login.user.email).toBe(email);
    },
  );

  liveIt(
    'creates a user with a generated password, returns it once, and logs in',
    async () => {
      const tag = suffix();
      const created = await createUser({
        email: `auth-flow-generated-${tag}@example.com`,
        username: `generated_${tag}`,
        fullName: 'Generated Password User',
        generatePassword: true,
      });
      storeCreated(created.id);
      expect('temporaryPassword' in created).toBe(true);
      if (!('temporaryPassword' in created)) return;
      expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(8);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: created.id },
        select: { passwordHash: true, mustChangePassword: true },
      });
      expect(stored.passwordHash).not.toBe(created.temporaryPassword);
      expect(
        await verifyPassword(created.temporaryPassword, stored.passwordHash),
      ).toBe(true);
      expect(stored.mustChangePassword).toBe(true);

      const login = await auth.login({
        email: created.email,
        password: created.temporaryPassword,
      });
      expect(login.accessToken).toBeTruthy();
    },
  );

  liveIt(
    'resets a password, allows the new password, and rejects the old one',
    async () => {
      const tag = suffix();
      const oldPassword = 'OldPassw0rd!';
      const created = await createUser({
        email: `auth-flow-reset-${tag}@example.com`,
        username: `reset_${tag}`,
        fullName: 'Reset Password User',
        password: oldPassword,
      });
      storeCreated(created.id);

      const reset = await users.resetPassword(created.id, {});
      expect(reset.temporaryPassword).toBeTruthy();
      expect(reset.temporaryPassword).not.toBe(oldPassword);

      await expect(
        auth.login({ email: created.email, password: oldPassword }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const login = await auth.login({
        email: created.email,
        password: reset.temporaryPassword,
      });
      expect(login.accessToken).toBeTruthy();
    },
  );

  liveIt('rejects a wrong password', async () => {
    const tag = suffix();
    const created = await createUser({
      email: `auth-flow-wrong-${tag}@example.com`,
      username: `wrong_${tag}`,
      fullName: 'Wrong Password User',
      password: 'CorrectPass1!',
    });
    storeCreated(created.id);

    await expect(
      auth.login({ email: created.email, password: 'NotThePassword1!' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  liveIt(
    'edits name/email and persists the change without disabling the user',
    async () => {
      const tag = suffix();
      const created = await createUser({
        email: `auth-flow-edit-${tag}@example.com`,
        username: `edit_${tag}`,
        fullName: 'Before Edit',
        password: 'EditPassw0rd!',
        isActive: true,
      });
      storeCreated(created.id);

      const updated = await users.update(created.id, {
        fullName: 'After Edit',
        email: `Auth-Flow-Edit-New-${tag}@Example.COM`,
      });
      expect(updated.fullName).toBe('After Edit');
      expect(updated.email).toBe(`auth-flow-edit-new-${tag}@example.com`);
      expect(updated.isActive).toBe(true);

      const reloaded = await users.findOne(created.id);
      expect(reloaded.fullName).toBe('After Edit');
      expect(reloaded.email).toBe(`auth-flow-edit-new-${tag}@example.com`);
      expect(reloaded.isActive).toBe(true);
    },
  );

  liveIt(
    'rejects login for a disabled user after the password is verified',
    async () => {
      const tag = suffix();
      const password = 'DisabledPass1!';
      const created = await createUser({
        email: `auth-flow-disabled-${tag}@example.com`,
        username: `disabled_${tag}`,
        fullName: 'Disabled User',
        password,
        isActive: false,
      });
      storeCreated(created.id);

      await expect(
        auth.login({ email: created.email, password }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  liveIt(
    'rejects a duplicate email with a structured DUPLICATE error',
    async () => {
      const tag = suffix();
      const email = `auth-flow-dup-${tag}@example.com`;
      const first = await createUser({
        email,
        username: `dup_a_${tag}`,
        fullName: 'Duplicate A',
        password: 'DupPassw0rd!',
      });
      storeCreated(first.id);

      const duplicate = await users
        .create({
          email: email.toUpperCase(),
          username: `dup_b_${tag}`,
          fullName: 'Duplicate B',
          password: 'DupPassw0rd!',
          departmentId: await testDepartmentId(),
        })
        .catch((error: unknown) => error);
      expect(duplicate).toBeInstanceOf(BadRequestException);
      expect((duplicate as BadRequestException).getResponse()).toMatchObject({
        code: 'DUPLICATE',
        fields: [{ field: 'email' }],
      });
    },
  );

  liveIt('still authenticates an existing seed user when present', async () => {
    const seed = await prisma.user.findFirst({
      where: { deletedAt: null, isActive: true, isLocked: false },
      orderBy: { createdAt: 'asc' },
    });
    if (!seed) return;
    const matches = await verifyPassword('Passw0rd!', seed.passwordHash);
    if (!matches) return;
    const login = await auth.login({
      email: seed.email,
      password: 'Passw0rd!',
    });
    expect(login.accessToken).toBeTruthy();
  });
});
