import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KpiAssignmentScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { CreateKpiTemplateDto } from './dto/create-kpi-template.dto';
import { UpdateKpiTemplateDto } from './dto/update-kpi-template.dto';
import { AssignKpiTemplateDto } from './dto/assign-kpi-template.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';

const WEIGHT_TOLERANCE = 0.01;

@Injectable()
export class KpiTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  private assertWeightsSumTo100(
    items: { weight: number; isActive?: boolean }[],
  ) {
    const activeWeight = items
      .filter((item) => item.isActive !== false)
      .reduce((sum, item) => sum + Number(item.weight), 0);
    if (Math.abs(activeWeight - 100) > WEIGHT_TOLERANCE) {
      throw new BadRequestException(
        `Active item weights must total 100% (currently ${activeWeight.toFixed(2)}%).`,
      );
    }
  }

  async create(dto: CreateKpiTemplateDto, userId?: string) {
    this.assertWeightsSumTo100(dto.items);
    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kpiTemplate.create({
        data: {
          name: dto.name,
          nameEn: dto.nameEn,
          description: dto.description,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      await tx.kpiTemplateItem.createMany({
        data: dto.items.map((item, index) => ({
          kpiTemplateId: created.id,
          criterionAr: item.criterionAr,
          criterionEn: item.criterionEn,
          weight: item.weight,
          itemType: item.itemType,
          evaluatorSource: item.evaluatorSource,
          autoMetricSource: item.autoMetricSource,
          dropdownOptions:
            item.dropdownOptions as unknown as Prisma.InputJsonValue,
          sortOrder: item.sortOrder ?? index,
          isActive: item.isActive ?? true,
        })),
      });
      return created;
    });
    await this.activityLog.log(
      'KPI_TEMPLATE',
      template.id,
      'CREATED',
      `KPI Template ${dto.name} created`,
      userId,
    );
    return this.findOne(template.id);
  }

  /**
   * Items are never deleted here (Part AK-adjacent integrity: a
   * KpiEvaluationItem snapshot references kpiTemplateItemId with RESTRICT —
   * an item already used by a past evaluation must stay resolvable). An
   * item with `id` is updated in place; one without `id` is created; an
   * existing active item missing from the payload is soft-deactivated
   * (isActive=false), dropping out of future weight totals and evaluations
   * without breaking history.
   */
  async update(id: string, dto: UpdateKpiTemplateDto, userId?: string) {
    const existing = await this.findOne(id);
    const nextItems = (dto.items ?? existing.items).map((item) => ({
      weight: Number(item.weight),
      isActive: item.isActive,
    }));
    this.assertWeightsSumTo100(nextItems);

    await this.prisma.$transaction(async (tx) => {
      await tx.kpiTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          nameEn: dto.nameEn,
          description: dto.description,
          updatedBy: userId ?? null,
        },
      });
      if (dto.items) {
        const keptIds = new Set(dto.items.filter((i) => i.id).map((i) => i.id));
        for (const item of dto.items) {
          if (item.id) {
            await tx.kpiTemplateItem.update({
              where: { id: item.id },
              data: {
                criterionAr: item.criterionAr,
                criterionEn: item.criterionEn,
                weight: item.weight,
                itemType: item.itemType,
                evaluatorSource: item.evaluatorSource,
                autoMetricSource: item.autoMetricSource ?? null,
                dropdownOptions:
                  item.dropdownOptions as unknown as Prisma.InputJsonValue,
                sortOrder: item.sortOrder,
                isActive: item.isActive ?? true,
              },
            });
          } else {
            await tx.kpiTemplateItem.create({
              data: {
                kpiTemplateId: id,
                criterionAr: item.criterionAr,
                criterionEn: item.criterionEn,
                weight: item.weight,
                itemType: item.itemType,
                evaluatorSource: item.evaluatorSource,
                autoMetricSource: item.autoMetricSource,
                dropdownOptions:
                  item.dropdownOptions as unknown as Prisma.InputJsonValue,
                sortOrder: item.sortOrder ?? 0,
                isActive: item.isActive ?? true,
              },
            });
          }
        }
        for (const existingItem of existing.items) {
          if (!keptIds.has(existingItem.id) && existingItem.isActive) {
            await tx.kpiTemplateItem.update({
              where: { id: existingItem.id },
              data: { isActive: false },
            });
          }
        }
      }
    });
    await this.activityLog.log(
      'KPI_TEMPLATE',
      id,
      'UPDATED',
      `KPI Template updated`,
      userId,
    );
    return this.findOne(id);
  }

  async archive(id: string, userId?: string) {
    await this.findOne(id);
    await this.prisma.kpiTemplate.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'KPI_TEMPLATE',
      id,
      'ARCHIVED',
      'KPI Template archived',
      userId,
    );
    return { id };
  }

  async restore(id: string, userId?: string) {
    await this.prisma.kpiTemplate.update({
      where: { id },
      data: { deletedAt: null, isActive: true, updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      'KPI_TEMPLATE',
      id,
      'RESTORED',
      'KPI Template restored',
      userId,
    );
    return { id };
  }

  async findAll(query: MasterDataQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.KpiTemplateWhereInput = {
      deletedAt: query.includeArchived ? undefined : null,
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.kpiTemplate.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.kpiTemplate.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const template = await this.prisma.kpiTemplate.findFirst({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        assignments: {
          include: {
            jobTitle: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            employeeProfile: {
              include: { partner: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!template) throw new NotFoundException('KPI Template not found.');
    return template;
  }

  // -- Assignment (Part J) --------------------------------------------------

  private assertAssignmentConsistency(dto: AssignKpiTemplateDto) {
    const targets = [
      dto.jobTitleId,
      dto.departmentId,
      dto.employeeProfileId,
    ].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException(
        'Exactly one of jobTitleId/departmentId/employeeProfileId is required.',
      );
    }
    if (
      (dto.scope === KpiAssignmentScope.JOB_TITLE && !dto.jobTitleId) ||
      (dto.scope === KpiAssignmentScope.DEPARTMENT && !dto.departmentId) ||
      (dto.scope === KpiAssignmentScope.EMPLOYEE && !dto.employeeProfileId)
    ) {
      throw new BadRequestException(
        'scope must match the provided target field.',
      );
    }
  }

  /** Only one active assignment may exist per scope+target (across all templates) — reassigning replaces it, never stacks ambiguously. */
  async assign(
    kpiTemplateId: string,
    dto: AssignKpiTemplateDto,
    userId?: string,
  ) {
    await this.findOne(kpiTemplateId);
    this.assertAssignmentConsistency(dto);

    const where: Prisma.KpiTemplateAssignmentWhereInput = {
      scope: dto.scope,
      jobTitleId:
        dto.scope === KpiAssignmentScope.JOB_TITLE ? dto.jobTitleId : undefined,
      departmentId:
        dto.scope === KpiAssignmentScope.DEPARTMENT
          ? dto.departmentId
          : undefined,
      employeeProfileId:
        dto.scope === KpiAssignmentScope.EMPLOYEE
          ? dto.employeeProfileId
          : undefined,
    };

    return this.prisma.$transaction(async (tx) => {
      await tx.kpiTemplateAssignment.deleteMany({ where });
      return tx.kpiTemplateAssignment.create({
        data: {
          kpiTemplateId,
          scope: dto.scope,
          jobTitleId: dto.jobTitleId,
          departmentId: dto.departmentId,
          employeeProfileId: dto.employeeProfileId,
          createdBy: userId ?? null,
        },
      });
    });
  }

  async unassign(assignmentId: string) {
    await this.prisma.kpiTemplateAssignment.delete({
      where: { id: assignmentId },
    });
    return { id: assignmentId };
  }

  /** Part J resolution priority: EMPLOYEE override > JOB_TITLE > DEPARTMENT. */
  async resolveTemplateForEmployee(employeeProfileId: string) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { id: employeeProfileId, deletedAt: null },
      select: { id: true, jobTitleId: true, departmentId: true },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    const employeeAssignment =
      await this.prisma.kpiTemplateAssignment.findFirst({
        where: {
          scope: KpiAssignmentScope.EMPLOYEE,
          employeeProfileId: employee.id,
          isActive: true,
        },
        include: { kpiTemplate: true },
      });
    if (employeeAssignment) return employeeAssignment.kpiTemplate;

    if (employee.jobTitleId) {
      const jobTitleAssignment =
        await this.prisma.kpiTemplateAssignment.findFirst({
          where: {
            scope: KpiAssignmentScope.JOB_TITLE,
            jobTitleId: employee.jobTitleId,
            isActive: true,
          },
          include: { kpiTemplate: true },
        });
      if (jobTitleAssignment) return jobTitleAssignment.kpiTemplate;
    }

    if (employee.departmentId) {
      const departmentAssignment =
        await this.prisma.kpiTemplateAssignment.findFirst({
          where: {
            scope: KpiAssignmentScope.DEPARTMENT,
            departmentId: employee.departmentId,
            isActive: true,
          },
          include: { kpiTemplate: true },
        });
      if (departmentAssignment) return departmentAssignment.kpiTemplate;
    }

    return null;
  }
}
