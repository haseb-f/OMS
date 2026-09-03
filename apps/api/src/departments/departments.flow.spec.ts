import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneModule } from '../common/phone/phone.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { DepartmentsModule } from './departments.module';
import { DepartmentsService } from './departments.service';
import { SalesTeamsModule } from '../sales-teams/sales-teams.module';
import { SalesTeamsService } from '../sales-teams/sales-teams.service';

/**
 * 29R / 29S — Department is the only authoritative source for User and
 * Sales Team assignment. Archive hides the row from new assignment without
 * nulling historical FKs; restore makes it selectable again.
 */
describe('Department Master Data + Sales Teams', () => {
  let moduleRef: TestingModule;
  let departments: DepartmentsService;
  let salesTeams: SalesTeamsService;
  let users: UsersService;
  let prisma: PrismaService;
  let dbUnreachable = false;

  const createdUserIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdDepartmentIds: string[] = [];

  const suffix = () => randomUUID().slice(0, 8);

  async function ensureSeries(
    documentType: string,
    label: string,
    docCode: string,
  ) {
    await prisma.numberSeries.upsert({
      where: { documentType },
      update: { active: true },
      create: {
        documentType,
        label,
        docCode,
        template: '{DOC}-{SEQ}',
        padding: 6,
        yearReset: false,
        monthReset: false,
        dayReset: false,
        nextNumber: 1,
        active: true,
      },
    });
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PhoneModule,
        PermissionsCoreModule,
        AuthModule,
        DepartmentsModule,
        SalesTeamsModule,
        UsersModule,
      ],
    }).compile();
    await moduleRef.init();
    departments = moduleRef.get(DepartmentsService);
    salesTeams = moduleRef.get(SalesTeamsService);
    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
    try {
      await prisma.$queryRaw`SELECT 1`;
      await ensureSeries('DEPARTMENT', 'Department', 'DEPT');
      await ensureSeries('SALES_TEAM', 'Sales Team', 'ST');
    } catch {
      dbUnreachable = true;
      console.warn(
        'Department live flow skipped: Postgres is not reachable in this environment.',
      );
    }
  });

  afterAll(async () => {
    if (!prisma || dbUnreachable) {
      if (moduleRef) await moduleRef.close();
      return;
    }
    if (createdTeamIds.length > 0) {
      await prisma.salesTeamMember.deleteMany({
        where: { salesTeamId: { in: createdTeamIds } },
      });
      await prisma.salesTeam.deleteMany({
        where: { id: { in: createdTeamIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdDepartmentIds.length > 0) {
      await prisma.department.deleteMany({
        where: { id: { in: createdDepartmentIds } },
      });
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
    'creates a Department that is immediately assignable to a User and a Sales Team',
    async () => {
      const tag = suffix();
      const department = await departments.create({
        name: `قسم المبيعات الجديد ${tag}`,
        isActive: true,
      });
      createdDepartmentIds.push(department.id);

      await departments.assertAssignable(department.id);

      const listed = await departments.findAll({ page: 1, pageSize: 200 });
      expect(listed.items.some((row) => row.id === department.id)).toBe(true);

      const ahmed = await users.create({
        email: `ahmed-${tag}@example.com`,
        username: `ahmed_${tag}`,
        fullName: 'Ahmed',
        password: 'TeamPassw0rd!',
        departmentId: department.id,
      });
      createdUserIds.push(ahmed.id);
      expect(ahmed.departmentId).toBe(department.id);
      expect(ahmed.department?.id).toBe(department.id);

      const sara = await users.create({
        email: `sara-${tag}@example.com`,
        username: `sara_${tag}`,
        fullName: 'Sara',
        password: 'TeamPassw0rd!',
        departmentId: department.id,
      });
      createdUserIds.push(sara.id);

      const mohamed = await users.create({
        email: `mohamed-${tag}@example.com`,
        username: `mohamed_${tag}`,
        fullName: 'Mohamed',
        password: 'TeamPassw0rd!',
        departmentId: department.id,
      });
      createdUserIds.push(mohamed.id);

      const team = await salesTeams.create({
        name: 'فريق المبيعات الأول',
        departmentId: department.id,
        managerId: ahmed.id,
        memberIds: [sara.id, mohamed.id],
      });
      createdTeamIds.push(team.id);

      expect(team.departmentId).toBe(department.id);
      expect(team.managerId).toBe(ahmed.id);
      expect(team.members.map((member) => member.userId).sort()).toEqual(
        [sara.id, mohamed.id].sort(),
      );
    },
  );

  liveIt(
    'archive hides a Department from new assignment but keeps historical FKs',
    async () => {
      const tag = suffix();
      const department = await departments.create({
        name: `Archived Dept ${tag}`,
        isActive: true,
      });
      createdDepartmentIds.push(department.id);

      const existing = await users.create({
        email: `kept-${tag}@example.com`,
        username: `kept_${tag}`,
        fullName: 'Kept User',
        password: 'TeamPassw0rd!',
        departmentId: department.id,
      });
      createdUserIds.push(existing.id);

      await departments.archive(department.id);

      await expect(
        departments.assertAssignable(department.id),
      ).rejects.toBeInstanceOf(BadRequestException);

      const listed = await departments.findAll({ page: 1, pageSize: 200 });
      expect(listed.items.some((row) => row.id === department.id)).toBe(false);

      await expect(
        users.create({
          email: `new-${tag}@example.com`,
          username: `new_${tag}`,
          fullName: 'New User',
          password: 'TeamPassw0rd!',
          departmentId: department.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const stillThere = await users.findOne(existing.id);
      expect(stillThere.departmentId).toBe(department.id);
      expect(stillThere.department?.deletedAt).toBeTruthy();

      const kept = await users.update(existing.id, {
        departmentId: department.id,
        fullName: 'Kept User Still',
      });
      expect(kept.departmentId).toBe(department.id);

      const otherDepartment = await departments.create({
        name: `Other Dept ${tag}`,
        isActive: true,
      });
      createdDepartmentIds.push(otherDepartment.id);

      const manager = await users.create({
        email: `mgr-${tag}@example.com`,
        username: `mgr_${tag}`,
        fullName: 'Other Manager',
        password: 'TeamPassw0rd!',
        departmentId: otherDepartment.id,
      });
      createdUserIds.push(manager.id);

      await expect(
        salesTeams.create({
          name: 'Should Fail',
          departmentId: department.id,
          managerId: manager.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const restored = await departments.restore(department.id);
      expect(restored.deletedAt).toBeNull();
      await departments.assertAssignable(department.id);

      const listedAgain = await departments.findAll({ page: 1, pageSize: 200 });
      expect(listedAgain.items.some((row) => row.id === department.id)).toBe(
        true,
      );
    },
  );
});
