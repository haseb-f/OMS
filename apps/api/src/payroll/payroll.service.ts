import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollComponentType, PayrollRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { KpiEvaluationsService } from '../kpi-evaluations/kpi-evaluations.service';
import { CommissionsService } from '../commissions/commissions.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { AddPayrollLineComponentDto } from './dto/add-payroll-line-component.dto';
import { periodToDateRange } from '../common/period/period-range.util';

const RUN_INCLUDE = {
  lines: {
    include: {
      employeeProfile: { include: { partner: { select: { name: true } } } },
      components: {
        include: { payrollComponent: true },
        orderBy: { sortOrder: 'asc' as const },
      },
    },
  },
} satisfies Prisma.PayrollRunInclude;

/**
 * Part Y-AC — Monthly Payroll Runs. Combines approved KPI + approved
 * Commission + effective-dated Compensation into one balanced run, and
 * posts through the canonical PostingEngine only — never a direct
 * JournalEntry write. Idempotent by `period` (unique) and by
 * [payrollRunId, employeeProfileId] per line; KPI/Commission are marked
 * consumed only at POST time (Part AK "do not double-include"),
 * so a still-DRAFT run may be freely recalculated.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly kpiEvaluations: KpiEvaluationsService,
    private readonly commissions: CommissionsService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  // -- Generation --------------------------------------------------------

  private async generateLines(
    tx: Prisma.TransactionClient,
    runId: string,
    period: string,
  ) {
    const { start } = periodToDateRange(period);
    const employeesList = await tx.employeeProfile.findMany({
      where: { deletedAt: null, employmentStatus: 'ACTIVE' },
    });

    let grossEarnings = 0;
    let totalDeductions = 0;
    let netPay = 0;

    for (const employee of employeesList) {
      const compensation = await this.employees.currentCompensation(
        employee.id,
        start,
      );
      if (!compensation) continue; // No compensation package — not yet on Payroll.

      const evaluation = await tx.kpiEvaluation.findUnique({
        where: {
          employeeProfileId_period: { employeeProfileId: employee.id, period },
        },
      });
      const kpiPay =
        evaluation?.status === 'HR_APPROVED'
          ? Number(evaluation.kpiPay ?? 0)
          : 0;

      const commissionCalc = await tx.commissionCalculation.findUnique({
        where: {
          employeeProfileId_period: { employeeProfileId: employee.id, period },
        },
      });
      const commissionBase =
        commissionCalc?.status === 'APPROVED'
          ? Number(commissionCalc.amount)
          : 0;
      const pendingAdjustments = await tx.commissionAdjustment.findMany({
        where: {
          targetPeriod: period,
          appliedToPayrollLineId: null,
          originCommissionCalculation: { employeeProfileId: employee.id },
        },
      });
      const commission =
        commissionBase +
        pendingAdjustments.reduce((sum, a) => sum + Number(a.amountDelta), 0);

      const basicSalary = Number(compensation.basicSalary);
      let allowances = 0;
      let deductions = 0;
      for (const line of compensation.lines) {
        const amount = Number(line.amount);
        if (line.payrollComponent.type === PayrollComponentType.EARNING)
          allowances += amount;
        else deductions += amount;
      }

      const lineGross = basicSalary + kpiPay + commission + allowances;
      const lineNet = lineGross - deductions;

      const createdLine = await tx.payrollLine.create({
        data: {
          payrollRunId: runId,
          employeeProfileId: employee.id,
          basicSalary,
          kpiPay,
          commission,
          allowances,
          otherEarnings: 0,
          deductions,
          grossEarnings: lineGross,
          netPay: lineNet,
          kpiEvaluationId:
            evaluation?.status === 'HR_APPROVED' ? evaluation.id : null,
          commissionCalculationId:
            commissionCalc?.status === 'APPROVED' ? commissionCalc.id : null,
        },
      });

      const componentRows: Prisma.PayrollLineComponentCreateManyInput[] = [
        {
          payrollLineId: createdLine.id,
          label: 'الراتب الأساسي',
          type: PayrollComponentType.EARNING,
          amount: basicSalary,
          sortOrder: 0,
        },
      ];
      if (kpiPay) {
        componentRows.push({
          payrollLineId: createdLine.id,
          label: 'مؤشر الأداء (KPI)',
          type: PayrollComponentType.EARNING,
          amount: kpiPay,
          sortOrder: 1,
        });
      }
      if (commission) {
        componentRows.push({
          payrollLineId: createdLine.id,
          label: 'العمولة',
          type: PayrollComponentType.EARNING,
          amount: commission,
          sortOrder: 2,
        });
      }
      compensation.lines.forEach((line, index) => {
        componentRows.push({
          payrollLineId: createdLine.id,
          payrollComponentId: line.payrollComponentId,
          label: line.payrollComponent.nameAr,
          type: line.payrollComponent.type,
          amount: Number(line.amount),
          sortOrder: 10 + index,
        });
      });
      await tx.payrollLineComponent.createMany({ data: componentRows });

      grossEarnings += lineGross;
      totalDeductions += deductions;
      netPay += lineNet;
    }

    await tx.payrollRun.update({
      where: { id: runId },
      data: { grossEarnings, totalDeductions, netPay },
    });
  }

  /** Idempotent by period (Part AK "do not double-create Payroll lines"). */
  async createRun(dto: CreatePayrollRunDto, userId?: string) {
    const existing = await this.prisma.payrollRun.findUnique({
      where: { period: dto.period },
    });
    if (existing) return this.findOne(existing.id);

    const runId = await this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: { period: dto.period, createdBy: userId ?? null },
      });
      await this.generateLines(tx, run.id, dto.period);
      return run.id;
    });
    return this.findOne(runId);
  }

  /** Only a DRAFT run may be recalculated — regenerates every line from scratch, safe because nothing is consumed (KPI/Commission marked included) until POST. */
  async recalculate(runId: string) {
    const run = await this.findRaw(runId);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT Payroll Run can be recalculated.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });
      await this.generateLines(tx, runId, run.period);
    });
    return this.findOne(runId);
  }

  private async findRaw(id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll Run not found.');
    return run;
  }

  async findOne(id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: RUN_INCLUDE,
    });
    if (!run) throw new NotFoundException('Payroll Run not found.');
    return run;
  }

  async findAll() {
    return this.prisma.payrollRun.findMany({ orderBy: { period: 'desc' } });
  }

  // -- Line-level ad hoc components (Part H one-off deductions/bonuses) ----

  async addLineComponent(lineId: string, dto: AddPayrollLineComponentDto) {
    const line = await this.prisma.payrollLine.findUniqueOrThrow({
      where: { id: lineId },
      include: { payrollRun: true },
    });
    if (line.payrollRun.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        'Line components can only be added while the Payroll Run is DRAFT.',
      );
    }
    const component = await this.prisma.payrollComponent.findFirst({
      where: { id: dto.payrollComponentId },
    });
    if (!component || component.deletedAt || !component.isActive) {
      throw new BadRequestException(
        'Archived or inactive Payroll Components cannot be added.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollLineComponent.create({
        data: {
          payrollLineId: lineId,
          payrollComponentId: component.id,
          label: component.nameAr,
          type: component.type,
          amount: dto.amount,
          sortOrder: 99,
        },
      });
      await tx.payrollLine.update({
        where: { id: lineId },
        data:
          component.type === PayrollComponentType.EARNING
            ? {
                allowances: { increment: dto.amount },
                grossEarnings: { increment: dto.amount },
                netPay: { increment: dto.amount },
              }
            : {
                deductions: { increment: dto.amount },
                netPay: { decrement: dto.amount },
              },
      });
      await tx.payrollRun.update({
        where: { id: line.payrollRunId },
        data:
          component.type === PayrollComponentType.EARNING
            ? {
                grossEarnings: { increment: dto.amount },
                netPay: { increment: dto.amount },
              }
            : {
                totalDeductions: { increment: dto.amount },
                netPay: { decrement: dto.amount },
              },
      });
    });
    return this.findOne(line.payrollRunId);
  }

  // -- Workflow (Part Y "keep it simple") ----------------------------------

  async hrReview(runId: string, userId: string) {
    const run = await this.findRaw(runId);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT Payroll Run can be HR-reviewed.',
      );
    }
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: PayrollRunStatus.HR_REVIEWED,
        hrReviewedByUserId: userId,
        hrReviewedAt: new Date(),
      },
    });
    return this.findOne(runId);
  }

  async financeApprove(runId: string, userId: string) {
    const run = await this.findRaw(runId);
    if (run.status !== PayrollRunStatus.HR_REVIEWED) {
      throw new BadRequestException(
        'Only an HR_REVIEWED Payroll Run can be Finance-approved.',
      );
    }
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        status: PayrollRunStatus.FINANCE_APPROVED,
        financeApprovedByUserId: userId,
        financeApprovedAt: new Date(),
      },
    });
    return this.findOne(runId);
  }

  /** Part AA "Payroll Freeze" — posting locks calculation for good; KPI/Commission rows are marked consumed here, not before. */
  async post(runId: string, userId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: { lines: true },
    });
    if (!run) throw new NotFoundException('Payroll Run not found.');
    if (run.status !== PayrollRunStatus.FINANCE_APPROVED) {
      throw new BadRequestException(
        'Only a FINANCE_APPROVED Payroll Run can be posted.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const line of run.lines) {
        if (line.kpiEvaluationId) {
          await this.kpiEvaluations.markIncludedInPayroll(
            line.kpiEvaluationId,
            tx,
          );
        }
        if (line.commissionCalculationId) {
          await this.commissions.markIncludedInPayroll(
            line.commissionCalculationId,
            tx,
          );
          const adjustments = await tx.commissionAdjustment.findMany({
            where: {
              targetPeriod: run.period,
              appliedToPayrollLineId: null,
              originCommissionCalculation: {
                employeeProfileId: line.employeeProfileId,
              },
            },
          });
          for (const adjustment of adjustments) {
            await this.commissions.markAdjustmentApplied(
              adjustment.id,
              line.id,
              tx,
            );
          }
        }
      }
      await this.postingEngine.post('PAYROLL_RUN', runId, userId, tx);
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.POSTED,
          postedByUserId: userId,
          postedAt: new Date(),
        },
      });
    });
    return this.findOne(runId);
  }

  /** Part AB — payment is a distinct event from accrual/posting. */
  async pay(runId: string, userId: string) {
    const run = await this.findRaw(runId);
    if (run.status !== PayrollRunStatus.POSTED) {
      throw new BadRequestException(
        'Only a POSTED Payroll Run can be marked Paid.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.postingEngine.post('PAYROLL_PAYMENT', runId, userId, tx);
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.PAID,
          paidByUserId: userId,
          paidAt: new Date(),
        },
      });
    });
    return this.findOne(runId);
  }
}
