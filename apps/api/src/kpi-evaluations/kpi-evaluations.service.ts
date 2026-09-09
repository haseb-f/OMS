import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KpiAutoMetricSource,
  KpiEvaluationStatus,
  KpiEvaluatorSource,
  KpiItemType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { KpiTemplatesService } from '../kpi-templates/kpi-templates.service';
import { EmployeesService } from '../employees/employees.service';
import { SalesTargetsService } from '../sales-targets/sales-targets.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { StartKpiEvaluationDto } from './dto/start-kpi-evaluation.dto';
import { ScoreKpiItemDto } from './dto/score-kpi-item.dto';
import { ReopenKpiEvaluationDto } from './dto/reopen-kpi-evaluation.dto';
import { KpiEvaluationsQueryDto } from './dto/kpi-evaluations-query.dto';

const LOW_SCORE_COMMENT_THRESHOLD = 50;

const EVALUATION_INCLUDE = {
  employeeProfile: { include: { partner: { select: { name: true } } } },
  items: { orderBy: { kpiTemplateItem: { sortOrder: 'asc' as const } } },
} satisfies Prisma.KpiEvaluationInclude;

@Injectable()
export class KpiEvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpiTemplates: KpiTemplatesService,
    private readonly employees: EmployeesService,
    private readonly salesTargets: SalesTargetsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /** Part M — one Evaluation per Employee per month. Idempotent: re-calling on an existing period returns the existing row rather than erroring or duplicating (Part AK). */
  async start(dto: StartKpiEvaluationDto, userId?: string) {
    const existing = await this.prisma.kpiEvaluation.findUnique({
      where: {
        employeeProfileId_period: {
          employeeProfileId: dto.employeeProfileId,
          period: dto.period,
        },
      },
      include: EVALUATION_INCLUDE,
    });
    if (existing) return existing;

    const template = await this.kpiTemplates.resolveTemplateForEmployee(
      dto.employeeProfileId,
    );
    if (!template) {
      throw new BadRequestException(
        'No KPI Template is assigned to this employee (by Employee override, Job Title, or Department).',
      );
    }
    const templateWithItems = await this.kpiTemplates.findOne(template.id);
    const activeItems = templateWithItems.items.filter((item) => item.isActive);
    if (!activeItems.length) {
      throw new BadRequestException(
        'The assigned KPI Template has no active items.',
      );
    }

    const compensation = await this.employees.currentCompensation(
      dto.employeeProfileId,
    );
    const kpiMaxPaySnapshot = compensation ? Number(compensation.kpiMaxPay) : 0;

    const evaluation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.kpiEvaluation.create({
        data: {
          employeeProfileId: dto.employeeProfileId,
          period: dto.period,
          kpiTemplateId: template.id,
          kpiMaxPaySnapshot,
          createdBy: userId ?? null,
        },
      });
      await tx.kpiEvaluationItem.createMany({
        data: activeItems.map((item) => ({
          kpiEvaluationId: created.id,
          kpiTemplateItemId: item.id,
          criterionArSnapshot: item.criterionAr,
          weightSnapshot: item.weight,
          itemTypeSnapshot: item.itemType,
          evaluatorSourceSnapshot: item.evaluatorSource,
        })),
      });
      return created;
    });

    await this.computeAutoMetrics(evaluation.id);
    return this.findOne(evaluation.id);
  }

  async findOne(id: string) {
    const evaluation = await this.prisma.kpiEvaluation.findUnique({
      where: { id },
      include: EVALUATION_INCLUDE,
    });
    if (!evaluation) throw new NotFoundException('KPI Evaluation not found.');
    return evaluation;
  }

  async findForEmployeeAndPeriod(employeeProfileId: string, period: string) {
    return this.prisma.kpiEvaluation.findUnique({
      where: { employeeProfileId_period: { employeeProfileId, period } },
      include: EVALUATION_INCLUDE,
    });
  }

  async findAll(query: KpiEvaluationsQueryDto) {
    const where: Prisma.KpiEvaluationWhereInput = {
      period: query.period,
      status: query.status,
      employeeProfileId: query.employeeProfileId,
      employeeProfile: {
        departmentId: query.departmentId,
        salesTeamId: query.salesTeamId,
      },
    };
    return this.prisma.kpiEvaluation.findMany({
      where,
      include: EVALUATION_INCLUDE,
      orderBy: [{ period: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // -- Scoring ---------------------------------------------------------------

  private normalizeScore(
    itemType: KpiItemType,
    dto: ScoreKpiItemDto,
    dropdownOptions: unknown,
  ): number {
    switch (itemType) {
      case KpiItemType.YES_NO:
        if (dto.yesNo === undefined)
          throw new BadRequestException('yesNo is required for this item.');
        return dto.yesNo ? 100 : 0;
      case KpiItemType.PERCENTAGE:
        if (dto.percentage === undefined)
          throw new BadRequestException(
            'percentage is required for this item.',
          );
        return Math.min(100, Math.max(0, dto.percentage));
      case KpiItemType.RATING_1_TO_5:
        if (dto.rating === undefined)
          throw new BadRequestException('rating is required for this item.');
        return dto.rating * 20;
      case KpiItemType.DROPDOWN: {
        if (!dto.dropdownLabel)
          throw new BadRequestException(
            'dropdownLabel is required for this item.',
          );
        const options = (dropdownOptions ?? []) as {
          label: string;
          score: number;
        }[];
        const match = options.find(
          (option) => option.label === dto.dropdownLabel,
        );
        if (!match)
          throw new BadRequestException(
            `"${dto.dropdownLabel}" is not a configured option for this item.`,
          );
        return match.score;
      }
      case KpiItemType.AUTO_METRIC:
        throw new BadRequestException(
          'AUTO_METRIC items are scored by the system, not manually.',
        );
    }
  }

  private async assertCanScore(
    evaluation: { employeeProfileId: string },
    evaluatorSource: KpiEvaluatorSource,
    userId: string,
  ) {
    if (evaluatorSource === KpiEvaluatorSource.SYSTEM) {
      throw new BadRequestException('SYSTEM items are scored automatically.');
    }
    const canApproveHr = await this.permissions.hasPermission(
      userId,
      'hr.kpi-evaluations.approve',
    );
    if (canApproveHr) return; // HR override — may score any item.

    if (evaluatorSource === KpiEvaluatorSource.MANAGER) {
      const employee = await this.prisma.employeeProfile.findUnique({
        where: { id: evaluation.employeeProfileId },
        include: { manager: { select: { userId: true } } },
      });
      if (!employee?.manager?.userId || employee.manager.userId !== userId) {
        throw new ForbiddenException(
          "Only this employee's manager may score this criterion.",
        );
      }
      return;
    }
    // evaluatorSource === HR, and the caller doesn't hold the HR approve permission.
    throw new ForbiddenException('Only HR may score this criterion.');
  }

  async scoreItem(
    evaluationId: string,
    itemId: string,
    dto: ScoreKpiItemDto,
    userId: string,
  ) {
    const evaluation = await this.findOne(evaluationId);
    if (
      evaluation.status === KpiEvaluationStatus.HR_APPROVED ||
      evaluation.status === KpiEvaluationStatus.INCLUDED_IN_PAYROLL
    ) {
      throw new BadRequestException(
        'This evaluation is locked — reopen it before editing.',
      );
    }
    const item = evaluation.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('KPI Evaluation item not found.');

    await this.assertCanScore(evaluation, item.evaluatorSourceSnapshot, userId);

    const templateItem = await this.prisma.kpiTemplateItem.findUnique({
      where: { id: item.kpiTemplateItemId },
    });
    const normalizedScore = this.normalizeScore(
      item.itemTypeSnapshot,
      dto,
      templateItem?.dropdownOptions,
    );
    if (normalizedScore < LOW_SCORE_COMMENT_THRESHOLD && !dto.comment?.trim()) {
      throw new BadRequestException(
        'أضف سبب التقييم — a reason is required for a score below 50%.',
      );
    }
    const weightedScore = (normalizedScore * Number(item.weightSnapshot)) / 100;

    await this.prisma.kpiEvaluationItem.update({
      where: { id: itemId },
      data: {
        rawValue: dto as unknown as Prisma.InputJsonValue,
        normalizedScore,
        weightedScore,
        comment: dto.comment,
        evaluatedByUserId: userId,
        evaluatedAt: new Date(),
      },
    });
    return this.findOne(evaluationId);
  }

  /** Part L — AUTO_METRIC items read live from canonical OMS data, never manually entered. Run automatically at Start and on-demand recompute. */
  async computeAutoMetrics(evaluationId: string) {
    const evaluation = await this.prisma.kpiEvaluation.findUniqueOrThrow({
      where: { id: evaluationId },
      include: { items: true },
    });
    const autoItems = evaluation.items.filter(
      (item) => item.itemTypeSnapshot === KpiItemType.AUTO_METRIC,
    );
    for (const item of autoItems) {
      const templateItem = await this.prisma.kpiTemplateItem.findUnique({
        where: { id: item.kpiTemplateItemId },
      });
      if (
        templateItem?.autoMetricSource ===
        KpiAutoMetricSource.SALES_TARGET_ACHIEVEMENT
      ) {
        const achievement = await this.salesTargets.achievementFor(
          evaluation.employeeProfileId,
          evaluation.period,
        );
        // Capped at 100 within the item (Part P) — overperformance is rewarded via Commission, not KPI.
        const normalizedScore = Math.max(
          0,
          Math.min(100, achievement.achievementPercent ?? 0),
        );
        const weightedScore =
          (normalizedScore * Number(item.weightSnapshot)) / 100;
        await this.prisma.kpiEvaluationItem.update({
          where: { id: item.id },
          data: {
            rawValue: { autoMetricValue: achievement.achievementPercent },
            normalizedScore,
            weightedScore,
            evaluatedAt: new Date(),
          },
        });
      }
    }
    return this.findOne(evaluationId);
  }

  // -- Workflow (Part M/P) ----------------------------------------------------

  async submitByManager(evaluationId: string, userId: string) {
    const evaluation = await this.findOne(evaluationId);
    if (evaluation.status !== KpiEvaluationStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT evaluation can be submitted.',
      );
    }
    const unscored = evaluation.items.filter(
      (item) =>
        item.evaluatorSourceSnapshot === KpiEvaluatorSource.MANAGER &&
        item.normalizedScore === null,
    );
    if (unscored.length) {
      throw new BadRequestException(
        'أكمل التقييم — all Manager criteria must be scored before submitting.',
      );
    }
    await this.prisma.kpiEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: KpiEvaluationStatus.MANAGER_SUBMITTED,
        managerSubmittedByUserId: userId,
        managerSubmittedAt: new Date(),
      },
    });
    return this.findOne(evaluationId);
  }

  /** Part P — final score capped at 100%; payout = kpiMaxPaySnapshot × finalScore / 100. */
  async approveByHr(evaluationId: string, userId: string) {
    const evaluation = await this.findOne(evaluationId);
    if (
      evaluation.status === KpiEvaluationStatus.HR_APPROVED ||
      evaluation.status === KpiEvaluationStatus.INCLUDED_IN_PAYROLL
    ) {
      throw new BadRequestException('This evaluation is already approved.');
    }
    const unscored = evaluation.items.filter(
      (item) => item.normalizedScore === null,
    );
    if (unscored.length) {
      throw new BadRequestException(
        'أكمل التقييم — every criterion must be scored before approval.',
      );
    }
    const finalScore = Math.min(
      100,
      evaluation.items.reduce(
        (sum, item) => sum + Number(item.weightedScore ?? 0),
        0,
      ),
    );
    const kpiPay = (Number(evaluation.kpiMaxPaySnapshot) * finalScore) / 100;

    await this.prisma.kpiEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: KpiEvaluationStatus.HR_APPROVED,
        finalScore,
        kpiPay,
        hrApprovedByUserId: userId,
        hrApprovedAt: new Date(),
        lockedAt: new Date(),
      },
    });
    await this.prisma.kpiEvaluationAuditLog.create({
      data: {
        kpiEvaluationId: evaluationId,
        action: 'HR_APPROVED',
        previousStatus: evaluation.status,
        newStatus: KpiEvaluationStatus.HR_APPROVED,
        actorUserId: userId,
      },
    });
    return this.findOne(evaluationId);
  }

  /** Part P "Locking" — reopening always requires a reason and writes an audit row; forbidden once already consumed by a Payroll Line. */
  async reopen(
    evaluationId: string,
    dto: ReopenKpiEvaluationDto,
    userId: string,
  ) {
    const evaluation = await this.findOne(evaluationId);
    if (evaluation.status === KpiEvaluationStatus.INCLUDED_IN_PAYROLL) {
      throw new BadRequestException(
        'This evaluation was already included in a Payroll Run and cannot be reopened.',
      );
    }
    if (evaluation.status !== KpiEvaluationStatus.HR_APPROVED) {
      throw new BadRequestException(
        'Only an HR_APPROVED evaluation can be reopened.',
      );
    }
    await this.prisma.kpiEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: KpiEvaluationStatus.DRAFT,
        finalScore: null,
        kpiPay: null,
        hrApprovedByUserId: null,
        hrApprovedAt: null,
        lockedAt: null,
        reopenedAt: new Date(),
        reopenReason: dto.reason,
      },
    });
    await this.prisma.kpiEvaluationAuditLog.create({
      data: {
        kpiEvaluationId: evaluationId,
        action: 'REOPENED',
        previousStatus: evaluation.status,
        newStatus: KpiEvaluationStatus.DRAFT,
        reason: dto.reason,
        actorUserId: userId,
      },
    });
    return this.findOne(evaluationId);
  }

  async auditLog(evaluationId: string) {
    return this.prisma.kpiEvaluationAuditLog.findMany({
      where: { kpiEvaluationId: evaluationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Called by the Payroll Run engine only — marks the evaluation consumed. Never called from the KPI UI directly. */
  async markIncludedInPayroll(
    evaluationId: string,
    tx: Prisma.TransactionClient,
  ) {
    await tx.kpiEvaluation.update({
      where: { id: evaluationId },
      data: { status: KpiEvaluationStatus.INCLUDED_IN_PAYROLL },
    });
  }
}
