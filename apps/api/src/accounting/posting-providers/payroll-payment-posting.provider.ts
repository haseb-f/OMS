import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Payroll payment posting (Part AB) — a SEPARATE entry from accrual,
 * posted only when HR/Finance marks the Payroll Run as Paid. Never
 * confused with Payroll Approval/Post (which only accrues the payable).
 *
 * Dr Payroll Payable   Σ netPay
 * Cr Bank              Σ netPay
 */
@Injectable()
export class PayrollPaymentPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['PAYROLL_PAYMENT'];

  constructor(
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
      include: { lines: true },
    });
    const netPay = run.lines.reduce(
      (sum, line) => sum + Number(line.netPay),
      0,
    );
    if (netPay <= 0) return null;

    const lines: PostingLine[] = [
      {
        accountId: await this.accountMapping.resolvePayrollPayableAccount(tx),
        debit: netPay,
        description: `Payroll ${run.period} — Payment`,
      },
      {
        accountId: await this.accountMapping.resolveBankAccount(tx),
        credit: netPay,
        description: `Payroll ${run.period} — Payment`,
      },
    ];

    return {
      lines,
      description: `Payroll Payment ${run.period}`,
      referenceNumber: run.period,
    };
  }
}
