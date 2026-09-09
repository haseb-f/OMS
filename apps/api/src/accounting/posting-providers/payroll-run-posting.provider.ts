import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Payroll Run accrual posting (Part AB/AC) — one balanced entry per Payroll
 * Run, posted once on Finance's Post action (never on Approve, per the
 * milestone's PostingEngine-only rule).
 *
 * Dr Salary Expense            Σ basicSalary
 * Dr KPI Expense                Σ kpiPay
 * Dr Commission Expense         Σ commission
 * Dr [Allowance accounts]       Σ EARNING components, grouped by resolved account
 * Cr [Deduction accounts]       Σ DEDUCTION components, grouped by resolved account
 * Cr Payroll Payable            Σ netPay (gross - deductions)
 *
 * Every account is resolved through AccountMappingService (component-level
 * override, falling back to PostingSettings) — never hardcoded.
 */
@Injectable()
export class PayrollRunPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PAYROLL_RUN'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const run = await tx.payrollRun.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        lines: {
          include: { components: { include: { payrollComponent: true } } },
        },
      },
    });
    if (run.lines.length === 0) return null;

    const lines: PostingLine[] = [];

    const totalBasic = run.lines.reduce(
      (sum, line) => sum + Number(line.basicSalary),
      0,
    );
    const totalKpi = run.lines.reduce(
      (sum, line) => sum + Number(line.kpiPay),
      0,
    );
    const totalCommission = run.lines.reduce(
      (sum, line) => sum + Number(line.commission),
      0,
    );

    if (totalBasic > 0) {
      lines.push({
        accountId: await this.accountMapping.resolveSalaryExpenseAccount(tx),
        debit: totalBasic,
        description: `Payroll ${run.period} — Basic Salary`,
      });
    }
    if (totalKpi > 0) {
      lines.push({
        accountId: await this.accountMapping.resolveKpiExpenseAccount(tx),
        debit: totalKpi,
        description: `Payroll ${run.period} — KPI`,
      });
    }
    if (totalCommission > 0) {
      lines.push({
        accountId:
          await this.accountMapping.resolveCommissionExpenseAccount(tx),
        debit: totalCommission,
        description: `Payroll ${run.period} — Commission`,
      });
    }

    const allowanceByAccount = new Map<string, number>();
    const deductionByAccount = new Map<string, number>();
    for (const line of run.lines) {
      for (const component of line.components) {
        if (!component.payrollComponentId) continue; // Basic/KPI/Commission synthetic rows, already totaled above.
        const amount = Number(component.amount);
        if (amount === 0) continue;
        if (component.type === 'EARNING') {
          const accountId =
            await this.accountMapping.resolveAllowanceExpenseAccount(
              component.payrollComponent?.accountingMappingAccountId ?? null,
              tx,
            );
          allowanceByAccount.set(
            accountId,
            (allowanceByAccount.get(accountId) ?? 0) + amount,
          );
        } else {
          const accountId = await this.accountMapping.resolveDeductionAccount(
            component.payrollComponent?.accountingMappingAccountId ?? null,
            tx,
          );
          deductionByAccount.set(
            accountId,
            (deductionByAccount.get(accountId) ?? 0) + amount,
          );
        }
      }
    }
    for (const [accountId, amount] of allowanceByAccount) {
      lines.push({
        accountId,
        debit: amount,
        description: `Payroll ${run.period} — Allowances`,
      });
    }
    for (const [accountId, amount] of deductionByAccount) {
      lines.push({
        accountId,
        credit: amount,
        description: `Payroll ${run.period} — Deductions`,
      });
    }

    const netPay = run.lines.reduce(
      (sum, line) => sum + Number(line.netPay),
      0,
    );
    if (netPay > 0) {
      lines.push({
        accountId: await this.accountMapping.resolvePayrollPayableAccount(tx),
        credit: netPay,
        description: `Payroll ${run.period} — Payable`,
      });
    }

    return {
      lines,
      description: `Payroll Run ${run.period}`,
      referenceNumber: run.period,
    };
  }
}
