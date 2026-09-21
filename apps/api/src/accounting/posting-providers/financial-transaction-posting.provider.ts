import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import { snapshotDocumentExchangeRate } from '../fx/snapshot-document-rate';
import type {
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';

/**
 * Financial Transaction Posting Provider (TASK-046/047, extended by the
 * Cash Flow module for Expense) — one provider handling Customer Receipt,
 * Supplier Payment, and Expense Payment (the same split the
 * `FinancialTransaction` table itself uses via its `type` column).
 *
 * Customer Receipt:  Dr Bank/Cash            Cr Accounts Receivable
 * Supplier Payment:  Dr Accounts Payable     Cr Bank/Cash
 * Expense Payment:   Dr expenseAccountId     Cr Bank/Cash
 *
 * The Bank/Cash account is always `ReceivingAccount.chartOfAccountId` — the
 * one already-required, already-real account this codebase resolves
 * "where did the money actually go" through (TASK-043); it is more
 * specific than the global Cash/Bank Accounting Settings defaults, so it
 * is not replaced by them. AR/AP resolve via `AccountMappingService`
 * (Customer/Supplier → their Group → Accounting Settings); Expense debits
 * the transaction's own `expenseAccountId` directly — never AP, never a
 * resolved default — since an Expense Payment Voucher has no party.
 */
@Injectable()
export class FinancialTransactionPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [
    'CUSTOMER_RECEIPT',
    'SUPPLIER_PAYMENT',
    'EXPENSE_PAYMENT',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
    private readonly exchangeRates: ExchangeRatesService,
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
        partner: { select: { id: true } },
        receivingAccount: { select: { chartOfAccountId: true } },
        allocations: {
          include: {
            salesInvoice: {
              select: { id: true, exchangeRate: true, currencyId: true },
            },
            purchaseInvoice: {
              select: { id: true, exchangeRate: true, currencyId: true },
            },
          },
        },
      },
    });
    const payRate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (rate) =>
        tx.financialTransaction.update({
          where: { id: transaction.id },
          data: { exchangeRate: rate },
        }),
      transaction.currencyId,
      transaction.exchangeRate,
      transaction.confirmedAt ?? transaction.transactionDate,
    );
    if (sourceType === 'EXPENSE_PAYMENT') {
      const amount = Number(transaction.amount);
      if (amount === 0) return null;
      if (!transaction.receivingAccount?.chartOfAccountId) {
        throw new BadRequestException(
          `Select a Payment Source / Receiving Account (Cash or Bank) before confirming ${transaction.transactionNumber} — the Posting Engine needs it to know which account to credit.`,
        );
      }
      if (!transaction.expenseAccountId) {
        throw new BadRequestException(
          `Select an Expense account before confirming ${transaction.transactionNumber}.`,
        );
      }
      return {
        lines: [
          {
            accountId: transaction.expenseAccountId,
            debit: amount,
            description: `Expense Payment Voucher ${transaction.transactionNumber}`,
          },
          {
            accountId: transaction.receivingAccount.chartOfAccountId,
            credit: amount,
            description: `Expense Payment Voucher ${transaction.transactionNumber}`,
          },
        ],
        description: `Expense Payment Voucher ${transaction.transactionNumber}`,
        referenceNumber: transaction.transactionNumber,
        currencyId: transaction.currencyId,
        exchangeRate: payRate,
        companyId: transaction.companyId,
        branchId: transaction.branchId,
        costCenterId: transaction.costCenterId,
        projectId: transaction.projectId,
        entryDate: transaction.confirmedAt ?? transaction.transactionDate,
      };
    }
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
        transaction.partner!.id,
        tx,
      );
      // Net-receipt / bank-fee settlement (Part G) — the bank kept
      // `feeAmount`, so the invoice(s) still clear their full
      // `amount + feeAmount` while only `amount` actually moved through
      // the bank account; the difference debits `feeAccountId` (a Bank
      // Fees/Adjustment expense), never inflating the cash receipt.
      const feeAmount = Number(transaction.feeAmount ?? 0);
      const cashFunctional = this.round2(amount * payRate);
      const feeFunctional = this.round2(feeAmount * payRate);
      // AR clears the full settled value (cash + fee) exactly once; only a
      // genuine rate difference between invoice and receipt is realized FX.
      const arFunctional = this.clearedFunctional(
        transaction.allocations,
        'sales',
        amount + feeAmount,
        payRate,
      );
      const fx = this.round2(cashFunctional + feeFunctional - arFunctional);
      const lines = [
        {
          accountId: bankAccountId,
          debit: cashFunctional,
          description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
        },
        {
          accountId: arAccountId,
          credit: arFunctional,
          description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
          partnerId: transaction.partner!.id,
        },
      ];
      if (feeFunctional > 0) {
        if (!transaction.feeAccountId) {
          throw new BadRequestException(
            `Select a Bank Fee account before confirming ${transaction.transactionNumber} — a settlement fee was recorded but no fee account is set.`,
          );
        }
        lines.push({
          accountId: transaction.feeAccountId,
          debit: feeFunctional,
          description: `Bank Fee — Customer Receipt Voucher ${transaction.transactionNumber}`,
        });
      }
      await this.pushRealizedFx(
        lines,
        fx,
        `Customer Receipt Voucher ${transaction.transactionNumber}`,
        tx,
      );
      return {
        lines,
        description: `Customer Receipt Voucher ${transaction.transactionNumber}`,
        referenceNumber: transaction.transactionNumber,
        currencyId: transaction.currencyId,
        companyId: transaction.companyId,
        branchId: transaction.branchId,
        costCenterId: transaction.costCenterId,
        projectId: transaction.projectId,
        entryDate: transaction.confirmedAt ?? transaction.transactionDate,
      };
    }

    const apAccountId = await this.accountMapping.resolvePayableAccount(
      transaction.partner!.id,
      tx,
    );
    const cashFunctional = this.round2(amount * payRate);
    const apFunctional = this.clearedFunctional(
      transaction.allocations,
      'purchase',
      amount,
      payRate,
    );
    const fx = this.round2(apFunctional - cashFunctional);
    const lines = [
      {
        accountId: apAccountId,
        debit: apFunctional,
        description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
        partnerId: transaction.partner!.id,
      },
      {
        accountId: bankAccountId,
        credit: cashFunctional,
        description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
      },
    ];
    await this.pushRealizedFx(
      lines,
      fx,
      `Supplier Payment Voucher ${transaction.transactionNumber}`,
      tx,
    );
    return {
      lines,
      description: `Supplier Payment Voucher ${transaction.transactionNumber}`,
      referenceNumber: transaction.transactionNumber,
      currencyId: transaction.currencyId,
      companyId: transaction.companyId,
      branchId: transaction.branchId,
      costCenterId: transaction.costCenterId,
      projectId: transaction.projectId,
      entryDate: transaction.confirmedAt ?? transaction.transactionDate,
    };
  }

  private round2(value: number) {
    return Math.round(value * 100) / 100;
  }

  private clearedFunctional(
    allocations: Array<{
      allocatedAmount: unknown;
      salesInvoice: { exchangeRate: unknown } | null;
      purchaseInvoice: { exchangeRate: unknown } | null;
    }>,
    side: 'sales' | 'purchase',
    transactionAmount: number,
    payRate: number,
  ) {
    if (allocations.length === 0) {
      return this.round2(transactionAmount * payRate);
    }
    let functional = 0;
    let allocatedTx = 0;
    for (const allocation of allocations) {
      const invoice =
        side === 'sales' ? allocation.salesInvoice : allocation.purchaseInvoice;
      const invRate =
        invoice?.exchangeRate != null ? Number(invoice.exchangeRate) : payRate;
      const allocated = Number(allocation.allocatedAmount);
      functional += this.round2(allocated * invRate);
      allocatedTx += allocated;
    }
    const remainder = this.round2(transactionAmount - allocatedTx);
    if (remainder > 0) functional += this.round2(remainder * payRate);
    return this.round2(functional);
  }

  private async pushRealizedFx(
    lines: Array<{
      accountId: string;
      debit?: number;
      credit?: number;
      description?: string;
      partnerId?: string;
    }>,
    fx: number,
    description: string,
    tx: Prisma.TransactionClient,
  ) {
    if (Math.abs(fx) < 0.01) return;
    const accountId =
      await this.accountMapping.resolveExchangeDifferenceAccount(tx);
    if (fx > 0) {
      lines.push({
        accountId,
        credit: fx,
        description: `Realized FX — ${description}`,
      });
    } else {
      lines.push({
        accountId,
        debit: Math.abs(fx),
        description: `Realized FX — ${description}`,
      });
    }
  }
}
