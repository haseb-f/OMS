import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import {
  CommissionAssignmentScope,
  CommissionRuleType,
  KpiAssignmentScope,
  KpiEvaluatorSource,
  KpiItemType,
  PayrollComponentType,
  PayrollRunStatus,
  TargetMetric,
  TargetScopeType,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollModule } from './payroll.module';
import { PayrollService } from './payroll.service';
import { EmployeesService } from '../employees/employees.service';
import { KpiTemplatesService } from '../kpi-templates/kpi-templates.service';
import { KpiEvaluationsService } from '../kpi-evaluations/kpi-evaluations.service';
import { SalesTargetsService } from '../sales-targets/sales-targets.service';
import { CommissionPlansService } from '../commission-plans/commission-plans.service';
import { CommissionsService } from '../commissions/commissions.service';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';

/**
 * HR Milestone 1 — Required End-to-End Business Scenario (recovery-session
 * acceptance test, Part 21 of the recovery brief). Chains through every
 * canonical service exactly as a real HR/Manager/Sales Manager/Finance user
 * would — nothing is faked directly into Payroll, every figure below is
 * produced by the module that owns it:
 *
 *   Basic Salary            4,000  (Compensation)
 *   Allowance (+)             500  (Compensation line, EARNING)
 *   Deduction (-)             200  (Compensation line, DEDUCTION)
 *   KPI Maximum Pay          1,000  (Compensation)
 *   Monthly Target         100,000  (Sales Targets, COLLECTED_SALES)
 *   Actual Collected Sales   82,500  (a VERIFIED Payment on a StoreOrder
 *                                     attributed to the employee's User —
 *                                     the one canonical source Sales
 *                                     Targets/Commission both read)
 *   -> Achievement                82.5%
 *   KPI Score (manual, PERCENTAGE item)  82%  -> KPI Pay = 1,000 × 82% = 820
 *   Commission tier 80–99.99% = 1%       -> Commission = 82,500 × 1% = 825
 *   Expected Payroll Net = 4,000 + 500 + 820 + 825 − 200 = 5,945
 */
