import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PhoneModule } from '../common/phone/phone.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { JobTitlesModule } from './job-titles.module';
import { JobTitlesService } from './job-titles.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';

describe('JobTitles — Master Data CRUD, User relation, Role independence', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: JobTitlesService;
  let users: UsersService;
  let permissions: PermissionsResolverService;
  const suffix = randomUUID().slice(0, 8);
  const createdJobTitleIds: string[] = [];
  const createdUserIds: string[] = [];
  let departmentId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthModule,
        PhoneModule,
        PermissionsCoreModule,
        UsersModule,
        JobTitlesModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(JobTitlesService);
    users = moduleRef.get(UsersService);
    permissions = moduleRef.get(PermissionsResolverService);

    const department = await prisma.department.create({
      data: { code: `DEPT-JT-${suffix}`, name: `Sales ${suffix}` },
    });
    departmentId = department.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (createdUserIds.length) {
        await prisma.userPermission.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (createdJobTitleIds.length) {
        await prisma.jobTitle.deleteMany({
          where: { id: { in: createdJobTitleIds } },
        });
      }
      await prisma.department.deleteMany({ where: { id: departmentId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it('creates a Job Title with an auto-generated code (never client-supplied)', async () => {
    const created = await service.create({
      name: `مندوب مبيعات ${suffix}`,
      nameEn: `Sales Representative ${suffix}`,
      departmentId,
    });
    createdJobTitleIds.push(created.id);
    expect(created.code).toBeTruthy();
    expect(created.code.startsWith('JT-')).toBe(true);
    expect(created.isActive).toBe(true);
    expect(created.deletedAt).toBeNull();
  });

  it('lists both seeded and custom titles as active for the picker', async () => {
    const created = await service.create({
      name: `مشرف مبيعات ${suffix}`,
      nameEn: `Sales Supervisor ${suffix}`,
      departmentId,
    });
    createdJobTitleIds.push(created.id);

    const active = await service.findActive();
    const ids = active.map((t) => t.id);
    expect(ids).toContain(created.id);
    // The 8 default seeded titles (System Administrator, etc.) must still
    // be present — this feature extends the seed list, never replaces it.
    expect(active.some((t) => t.code === 'SYSTEM_ADMIN')).toBe(true);
  });

  it('archiving excludes a title from new selection but keeps it on an existing User', async () => {
    const title = await service.create({
      name: `مسمى للأرشفة ${suffix}`,
    });
    createdJobTitleIds.push(title.id);

    const employee = await users.create({
      email: `jt-archive-${suffix}@example.com`,
      username: `jt_archive_${suffix}`,
      fullName: 'Archive Title Employee',
      password: 'SalesPassw0rd!',
      departmentId,
      jobTitleId: title.id,
    });
    createdUserIds.push(employee.id);

    await service.archive(title.id);

    const active = await service.findActive();
    expect(active.some((t) => t.id === title.id)).toBe(false);

    // Historical display: the User's own record still resolves the title.
    const reloaded = await users.findOne(employee.id);
    expect(reloaded.jobTitle?.id).toBe(title.id);
    expect(reloaded.jobTitle?.name).toBe(title.name);

    const restored = await service.restore(title.id);
    expect(restored.deletedAt).toBeNull();
    const activeAgain = await service.findActive();
    expect(activeAgain.some((t) => t.id === title.id)).toBe(true);
  });

  it('Job Title never grants or removes a permission — Role independence', async () => {
    const salesRepTitle = await service.create({
      name: `دور مستقل أ ${suffix}`,
      nameEn: `Independence A ${suffix}`,
    });
    createdJobTitleIds.push(salesRepTitle.id);
    const salesManagerTitle = await service.create({
      name: `دور مستقل ب ${suffix}`,
      nameEn: `Independence B ${suffix}`,
    });
    createdJobTitleIds.push(salesManagerTitle.id);

    // User whose ROLE (permissions) is "Sales Agent" but whose JOB TITLE
    // says "Sales Manager" — must still only have Sales Agent permissions.
    const agentWithManagerTitle = await users.create({
      email: `jt-indep-a-${suffix}@example.com`,
      username: `jt_indep_a_${suffix}`,
      fullName: 'Independence Agent',
      password: 'SalesPassw0rd!',
      departmentId,
      jobTitleId: salesManagerTitle.id,
    });
    createdUserIds.push(agentWithManagerTitle.id);
    await users.setPermissions(agentWithManagerTitle.id, {
      permissionNames: ['crm.leads.view', 'crm.leads.edit'],
    });

    // User whose ROLE is "Sales Manager" but whose JOB TITLE says "Sales
    // Representative" — must still keep the manage permission.
    const managerWithAgentTitle = await users.create({
      email: `jt-indep-b-${suffix}@example.com`,
      username: `jt_indep_b_${suffix}`,
      fullName: 'Independence Manager',
      password: 'SalesPassw0rd!',
      departmentId,
      jobTitleId: salesRepTitle.id,
    });
    createdUserIds.push(managerWithAgentTitle.id);
    await users.setPermissions(managerWithAgentTitle.id, {
      permissionNames: ['crm.leads.view', 'crm.leads.manage'],
    });

    expect(
      await permissions.hasPermission(
        agentWithManagerTitle.id,
        'crm.leads.manage',
      ),
    ).toBe(false);
    expect(
      await permissions.hasPermission(
        agentWithManagerTitle.id,
        'crm.leads.edit',
      ),
    ).toBe(true);

    expect(
      await permissions.hasPermission(
        managerWithAgentTitle.id,
        'crm.leads.manage',
      ),
    ).toBe(true);

    // Changing the Job Title after the fact must not touch permissions.
    await users.update(agentWithManagerTitle.id, {
      jobTitleId: salesRepTitle.id,
    });
    expect(
      await permissions.hasPermission(
        agentWithManagerTitle.id,
        'crm.leads.manage',
      ),
    ).toBe(false);
  });
});
