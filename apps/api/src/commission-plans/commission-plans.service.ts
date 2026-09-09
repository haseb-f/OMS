import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionAssignmentScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreateCommissionPlanDto } from './dto/create-commission-plan.dto';
import { UpdateCommissionPlanDto } from './dto/update-commission-plan.dto';
import { AssignCommissionPlanDto } from './dto/assign-commission-plan.dto';

/**
 * Part T/U — Commission Plans + deterministic assignment. Tiers are freely
 * replaced on update (unlike KPI Template items) since a CommissionCalculation
 * only ever references the parent `commissionPlanId`, never a specific
 * tier row — no historical FK to preserve.
 */
@Injectable()
export class CommissionPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private assertTiersConsistent(
    ruleType: string,
    tiers: CreateCommissionPlanDto['tiers'],
  ) {
    if (ruleType === 'FLAT_PERCENTAGE' && tiers.length !== 1) {
      throw new BadRequestException(
        'A FLAT_PERCENTAGE plan must have exactly one tier.',
      );
    }
    for (const tier of tiers) {
      if (ruleType === 'FIXED_BONUS' && tier.fixedAmount === undefined) {
        throw new BadRequestException(
          'Every tier of a FIXED_BONUS plan needs fixedAmount.',
        );
      }
      if (ruleType !== 'FIXED_BONUS' && tier.percentage === undefined) {
        throw new BadRequestException(
          `Every tier of a ${ruleType} plan needs percentage.`,
        );
      }
    }
  }

  async create(dto: CreateCommissionPlanDto, userId?: string) {
    this.assertTiersConsistent(dto.ruleType, dto.tiers);
    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.commissionPlan.create({
        data: {
          name: dto.name,
          description: dto.description,
          basis: dto.basis,
          ruleType: dto.ruleType,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await tx.commissionPlanTier.createMany({
        data: dto.tiers.map((tier, index) => ({
          commissionPlanId: created.id,
          minAchievementPercent: tier.minAchievementPercent,
          maxAchievementPercent: tier.maxAchievementPercent,
          percentage: tier.percentage,
          fixedAmount: tier.fixedAmount,
          sortOrder: tier.sortOrder ?? index,
        })),
      });
      return created;
    });
    await this.activityLog.log(
      'COMMISSION_PLAN',
      plan.id,
      'CREATED',
      `Commission Plan ${dto.name} created`,
      userId,
    );
    return this.findOne(plan.id);
  }

  async update(id: string, dto: UpdateCommissionPlanDto, userId?: string) {
    const existing = await this.findOne(id);
    const ruleType = dto.ruleType ?? existing.ruleType;
    const tiers =
      dto.tiers ??
      existing.tiers.map((t) => ({
        minAchievementPercent: Number(t.minAchievementPercent),
        maxAchievementPercent: t.maxAchievementPercent
          ? Number(t.maxAchievementPercent)
          : undefined,
        percentage: t.percentage ? Number(t.percentage) : undefined,
        fixedAmount: t.fixedAmount ? Number(t.fixedAmount) : undefined,
        sortOrder: t.sortOrder,
      }));
    this.assertTiersConsistent(ruleType, tiers);

    await this.prisma.$transaction(async (tx) => {
      await tx.commissionPlan.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          basis: dto.basis,
          ruleType: dto.ruleType,
          updatedBy: userId ?? null,
        },
      });
      if (dto.tiers) {
        await tx.commissionPlanTier.deleteMany({
          where: { commissionPlanId: id },
        });
        await tx.commissionPlanTier.createMany({
          data: dto.tiers.map((tier, index) => ({
            commissionPlanId: id,
            minAchievementPercent: tier.minAchievementPercent,
            maxAchievementPercent: tier.maxAchievementPercent,
            percentage: tier.percentage,
            fixedAmount: tier.fixedAmount,
            sortOrder: tier.sortOrder ?? index,
          })),
        });
      }
    });
    await this.activityLog.log(
      'COMMISSION_PLAN',
      id,
      'UPDATED',
      'Commission Plan updated',
      userId,
    );
    return this.findOne(id);
  }

  async archive(id: string, userId?: string) {
    await this.findOne(id);
    await this.prisma.commissionPlan.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'COMMISSION_PLAN',
      id,
      'ARCHIVED',
      'Commission Plan archived',
      userId,
    );
    return { id };
  }

  async restore(id: string, userId?: string) {
    await this.prisma.commissionPlan.update({
      where: { id },
      data: { deletedAt: null, isActive: true, updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      'COMMISSION_PLAN',
      id,
      'RESTORED',
      'Commission Plan restored',
      userId,
    );
    return { id };
  }

  async findAll(query: MasterDataQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CommissionPlanWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commissionPlan.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.commissionPlan.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const plan = await this.prisma.commissionPlan.findFirst({
      where: { id },
      include: {
        tiers: { orderBy: { sortOrder: 'asc' } },
        assignments: {
          include: {
            employeeProfile: {
              include: { partner: { select: { name: true } } },
            },
            salesTeam: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!plan) throw new NotFoundException('Commission Plan not found.');
    return plan;
  }

  // -- Assignment (Part U) --------------------------------------------------

  private assertAssignmentConsistency(dto: AssignCommissionPlanDto) {
    const targets = [
      dto.employeeProfileId,
      dto.salesTeamId,
      dto.departmentId,
    ].filter(Boolean);
    if (dto.scope === CommissionAssignmentScope.COMPANY) {
      if (targets.length)
        throw new BadRequestException('COMPANY scope takes no target field.');
      return;
    }
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exactly one target field is required for this scope.',
      );
    }
    if (
      (dto.scope === CommissionAssignmentScope.EMPLOYEE &&
        !dto.employeeProfileId) ||
      (dto.scope === CommissionAssignmentScope.TEAM && !dto.salesTeamId) ||
      (dto.scope === CommissionAssignmentScope.DEPARTMENT && !dto.departmentId)
    ) {
      throw new BadRequestException(
        'scope must match the provided target field.',
      );
    }
  }

  async assign(
    commissionPlanId: string,
    dto: AssignCommissionPlanDto,
    userId?: string,
  ) {
    await this.findOne(commissionPlanId);
    this.assertAssignmentConsistency(dto);

    const where: Prisma.CommissionPlanAssignmentWhereInput = {
      scope: dto.scope,
      employeeProfileId:
        dto.scope === CommissionAssignmentScope.EMPLOYEE
          ? dto.employeeProfileId
          : undefined,
      salesTeamId:
        dto.scope === CommissionAssignmentScope.TEAM
          ? dto.salesTeamId
          : undefined,
      departmentId:
        dto.scope === CommissionAssignmentScope.DEPARTMENT
          ? dto.departmentId
          : undefined,
    };
    if (dto.scope === CommissionAssignmentScope.COMPANY) {
      where.employeeProfileId = null;
      where.salesTeamId = null;
      where.departmentId = null;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.commissionPlanAssignment.deleteMany({ where });
      return tx.commissionPlanAssignment.create({
        data: {
          commissionPlanId,
          scope: dto.scope,
          employeeProfileId: dto.employeeProfileId,
          salesTeamId: dto.salesTeamId,
          departmentId: dto.departmentId,
          createdBy: userId ?? null,
        },
      });
    });
  }

  async unassign(assignmentId: string) {
    await this.prisma.commissionPlanAssignment.delete({
      where: { id: assignmentId },
    });
    return { id: assignmentId };
  }

  /** Part U — deterministic resolution: EMPLOYEE > TEAM > DEPARTMENT > COMPANY. */
  async resolvePlanForEmployee(employeeProfileId: string) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { id: employeeProfileId, deletedAt: null },
      select: { id: true, departmentId: true, salesTeamId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    const employeeAssignment =
      await this.prisma.commissionPlanAssignment.findFirst({
        where: {
          scope: CommissionAssignmentScope.EMPLOYEE,
          employeeProfileId: employee.id,
          isActive: true,
        },
        include: {
          commissionPlan: {
            include: { tiers: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      });
    if (employeeAssignment) return employeeAssignment.commissionPlan;

    if (employee.salesTeamId) {
      const teamAssignment =
        await this.prisma.commissionPlanAssignment.findFirst({
          where: {
            scope: CommissionAssignmentScope.TEAM,
            salesTeamId: employee.salesTeamId,
            isActive: true,
          },
          include: {
            commissionPlan: {
              include: { tiers: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        });
      if (teamAssignment) return teamAssignment.commissionPlan;
    }

    if (employee.departmentId) {
      const departmentAssignment =
        await this.prisma.commissionPlanAssignment.findFirst({
          where: {
            scope: CommissionAssignmentScope.DEPARTMENT,
            departmentId: employee.departmentId,
            isActive: true,
          },
          include: {
            commissionPlan: {
              include: { tiers: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        });
      if (departmentAssignment) return departmentAssignment.commissionPlan;
    }

    const companyAssignment =
      await this.prisma.commissionPlanAssignment.findFirst({
        where: { scope: CommissionAssignmentScope.COMPANY, isActive: true },
        include: {
          commissionPlan: {
            include: { tiers: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      });
    return companyAssignment?.commissionPlan ?? null;
  }
}