describe('HR Milestone 1 — Employee -> KPI -> Target -> Commission -> Payroll -> Finance', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payroll: PayrollService;
  let employees: EmployeesService;
  let kpiTemplates: KpiTemplatesService;
  let kpiEvaluations: KpiEvaluationsService;
  let salesTargets: SalesTargetsService;
  let commissionPlans: CommissionPlansService;
  let commissions: CommissionsService;

  const prefix = `HRE2E-${randomUUID().slice(0, 6)}`;
  const period = '2026-01';
  const periodStart = new Date(Date.UTC(2026, 0, 1));
  const compensationEffectiveFrom = new Date(Date.UTC(2025, 11, 1));

  let departmentId: string;
  let earningComponentId: string;
  let deductionComponentId: string;
  let managerUserId: string;
  let managerEmployeeId: string;
  let employeeId: string;
  let employeeUserId: string;
  let customerPartnerId: string;
  let storeOrderId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PayrollModule,
        PostingProvidersModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    payroll = moduleRef.get(PayrollService);
    employees = moduleRef.get(EmployeesService);
    kpiTemplates = moduleRef.get(KpiTemplatesService);
    kpiEvaluations = moduleRef.get(KpiEvaluationsService);
    salesTargets = moduleRef.get(SalesTargetsService);
    commissionPlans = moduleRef.get(CommissionPlansService);
    commissions = moduleRef.get(CommissionsService);

    // -- Reference data --------------------------------------------------
    const department = await prisma.department.create({
      data: { code: `${prefix}-DEPT`, name: 'Test Sales Dept' },
    });
    departmentId = department.id;

    const earning = await prisma.payrollComponent.create({
      data: { nameAr: `${prefix} بدل`, type: PayrollComponentType.EARNING },
    });
    earningComponentId = earning.id;
    const deduction = await prisma.payrollComponent.create({
      data: { nameAr: `${prefix} خصم`, type: PayrollComponentType.DEDUCTION },
    });
    deductionComponentId = deduction.id;

    // -- Manager (scores the MANAGER-source KPI item) ---------------------
    const managerUser = await prisma.user.create({
      data: {
        email: `${prefix}-manager@example.test`,
        username: `${prefix}-manager`,
        fullName: 'Test Manager',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    managerUserId = managerUser.id;
    const managerEmployee = await employees.create({
      name: 'Test Manager Employee',
      departmentId,
    });
    managerEmployeeId = managerEmployee.id;
    await prisma.employeeProfile.update({
      where: { id: managerEmployeeId },
      data: { userId: managerUserId },
    });

    // -- The Sales Employee under test ------------------------------------
    const employeeUser = await prisma.user.create({
      data: {
        email: `${prefix}-employee@example.test`,
        username: `${prefix}-employee`,
        fullName: 'Test Sales Employee',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    employeeUserId = employeeUser.id;
    const employee = await employees.create({
      name: 'Test Sales Employee',
      departmentId,
      managerEmployeeId,
    });
    employeeId = employee.id;
    await prisma.employeeProfile.update({
      where: { id: employeeId },
      data: { userId: employeeUserId },
    });

    // -- Compensation: 4,000 basic, 1,000 KPI max, +500 / -200 -------------
    await employees.recordCompensation(employeeId, {
      effectiveFrom: compensationEffectiveFrom.toISOString(),
      basicSalary: 4000,
      kpiMaxPay: 1000,
      lines: [
        { payrollComponentId: earningComponentId, amount: 500 },
        { payrollComponentId: deductionComponentId, amount: 200 },
      ],
    });

    // -- Actual Collected Sales: a VERIFIED Payment on a StoreOrder --------
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const paymentSource = await prisma.paymentSource.findFirstOrThrow({
      where: { deletedAt: null, isActive: true },
    });
    const receivingAccount = await prisma.receivingAccount.findFirstOrThrow({
      where: { deletedAt: null, isActive: true },
    });
    const customerPartner = await prisma.partner.create({
      data: { partnerNumber: `${prefix}-CUST`, name: 'Test Customer' },
    });
    customerPartnerId = customerPartner.id;
    const storeOrder = await prisma.storeOrder.create({
      data: {
        internalOrderId: `${prefix}-ORD-1`,
        partnerId: customerPartnerId,
        currencyId: currency.id,
        employeeId: employeeUserId,
        orderDate: periodStart,
      },
    });
    storeOrderId = storeOrder.id;
    await prisma.payment.create({
      data: {
        paymentNumber: `${prefix}-PAY-1`,
        storeOrderId,
        paymentDate: periodStart,
        amount: 82500,
        currencyId: currency.id,
        paymentSourceId: paymentSource.id,
        receivingAccountId: receivingAccount.id,
        senderName: 'Test Customer',
        status: 'VERIFIED',
      },
    });
  });

  afterAll(async () => {
    await prisma.payrollLineComponent.deleteMany({
      where: { payrollLine: { employeeProfileId: employeeId } },
    });
    await prisma.payrollLine.deleteMany({
      where: { employeeProfileId: employeeId },
    });
    await prisma.payrollRun.deleteMany({ where: { period } });
    await prisma.commissionAdjustment.deleteMany({
      where: { originCommissionCalculation: { employeeProfileId: employeeId } },
    });
    await prisma.commissionCalculation.deleteMany({
      where: { employeeProfileId: employeeId },
    });
    await prisma.commissionPlanAssignment.deleteMany({
      where: { employeeProfileId: employeeId },
    });
    await prisma.commissionPlanTier.deleteMany({
      where: { commissionPlan: { name: { startsWith: prefix } } },
    });
    await prisma.commissionPlan.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.kpiEvaluationAuditLog.deleteMany({
      where: { kpiEvaluation: { employeeProfileId: employeeId } },
    });
    await prisma.kpiEvaluationItem.deleteMany({
      where: { kpiEvaluation: { employeeProfileId: employeeId } },
    });
    await prisma.kpiEvaluation.deleteMany({
      where: { employeeProfileId: employeeId },
    });
    await prisma.kpiTemplateAssignment.deleteMany({
      where: { kpiTemplate: { name: { startsWith: prefix } } },
    });
    await prisma.kpiTemplateItem.deleteMany({
      where: { kpiTemplate: { name: { startsWith: prefix } } },
    });
    await prisma.kpiTemplate.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.salesTarget.deleteMany({
      where: { employeeProfileId: employeeId },
    });
    await prisma.payment.deleteMany({
      where: { paymentNumber: { startsWith: prefix } },
    });
    await prisma.storeOrder.deleteMany({
      where: { internalOrderId: { startsWith: prefix } },
    });
    await prisma.partner
      .delete({ where: { id: customerPartnerId } })
      .catch(() => undefined);
    await prisma.compensationRevisionLine.deleteMany({
      where: {
        compensationRevision: {
          employeeProfileId: { in: [employeeId, managerEmployeeId] },
        },
      },
    });
    await prisma.compensationRevision.deleteMany({
      where: { employeeProfileId: { in: [employeeId, managerEmployeeId] } },
    });
    const employeePartnerIds = (
      await prisma.employeeProfile.findMany({
        where: { id: { in: [employeeId, managerEmployeeId] } },
        select: { partnerId: true },
      })
    ).map((e) => e.partnerId);
    // Child (references managerEmployeeId) before parent — avoids relying on
    // same-statement self-FK resolution.
    await prisma.employeeProfile
      .delete({ where: { id: employeeId } })
      .catch(() => undefined);
    await prisma.employeeProfile
      .delete({ where: { id: managerEmployeeId } })
      .catch(() => undefined);
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: employeePartnerIds } },
    });
    await prisma.partner.deleteMany({
      where: { id: { in: employeePartnerIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [managerUserId, employeeUserId] } },
    });
    await prisma.payrollComponent.deleteMany({
      where: { id: { in: [earningComponentId, deductionComponentId] } },
    });
    await prisma.department
      .delete({ where: { id: departmentId } })
      .catch(() => undefined);
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('flows Target -> Commission correctly from the canonical VERIFIED-payment source', async () => {
    await salesTargets.create({
      period,
      scopeType: TargetScopeType.EMPLOYEE,
      employeeProfileId: employeeId,
      metric: TargetMetric.COLLECTED_SALES,
      targetAmount: 100000,
    });

    const achievement = await salesTargets.achievementFor(employeeId, period);
    expect(achievement.targetAmount).toBe(100000);
    expect(achievement.actual).toBe(82500);
    expect(achievement.achievementPercent).toBeCloseTo(82.5, 5);

    const ranking = await salesTargets.ranking(period);
    const mine = ranking.leaderboard.find(
      (row) => row.employeeProfileId === employeeId,
    );
    expect(mine).toBeDefined();
    expect(mine!.achievementPercent).toBeCloseTo(82.5, 5);
  });

  it('computes KPI Pay = KPI Max × Final Score, capped at 100%', async () => {
    const template = await kpiTemplates.create({
      name: `${prefix} KPI Template`,
      items: [
        {
          criterionAr: 'تحقيق المبيعات',
          weight: 100,
          itemType: KpiItemType.PERCENTAGE,
          evaluatorSource: KpiEvaluatorSource.MANAGER,
        },
      ],
    });
    await kpiTemplates.assign(template.id, {
      scope: KpiAssignmentScope.EMPLOYEE,
      employeeProfileId: employeeId,
    });

    const started = await kpiEvaluations.start({
      employeeProfileId: employeeId,
      period,
    });
    expect(started.status).toBe('DRAFT');
    expect(started.kpiMaxPaySnapshot.toString()).toBe('1000');
    expect(started.items).toHaveLength(1);

    const itemId = started.items[0].id;
    await kpiEvaluations.scoreItem(
      started.id,
      itemId,
      { percentage: 82 },
      managerUserId,
    );
    const submitted = await kpiEvaluations.submitByManager(
      started.id,
      managerUserId,
    );
    expect(submitted.status).toBe('MANAGER_SUBMITTED');

    const approved = await kpiEvaluations.approveByHr(
      started.id,
      managerUserId,
    );
    expect(approved.status).toBe('HR_APPROVED');
    expect(Number(approved.finalScore)).toBeCloseTo(82, 5);
    expect(Number(approved.kpiPay)).toBeCloseTo(820, 5);
  });

  it('resolves the Commission Engine tier (80–99.99% = 1%) from real achievement, not a manual entry', async () => {
    const plan = await commissionPlans.create({
      name: `${prefix} Commission Plan`,
      ruleType: CommissionRuleType.ACHIEVEMENT_TIER,
      tiers: [
        { minAchievementPercent: 0, maxAchievementPercent: 80, percentage: 0 },
        {
          minAchievementPercent: 80,
          maxAchievementPercent: 100,
          percentage: 1,
        },
        {
          minAchievementPercent: 100,
          maxAchievementPercent: 120,
          percentage: 2,
        },
        { minAchievementPercent: 120, percentage: 3 },
      ],
    });
    await commissionPlans.assign(plan.id, {
      scope: CommissionAssignmentScope.EMPLOYEE,
      employeeProfileId: employeeId,
    });

    const calculated = await commissions.calculate({
      employeeProfileId: employeeId,
      period,
    });
    expect(calculated).not.toBeNull();
    expect(Number(calculated!.basisAmount)).toBe(82500);
    expect(Number(calculated!.achievementPercent)).toBeCloseTo(82.5, 5);
    expect(Number(calculated!.amount)).toBeCloseTo(825, 5);

    const approved = await commissions.approve(calculated!.id, managerUserId);
    expect(approved.status).toBe('APPROVED');
  });

  it('builds the Payroll Run line purely from the approved KPI/Commission/Compensation rows, and posts through the Posting Engine', async () => {
    const run = await payroll.createRun({ period });
    const myLine = run.lines.find(
      (line) => line.employeeProfileId === employeeId,
    );
    expect(myLine).toBeDefined();

    expect(Number(myLine!.basicSalary)).toBe(4000);
    expect(Number(myLine!.kpiPay)).toBeCloseTo(820, 5);
    expect(Number(myLine!.commission)).toBeCloseTo(825, 5);
    expect(Number(myLine!.allowances)).toBe(500);
    expect(Number(myLine!.deductions)).toBe(200);
    expect(Number(myLine!.grossEarnings)).toBeCloseTo(
      4000 + 820 + 825 + 500,
      5,
    );
    // 4,000 + 500 + 820 + 825 − 200 = 5,945 (Part 21's required scenario).
    expect(Number(myLine!.netPay)).toBeCloseTo(5945, 5);

    const reviewed = await payroll.hrReview(run.id, managerUserId);
    expect(reviewed.status).toBe(PayrollRunStatus.HR_REVIEWED);
    const financeApproved = await payroll.financeApprove(run.id, managerUserId);
    expect(financeApproved.status).toBe(PayrollRunStatus.FINANCE_APPROVED);

    const posted = await payroll.post(run.id, managerUserId);
    expect(posted.status).toBe(PayrollRunStatus.POSTED);
    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'PAYROLL_RUN', sourceId: run.id },
      include: { lines: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe('POSTED');
    const totalDebit = entry!.lines.reduce(
      (sum, l) => sum + Number(l.debit),
      0,
    );
    const totalCredit = entry!.lines.reduce(
      (sum, l) => sum + Number(l.credit),
      0,
    );
    expect(totalDebit).toBeCloseTo(totalCredit, 5);

    // POSTED consumes the KPI Evaluation and Commission Calculation — never
    // double-included in a later run (Part AK).
    const kpiEval = await prisma.kpiEvaluation.findUnique({
      where: {
        employeeProfileId_period: { employeeProfileId: employeeId, period },
      },
    });
    expect(kpiEval!.status).toBe('INCLUDED_IN_PAYROLL');
    const commissionCalc = await prisma.commissionCalculation.findUnique({
      where: {
        employeeProfileId_period: { employeeProfileId: employeeId, period },
      },
    });
    expect(commissionCalc!.status).toBe('INCLUDED_IN_PAYROLL');

    const paid = await payroll.pay(run.id, managerUserId);
    expect(paid.status).toBe(PayrollRunStatus.PAID);
    const paymentEntry = await prisma.journalEntry.findFirst({
      where: { sourceType: 'PAYROLL_PAYMENT', sourceId: run.id },
    });
    expect(paymentEntry).not.toBeNull();
  });
});
