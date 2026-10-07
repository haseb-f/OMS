import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from './permissions-core.module';
import { PermissionsResolverService } from './permissions-resolver.service';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { JobTitlesModule } from '../job-titles/job-titles.module';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import { PERMISSION_AUDIT } from './permission-administration.service';

/**
 * R14 W2 (spec-2 §A) — job-title templates and individual overrides over the
 * real HTTP pipeline (JwtAuthGuard / PermissionsGuard / controllers) on the
 * local Postgres: live template application, impact preview, DENY beating
 * inherited + implied permissions, review flag, audit rows, and the
 * anti-escalation rules (403 PERMISSION_ESCALATION).
 */
interface ResponseBody {
  code?: string;
  reason?: string;
  permissions?: string[];
  holderCount?: number;
  added?: string[];
  users?: {
    userId: string;
    gained: string[];
    ineffective: { permission: string; reason: string }[];
  }[];
  inherited?: string[];
  denies?: string[];
  permissionsReviewRequired?: boolean;
}
const body = (res: { body: unknown }) => res.body as ResponseBody;

describe('R14 permission administration (HTTP)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessions: UserSessionsService;
  let resolver: PermissionsResolverService;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const titleIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function grant(
    userId: string,
    names: string[],
    effect: 'GRANT' | 'DENY' = 'GRANT',
  ) {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.create({
        data: { userId, permissionId: permission.id, effect },
      });
    }
    resolver.invalidate(userId);
  }

  async function makeTitle(key: string) {
    const title = await prisma.jobTitle.create({
      data: { code: `R14W2-${suffix}-${key}`, name: `R14 W2 ${key} ${suffix}` },
    });
    titleIds.push(title.id);
    ids[key] = title.id;
    return title.id;
  }

  async function makeUser(
    key: string,
    names: string[],
    extra: {
      jobTitleId?: string;
      isSuperAdmin?: boolean;
    } = {},
  ) {
    const user = await prisma.user.create({
      data: {
        email: `r14w2-${key}-${suffix}@example.test`,
        username: `r14w2-${key}-${suffix}`,
        fullName: `R14 W2 ${key} ${suffix}`,
        passwordHash: 'x',
        jobTitleId: extra.jobTitleId,
        isSuperAdmin: extra.isSuperAdmin ?? false,
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = await sessions.issueAccessToken({
      sub: user.id,
      email: user.email,
    });
    await grant(user.id, names);
    return user.id;
  }

  const templateOf = async (titleId: string) =>
    (
      await prisma.jobTitlePermission.findMany({
        where: { jobTitleId: titleId },
        select: { permission: { select: { name: true } } },
      })
    )
      .map((row) => row.permission.name)
      .sort();

  const overridesOf = async (userId: string) =>
    (
      await prisma.userPermission.findMany({
        where: { userId },
        select: { effect: true, permission: { select: { name: true } } },
      })
    )
      .map((row) => `${row.effect}:${row.permission.name}`)
      .sort();

  const auditOf = (entityId: string, type: string) =>
    prisma.masterDataActivityLog.findMany({
      where: { entityId, type },
      orderBy: { createdAt: 'desc' },
    });

  const effective = async (userId: string) => {
    resolver.invalidate(userId);
    return resolver.getPermissions(userId);
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        UsersModule,
        JobTitlesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            fields: formatValidationErrors(errors),
          }),
      }),
    );
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(UserSessionsService, { strict: false });
    resolver = moduleRef.get(PermissionsResolverService);

    await makeTitle('T1');
    await makeTitle('T2');
    await makeUser('admin', [
      'settings.manage',
      'users.manage_permissions',
      'job-titles.manage_permissions',
      'masterdata.job-titles.view',
      'products.view',
      'products.create',
      'products.edit',
    ]);
    await makeUser('settingsOnly', ['settings.manage']);
    await makeUser('super', [], { isSuperAdmin: true });
    await makeUser('target', [], { jobTitleId: ids.T1 });
    await makeUser('peer', [], { jobTitleId: ids.T1 });
    await grant(ids.peer, ['products.edit'], 'DENY');
  });

  afterAll(async () => {
    await prisma.masterDataActivityLog.deleteMany({
      where: { entityId: { in: [...userIds, ...titleIds] } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.jobTitlePermission.deleteMany({
      where: { jobTitleId: { in: titleIds } },
    });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titleIds } } });
    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('applies a saved template live to every holder and audits it', async () => {
    const res = await request(http)
      .put(`/job-titles/${ids.T1}/permissions`)
      .set(auth('admin'))
      .send({ permissionNames: ['products.create'] });
    expect(res.status).toBe(200);
    expect(body(res).permissions).toEqual(['products.create']);

    const targetSet = await effective(ids.target);
    expect(targetSet.has('products.create')).toBe(true);
    expect(targetSet.has('products.view')).toBe(true);

    const audit = await auditOf(ids.T1, PERMISSION_AUDIT.JOB_TITLE_PERMISSIONS);
    expect(audit[0]?.metadata).toMatchObject({
      added: ['products.create'],
      removed: [],
    });
    expect(audit[0]?.createdBy).toBe(ids.admin);

    const read = await request(http)
      .get(`/job-titles/${ids.T1}/permissions`)
      .set(auth('admin'));
    expect(read.status).toBe(200);
    expect(body(read).holderCount).toBe(2);
  });

  it('previews the impact per holder without writing anything', async () => {
    const res = await request(http)
      .post(`/job-titles/${ids.T1}/permissions/preview`)
      .set(auth('admin'))
      .send({ permissionNames: ['products.create', 'products.edit'] });
    expect(res.status).toBe(200);
    expect(body(res).added).toEqual(['products.edit']);
    const byUser = Object.fromEntries(
      (body(res).users ?? []).map((u) => [u.userId, u]),
    );
    expect(byUser[ids.target].gained).toEqual(['products.edit']);
    expect(byUser[ids.peer].gained).toEqual([]);
    expect(byUser[ids.peer].ineffective).toEqual([
      { permission: 'products.edit', reason: 'DENIED_INDIVIDUALLY' },
    ]);
    expect(await templateOf(ids.T1)).toEqual(['products.create']);
  });

  it('rejects a template addition the editor does not hold (403 PERMISSION_ESCALATION)', async () => {
    const res = await request(http)
      .put(`/job-titles/${ids.T1}/permissions`)
      .set(auth('admin'))
      .send({
        permissionNames: ['products.create', 'accounting.journal-entries.post'],
      });
    expect(res.status).toBe(403);
    expect(body(res).code).toBe('PERMISSION_ESCALATION');
    expect(await templateOf(ids.T1)).toEqual(['products.create']);
  });

  it('rejects an individual grant the editor does not hold, leaving rows unchanged', async () => {
    const before = await overridesOf(ids.target);
    const res = await request(http)
      .put(`/users/${ids.target}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: ['accounting.journal-entries.post'], denies: [] });
    expect(res.status).toBe(403);
    expect(body(res).code).toBe('PERMISSION_ESCALATION');
    expect(await overridesOf(ids.target)).toEqual(before);
  });

  it('rejects editing your own overrides (403 PERMISSION_ESCALATION)', async () => {
    const res = await request(http)
      .put(`/users/${ids.admin}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: ['products.view'], denies: [] });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PERMISSION_ESCALATION',
      reason: 'SELF_EDIT',
    });
  });

  it('a DENY saved in the panel beats the inherited grant and its implied permission; audited', async () => {
    const res = await request(http)
      .put(`/users/${ids.target}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: [], denies: ['products.create'] });
    expect(res.status).toBe(200);
    expect(body(res).inherited).toEqual(['products.create']);
    expect(body(res).denies).toEqual(['products.create']);

    const targetSet = await effective(ids.target);
    expect(targetSet.has('products.create')).toBe(false);
    expect(targetSet.has('products.view')).toBe(false);

    const audit = await auditOf(ids.target, PERMISSION_AUDIT.USER_PERMISSIONS);
    expect(audit[0]?.metadata).toMatchObject({
      granted: [],
      denied: ['products.create'],
      removed: [],
    });
  });

  it('removing a DENY that would re-enable a permission the editor lacks is an escalation', async () => {
    const superSave = await request(http)
      .put(`/job-titles/${ids.T1}/permissions`)
      .set(auth('super'))
      .send({ permissionNames: ['products.create', 'reports.sales.view'] });
    expect(superSave.status).toBe(200);
    const deny = await request(http)
      .put(`/users/${ids.target}/permission-overrides`)
      .set(auth('super'))
      .send({ grants: [], denies: ['products.create', 'reports.sales.view'] });
    expect(deny.status).toBe(200);

    const res = await request(http)
      .put(`/users/${ids.target}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: [], denies: ['products.create'] });
    expect(res.status).toBe(403);
    expect(body(res).permissions).toContain('reports.sales.view');
    expect(await overridesOf(ids.target)).toEqual([
      'DENY:products.create',
      'DENY:reports.sales.view',
    ]);
  });

  it('a job-title change keeps overrides, flags review, audits from → to; saving the panel clears the flag', async () => {
    const res = await request(http)
      .patch(`/users/${ids.target}`)
      .set(auth('admin'))
      .send({ jobTitleId: ids.T2 });
    expect(res.status).toBe(200);
    expect(body(res).permissionsReviewRequired).toBe(true);
    expect(await overridesOf(ids.target)).toEqual([
      'DENY:products.create',
      'DENY:reports.sales.view',
    ]);
    const audit = await auditOf(ids.target, PERMISSION_AUDIT.USER_JOB_TITLE);
    expect(audit[0]?.metadata).toMatchObject({
      from: { id: ids.T1 },
      to: { id: ids.T2 },
    });

    const save = await request(http)
      .put(`/users/${ids.target}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: [], denies: ['products.create', 'reports.sales.view'] });
    expect(save.status).toBe(200);
    expect(body(save).permissionsReviewRequired).toBe(false);
  });

  it('settings.manage alone cannot change permissions (users.manage_permissions required)', async () => {
    const overrides = await request(http)
      .put(`/users/${ids.peer}/permission-overrides`)
      .set(auth('settingsOnly'))
      .send({ grants: [], denies: [] });
    expect(overrides.status).toBe(403);
    const legacy = await request(http)
      .post(`/users/${ids.peer}/permissions`)
      .set(auth('settingsOnly'))
      .send({ permissionNames: ['products.view'] });
    expect(legacy.status).toBe(403);
    const template = await request(http)
      .put(`/job-titles/${ids.T2}/permissions`)
      .set(auth('settingsOnly'))
      .send({ permissionNames: [] });
    expect(template.status).toBe(403);
    expect(await overridesOf(ids.peer)).toEqual(['DENY:products.edit']);
  });

  it('the legacy full-list save keeps DENY rows, is escalation-checked and audited', async () => {
    const denied = await request(http)
      .post(`/users/${ids.peer}/permissions`)
      .set(auth('admin'))
      .send({ permissionNames: ['accounting.journal-entries.post'] });
    expect(denied.status).toBe(403);
    expect(body(denied).code).toBe('PERMISSION_ESCALATION');

    const res = await request(http)
      .post(`/users/${ids.peer}/permissions`)
      .set(auth('admin'))
      .send({ permissionNames: ['products.view'] });
    expect(res.status).toBe(200);
    expect(await overridesOf(ids.peer)).toEqual([
      'DENY:products.edit',
      'GRANT:products.view',
    ]);
    const audit = await auditOf(ids.peer, PERMISSION_AUDIT.USER_PERMISSIONS);
    expect(audit[0]?.metadata).toMatchObject({ granted: ['products.view'] });
  });

  it('agent users are never managed through overrides (agent presets only)', async () => {
    const agentUser = await prisma.user.findFirst({
      where: { userType: 'AGENT' },
      select: { id: true },
    });
    if (!agentUser) return; // no agent user in this database
    const read = await request(http)
      .get(`/users/${agentUser.id}/permission-overrides`)
      .set(auth('admin'));
    expect(read.status).toBe(409);
    const write = await request(http)
      .put(`/users/${agentUser.id}/permission-overrides`)
      .set(auth('admin'))
      .send({ grants: ['products.view'], denies: [] });
    expect(write.status).toBe(409);
  });
});
