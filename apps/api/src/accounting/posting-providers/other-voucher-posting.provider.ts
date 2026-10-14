import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { ExchangeRatesService } from '../fx/exchange-rates.service';
import { snapshotDocumentExchangeRate } from '../fx/snapshot-document-rate';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';
import { internalTransferLines } from './internal-transfer-rule';
import { resolveOtherVoucher } from '../../financial-transactions/other/other-voucher.rules';
import {
  OTHER_VOUCHER_LABEL,
  OTHER_VOUCHER_TYPES,
  type OtherVoucherType,
} from '../../financial-transactions/other/other-voucher-types';

/**
 * R22 (decision D4) — Posting Provider of the voucher types beyond invoice
 * settlement (same FinancialTransaction voucher, same engine, sourceType =
 * the voucher type, sourceId = the voucher):
 *
 * Other Receipt:     Dr Cash/Bank (receiving account's ledger)  Cr counterAccountId
 * Other Payment:     Dr counterAccountId                        Cr Cash/Bank
 * Internal Transfer: Dr destination Cash/Bank                   Cr source Cash/Bank
 *                    (the shared `internalTransferLines` rule — never income / expense)
 *
 * No partner and no allocation on any of them. The D4 rules (counter-account
 * allow-list, active cash / bank accounts, one currency) are re-enforced
 * here, inside the posting transaction (`resolveOtherVoucher`). Entries are
 * dated on the voucher date (D1) at the rate of that date, frozen on the
 * voucher; lines are in the voucher currency and the engine converts them.
 */
@Injectable()
export class OtherVoucherPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes: string[] = [...OTHER_VOUCHER_TYPES];

  constructor(
    private readonly postingEngine: PostingEngineService,
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
    const type = sourceType as OtherVoucherType;
    const voucher = await tx.financialTransaction.findUniqueOrThrow({
      where: { id: sourceId },
      include: { _count: { select: { allocations: true } } },
    });
    if (voucher.type !== type) {
      throw new BadRequestException(
        `${voucher.transactionNumber} is a ${voucher.type}, not a ${type}.`,
      );
    }
    const label = `${OTHER_VOUCHER_LABEL[type]} ${voucher.transactionNumber}`;
    if (voucher._count.allocations > 0) {
      throw new BadRequestException({
        code: 'ALLOCATION_NOT_ALLOWED',
        message: `${label} never settles an invoice — nothing was posted.`,
      });
    }
    const amount = Number(voucher.amount);
    if (amount === 0) return null;

    const resolved = await resolveOtherVoucher(tx, type, voucher, {
      forPosting: true,
    });
    const cashAccountId = resolved.money!.chartOfAccountId;
    let lines: PostingLine[];
    if (type === 'INTERNAL_TRANSFER') {
      lines = internalTransferLines({
        destinationAccountId: resolved.target!.chartOfAccountId,
        sourceAccountId: cashAccountId,
        amount,
        description: label,
      });
    } else {
      const counterAccountId = voucher.counterAccountId!;
      const counterLabel = voucher.description
        ? `${label} — ${voucher.description}`
        : label;
      lines =
        type === 'OTHER_RECEIPT'
          ? [
              { accountId: cashAccountId, debit: amount, description: label },
              {
                accountId: counterAccountId,
                credit: amount,
                description: counterLabel,
              },
            ]
          : [
              {
                accountId: counterAccountId,
                debit: amount,
                description: counterLabel,
              },
              { accountId: cashAccountId, credit: amount, description: label },
            ];
    }

    const rate = await snapshotDocumentExchangeRate(
      this.exchangeRates,
      tx,
      (value) =>
        tx.financialTransaction.update({
          where: { id: voucher.id },
          data: { exchangeRate: value },
        }),
      voucher.currencyId,
      voucher.exchangeRate,
      voucher.transactionDate,
    );
    return {
      lines,
      description: label,
      referenceNumber: voucher.transactionNumber,
      currencyId: voucher.currencyId,
      exchangeRate: rate,
      companyId: voucher.companyId,
      branchId: voucher.branchId,
      costCenterId: voucher.costCenterId,
      projectId: voucher.projectId,
      // D1 — the voucher date (the day the money moved); the period lock applies.
      entryDate: voucher.transactionDate,
    };
  }
}
