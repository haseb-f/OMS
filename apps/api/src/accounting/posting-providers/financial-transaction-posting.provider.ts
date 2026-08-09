import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Financial Transaction Posting Provider (TASK-046/047) — one provider
 * handling both Customer Receipt and Supplier Payment (the same split the
 * `FinancialTransaction` table itself uses via its `type` column).
 *
 * Customer Receipt:  Dr Bank/Cash            Cr Accounts Receivable
 * Supplier Payment:  Dr Accounts Payable     Cr Bank/Cash
 *
 * The Bank/Cash account is always `ReceivingAccount.chartOfAccountId` — the
 * one already-required, already-real account this codebase resolves
 * "where did the money actually go" through (TASK-043); it is more
 * specific than the global Cash/Bank Accounting Settings defaults, so it
 * is not replaced by them. AR/AP resolve via `AccountMappingService`
 * (Customer/Supplier → their Group → Accounting Settings).
 */
@Injectable()
export class FinancialTransactionPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = ['CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const transaction = await tx.financialTransaction.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        customer: { select: { id: true } },
        supplier: { select: { id: true } },
        receivingAccount: { select: { chartOfAccountId: true } },
      },
    });
    const amount = Number(transaction.amount);
    if (amount === 0) return null;

    // A plain user-input mistake, not a system fault — must surface as a clean 400,
    // never an unhandled 500 (a `throw new Error` here was previously swallowed by
    // Nest's default filter into an opaque "Internal server error").
    if (!transaction.receivingAccount?.chartOfAccountId) {
      throw new BadRequestException(
        `Select a Payment Source / Receiving Account (Cash or Bank) before confirming ${transaction.transactionNumber} — the Posting Engine needs it to know which account to debit or credit.`,
      );
    }
    const bankAccountId = transaction.receivingAccount.chartOfAccountId;

    if (sourceType === 'CUSTOMER_RECEIPT') {
      const arAccountId = await this.accountMapping.resolveReceivableAccount(
        transaction.customer!.id,
        tx,
      );
      return {
        lines: [
          {
            accountId: bankAccountId,
            debit: amount,
            description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
          },
          {
            accountId: arAccountId,
            credit: amount,
            description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
          },
        ],
        description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
        referenceNumber: transaction.transactionNumber,
        currencyId: transaction.currencyId,
        companyId: transaction.companyId,
        branchId: transaction.branchId,
        costCenterId: transaction.costCenterId,
        projectId: transaction.projectId,
      };
    }

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      transaction.supplier!.id,
      tx,
    );
    return {
      lines: [
        {
          accountId: apAccountId,
          debit: amount,
          description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
        },
        {
          accountId: bankAccountId,
          credit: amount,
          description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
        },
      ],
      description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
      referenceNumber: transaction.transactionNumber,
      currencyId: transaction.currencyId,
      companyId: transaction.companyId,
      branchId: transaction.branchId,
      costCenterId: transaction.costCenterId,
      projectId: transaction.projectId,
    };
  }
}
