import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  PartnerEntityType,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PartnersService } from '../partners/partners.service';
import { UsersService } from '../users/users.service';
import { DepartmentsService } from '../departments/departments.service';
import { PayrollComponentsService } from '../payroll-components/payroll-components.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { RecordCompensationDto } from './dto/record-compensation.dto';
import { EmployeesQueryDto } from './dto/employees-query.dto';
import { HR_ROLE_PRESETS } from './hr-role-presets';

const EMPLOYEE_INCLUDE = {
  partner: {
    select: { id: true, name: true, mobile: true, email: true, notes: true },
  },
  jobTitle: { select: { id: true, name: true, nameEn: true } },
  department: { select: { id: true, name: true, nameEn: true } },
  salesTeam: { select: { id: true, name: true } },
  manager: {
    select: {
      id: true,
      employeeCode: true,
      partner: { select: { name: true } },
    },
  },
  user: { select: { id: true, email: true } },
} satisfies Prisma.EmployeeProfileInclude;

type EmployeeWithRelations = Prisma.EmployeeProfileGetPayload<{
  include: typeof EMPLOYEE_INCLUDE;
}>;

/** Flattens the Partner+EmployeeProfile split into the single Employee shape the frontend renders — Employee is ONE entity to the UI, even though it is stored as two joined rows (Part C). */
function toEmployeeView(row: EmployeeWithRelations) {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.partner.name,
    mobile: row.partner.mobile,
    email: row.partner.email,
    notes: row.partner.notes,
    hireDate: row.hireDate,
    employmentStatus: row.employmentStatus,
    department: row.department,
    jobTitle: row.jobTitle,
    salesTeam: row.salesTeam,
    manager: row.manager
      ? {
          id: row.manager.id,
          employeeCode: row.manager.employeeCode,
          name: row.manager.partner.name,
        }
      : null,
    userId: row.user?.id ?? null,
    userEmail: row.user?.email ?? null,
    partnerId: row.partnerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly usersService: UsersService,
    private readonly departments: DepartmentsService,
    private readonly payrollComponents: PayrollComponentsService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private async assertCompensationLinesAssignable(
    lines?: { payrollComponentId: string }[],
  ) {
    if (!lines?.length) return;
    for (const line of lines) {
      await this.payrollComponents.assertAssignable(line.payrollComponentId);
    }
  }

  private async assertJobTitleAssignable(id: string) {
    const jobTitle = await this.prisma.jobTitle.findFirst({ where: { id } });
    if (!jobTitle || jobTitle.deletedAt || !jobTitle.isActive) {
      throw new BadRequestException(
        'Archived or inactive Job Titles cannot be assigned.',
      );
    }
  }

  private async assertSalesTeamAssignable(id: string) {
    const team = await this.prisma.salesTeam.findFirst({ where: { id } });
    if (!team || team.deletedAt || !team.isActive) {
      throw new BadRequestException(
        'Archived or inactive Sales Teams cannot be assigned.',
      );
    }
  }

  private async assertManagerAssignable(id: string, selfId?: string) {
    if (id === selfId) {
      throw new BadRequestException('An employee cannot be their own manager.');
    }
    const manager = await this.prisma.employeeProfile.findFirst({
      where: { id },
    });
    if (!manager || manager.deletedAt) {
      throw new BadRequestException(
        'Archived employees cannot be assigned as a manager.',
      );
    }
  }

  private async assertOrgFieldsAssignable(fields: {
    departmentId?: string;
    jobTitleId?: string;
    salesTeamId?: string;
    managerEmployeeId?: string;
    selfId?: string;
  }) {
    if (fields.departmentId)
      await this.departments.assertAssignable(fields.departmentId);
    if (fields.jobTitleId)
      await this.assertJobTitleAssignable(fields.jobTitleId);
    if (fields.salesTeamId)
      await this.assertSalesTeamAssignable(fields.salesTeamId);
    if (fields.managerEmployeeId) {
      await this.assertManagerAssignable(
        fields.managerEmployeeId,
        fields.selfId,
      );
    }
  }

  async create(dto: CreateEmployeeDto, userId?: string) {
    await this.assertOrgFieldsAssignable(dto);

    const partner = await this.partnersService.create(
      {
        name: dto.name,
        mobile: dto.mobile,
        email: dto.email,
        entityType: PartnerEntityType.PERSON,
        roles: [PartnerRoleType.EMPLOYEE],
        employeeProfile: {
          jobTitleId: dto.jobTitleId,
          departmentId: dto.departmentId,
          salesTeamId: dto.salesTeamId,
          managerEmployeeId: dto.managerEmployeeId,
          hireDate: dto.hireDate,
        },
      },
      userId,
    );
    const employeeProfileId = partner.employeeProfile!.id;

    try {
      if (dto.compensation) {
        await this.recordCompensation(
          employeeProfileId,
          dto.compensation,
          userId,
        );
      }

      if (dto.createLoginAccount && dto.account) {
        await this.createAccount(employeeProfileId, dto.account, userId);
      }
    } catch (error) {
      // The wizard is one compact "Save", not four round-trips (Part E) — a
      // later step failing (e.g. account email/phone already taken) must
      // never leave an orphaned Partner/EmployeeProfile behind, since
      // partnersService.create() above already committed in its own
      // transaction. Best-effort compensating rollback, most-dependent
      // rows first.
      await this.prisma.compensationRevision
        .deleteMany({ where: { employeeProfileId } })
        .catch(() => undefined);
      const orphan = await this.prisma.employeeProfile
        .findUnique({
          where: { id: employeeProfileId },
          select: { userId: true },
        })
        .catch(() => null);
      await this.prisma.employeeProfile
        .delete({ where: { id: employeeProfileId } })
        .catch(() => undefined);
      if (orphan?.userId) {
        await this.prisma.user
          .delete({ where: { id: orphan.userId } })
          .catch(() => undefined);
      }
      await this.prisma.partnerRoleAssignment
        .deleteMany({ where: { partnerId: partner.id } })
        .catch(() => undefined);
      await this.prisma.partner
        .delete({ where: { id: partner.id } })
        .catch(() => undefined);
      throw error;
    }

    await this.activityLog.log(
      'EMPLOYEE',
      employeeProfileId,
      'CREATED',
      `Employee ${dto.name} created`,
      userId,
    );

    return this.findOne(employeeProfileId);
  }

  private async createAccount(
    employeeProfileId: string,
    account: NonNullable<CreateEmployeeDto['account']>,
    userId?: string,
  ) {
    const employee = await this.prisma.employeeProfile.findUniqueOrThrow({
      where: { id: employeeProfileId },
      include: { partner: true },
    });
    if (!employee.departmentId) {
      throw new BadRequestException(
        'A Department must be set (Step 2) before creating a login account — Users require one.',
      );
    }
    const created = await this.usersService.create({
      email: account.loginEmail,
      username: account.username ?? account.loginEmail.split('@')[0],
      fullName: employee.partner.name,
      generatePassword: true,
      mobile: employee.partner.mobile ?? undefined,
      departmentId: employee.departmentId,
      jobTitleId: employee.jobTitleId ?? undefined,
    });
    await this.usersService.setPermissions(created.id, {
      permissionNames: HR_ROLE_PRESETS[account.role],
    });
    await this.prisma.employeeProfile.update({
      where: { id: employeeProfileId },
      data: { userId: created.id, updatedBy: userId ?? null },
    });
    return created;
  }

  async createAccountForEmployee(
    employeeId: string,
    account: NonNullable<CreateEmployeeDto['account']>,
    userId?: string,
  ) {
    const existing = await this.prisma.employeeProfile.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Employee not found.');
    if (existing.userId) {
      throw new BadRequestException(
        'This employee already has a login account.',
      );
    }
    await this.createAccount(employeeId, account, userId);
    return this.findOne(employeeId);
  }

  async findAll(query: EmployeesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.EmployeeProfileWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      departmentId: query.departmentId,
      employmentStatus: query.employmentStatus,
      OR: query.search
        ? [
            { employeeCode: { contains: query.search, mode: 'insensitive' } },
            {
              partner: {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { mobile: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            },
          ]
        : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.employeeProfile.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.employeeProfile.count({ where }),
    ]);

    return { items: items.map(toEmployeeView), total, page, pageSize };
  }

  private async findRaw(id: string) {
    const row = await this.prisma.employeeProfile.findFirst({
      where: { id },
      include: EMPLOYEE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Employee not found.');
    return row;
  }

  async findOne(id: string) {
    return toEmployeeView(await this.findRaw(id));
  }

  async findMe(userId: string) {
    const row = await this.prisma.employeeProfile.findFirst({
      where: { userId },
      include: EMPLOYEE_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(
        'No Employee record is linked to your account.',
      );
    return toEmployeeView(row);
  }

  async update(id: string, dto: UpdateEmployeeDto, userId?: string) {
    const existing = await this.findRaw(id);
    await this.assertOrgFieldsAssignable({ ...dto, selfId: id });

    await this.partnersService.update(
      existing.partnerId,
      {
        name: dto.name,
        mobile: dto.mobile,
        email: dto.email,
        employeeProfile: {
          hireDate: dto.hireDate,
          employmentStatus: dto.employmentStatus,
          departmentId: dto.departmentId,
          jobTitleId: dto.jobTitleId,
          salesTeamId: dto.salesTeamId,
          managerEmployeeId: dto.managerEmployeeId,
        },
      },
      userId,
    );
    await this.activityLog.log(
      'EMPLOYEE',
      id,
      'UPDATED',
      `Employee ${existing.partner.name} updated`,
      userId,
    );
    return this.findOne(id);
  }

  async archive(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.deletedAt)
      throw new BadRequestException('Employee is already archived.');
    await this.prisma.employeeProfile.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        employmentStatus: EmployeeStatus.TERMINATED,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'EMPLOYEE',
      id,
      'ARCHIVED',
      `Employee ${existing.partner.name} archived`,
      userId,
    );
    return this.findOne(id);
  }

  async restore(id: string, userId?: string) {
    const existing = await this.findRaw(id);
    if (!existing.deletedAt)
      throw new BadRequestException('Employee is not archived.');
    await this.prisma.employeeProfile.update({
      where: { id },
      data: {
        deletedAt: null,
        employmentStatus: EmployeeStatus.ACTIVE,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'EMPLOYEE',
      id,
      'RESTORED',
      `Employee ${existing.partner.name} restored`,
      userId,
    );
    return this.findOne(id);
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity('EMPLOYEE', id);
  }

  // -- Compensation (Part G — effective-dated Salary History) --------------

  async recordCompensation(
    employeeId: string,
    dto: RecordCompensationDto,
    userId?: string,
  ) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    await this.assertCompensationLinesAssignable(dto.lines);

    const created = await this.prisma.$transaction(async (tx) => {
      const revision = await tx.compensationRevision.create({
        data: {
          employeeProfileId: employeeId,
          effectiveFrom: new Date(dto.effectiveFrom),
          basicSalary: dto.basicSalary,
          kpiMaxPay: dto.kpiMaxPay ?? 0,
          notes: dto.notes,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      if (dto.lines?.length) {
        await tx.compensationRevisionLine.createMany({
          data: dto.lines.map((line, index) => ({
            compensationRevisionId: revision.id,
            payrollComponentId: line.payrollComponentId,
            amount: line.amount,
            sortOrder: index,
          })),
        });
      }
      return revision;
    });

    await this.activityLog.log(
      'EMPLOYEE',
      employeeId,
      'COMPENSATION_REVISED',
      `Compensation revised effective ${dto.effectiveFrom} — basic ${dto.basicSalary}`,
      userId,
    );
    return created;
  }

  /** Only a still-future revision (effectiveFrom > today) may be corrected in place — Part G "Never overwrite historical compensation." */
  async updateCompensationRevision(
    revisionId: string,
    dto: RecordCompensationDto,
    userId?: string,
  ) {
    const revision = await this.prisma.compensationRevision.findUniqueOrThrow({
      where: { id: revisionId },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (revision.effectiveFrom <= today) {
      throw new BadRequestException(
        'This Compensation Revision has already taken effect and cannot be edited — record a new revision instead.',
      );
    }
    await this.assertCompensationLinesAssignable(dto.lines);
    await this.prisma.$transaction(async (tx) => {
      await tx.compensationRevision.update({
        where: { id: revisionId },
        data: {
          effectiveFrom: new Date(dto.effectiveFrom),
          basicSalary: dto.basicSalary,
          kpiMaxPay: dto.kpiMaxPay ?? 0,
          notes: dto.notes,
          updatedBy: userId ?? null,
        },
      });
      await tx.compensationRevisionLine.deleteMany({
        where: { compensationRevisionId: revisionId },
      });
      if (dto.lines?.length) {
        await tx.compensationRevisionLine.createMany({
          data: dto.lines.map((line, index) => ({
            compensationRevisionId: revisionId,
            payrollComponentId: line.payrollComponentId,
            amount: line.amount,
            sortOrder: index,
          })),
        });
      }
    });
    return this.prisma.compensationRevision.findUniqueOrThrow({
      where: { id: revisionId },
      include: { lines: { include: { payrollComponent: true } } },
    });
  }

  async compensationHistory(employeeId: string) {
    return this.prisma.compensationRevision.findMany({
      where: { employeeProfileId: employeeId },
      include: {
        lines: {
          include: { payrollComponent: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** The compensation package in force on a given date (defaults to today) — used by KPI Payout and Payroll calculation, never re-derived independently. */
  async currentCompensation(employeeId: string, asOf: Date = new Date()) {
    return this.prisma.compensationRevision.findFirst({
      where: { employeeProfileId: employeeId, effectiveFrom: { lte: asOf } },
      include: {
        lines: {
          include: { payrollComponent: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
