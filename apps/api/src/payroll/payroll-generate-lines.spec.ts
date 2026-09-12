import { PayrollService } from './payroll.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 5 — `generateLines` previously queried KpiEvaluation,
 * CommissionCalculation, and CommissionAdjustment once PER employee even
 * though all three are scoped to the same `period` for the whole run. This
 * locks in the batched behavior: exactly one call to each regardless of
 * employee count, while `currentCompensation` (genuinely per-employee —
 * "latest effective revision as of date X") stays once per employee.
 */
describe('PayrollService.generateLines (via createRun) — batched period lookups', () => {
  function makeEmployees(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `emp-${i}`,
      employmentStatus: 'ACTIVE',
      deletedAt: null,
    }));
  }

  function makeService(employeeCount: number) {
    const employeesList = makeEmployees(employeeCount);
    const tx = {
      employeeProfile: { findMany: jest.fn().mockResolvedValue(employeesList) },
      kpiEvaluation: { findMany: jest.fn().mockResolvedValue([]) },
      commissionCalculation: { findMany: jest.fn().mockResolvedValue([]) },
      commissionAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      payrollLine: {
        create: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: { employeeProfileId: string } }) => ({
              id: `line-${data.employeeProfileId}`,
              ...data,
            }),
          ),
      },
      payrollLineComponent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payrollRun: {
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      payrollRun: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (t: typeof tx) => Promise<unknown>)(tx);
        }
        throw new Error('expected a callback transaction');
      }),
    };
    const currentCompensation = jest.fn().mockResolvedValue({
      basicSalary: 4000,
      lines: [],
    });
    const employees = { currentCompensation };
    const service = new PayrollService(
      prisma as unknown as PrismaService,
      employees as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 'run-1',
      lines: employeesList.map((e) => ({ id: `line-${e.id}` })),
    } as never);
    return { service, tx, currentCompensation };
  }

  it.each([1, 10, 55])(
    'calls each period-scoped lookup exactly once for %d employees',
    async (count) => {
      const { service, tx, currentCompensation } = makeService(count);
      await service.createRun({ period: '2031-01' });

      expect(tx.kpiEvaluation.findMany).toHaveBeenCalledTimes(1);
      expect(tx.commissionCalculation.findMany).toHaveBeenCalledTimes(1);
      expect(tx.commissionAdjustment.findMany).toHaveBeenCalledTimes(1);
      expect(currentCompensation).toHaveBeenCalledTimes(count);
      expect(tx.payrollLine.create).toHaveBeenCalledTimes(count);
    },
  );
});
