import { Injectable, OnModuleInit } from '@nestjs/common';
import { FinancialTransactionStatus, Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';
import {
  bookedSettlementFunctional,
  settlementClearedFunctional,
  type SettlementSide,
} from './settlement-clearing';

/**
 * R22 P1 / P2 / D6 — the allocation FX adjustment of one confirmed receipt /
 * supplier payment (sourceType `FT_ALLOCATION_FX`, sourceId = the voucher;
 * the entry is linked to the voucher whose allocations it settles).
 *
 * The voucher's own entry (posted once at Confirm, never re-posted — no
 * second bank / cash movement) cleared AR / AP for the allocations it had
 * then. When a posted voucher is later allocated, re-allocated or
 * unallocated, the partner ledger must clear what the CURRENT allocations
 * require (`settlementClearedFunctional`, the same rule Confirm uses):
 * every allocation at its invoice's rate, the rest at the voucher's rate.
 * This entry books exactly that difference against the realized FX account
 * — Dr / Cr AR | AP (partner) vs Cr / Dr exchange difference — so a settled
 * foreign invoice leaves no AR / AP residue.
 *
 * Cumulative, never incremental: on every allocation change the caller
 * reverses the voucher's current adjustment (Posting Engine `reverse`,
 * dated today) and posts a fresh one, so the voucher always carries at most
 * one active adjustment equal to (required − booked at Confirm). Undoing an
 * allocation (D6) therefore reverses the FX it realized, including FX
 * realized at Confirm. Functional-currency vouchers never produce one.
 */
export const ALLOCATION_FX_SOURCE_TYPE = 'FT_ALLOCATION_FX';

@Injectable()
export class AllocationFxPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [ALLOCATION_FX_SOURCE_TYPE];

  constructor(
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    _sourceType: string,
    voucherId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const voucher = await tx.financialTransaction.findUniqueOrThrow({
      where: { id: voucherId },
      include: {
        allocations: {
          include: {
            salesInvoice: { select: { exchangeRate: true } },
            purchaseInvoice: { select: { exchangeRate: true } },
          },
        },
      },
    });
    if (
      voucher.status !== FinancialTransactionStatus.CONFIRMED ||
      !voucher.partnerId ||
      (voucher.type !== 'CUSTOMER_RECEIPT' &&
        voucher.type !== 'SUPPLIER_PAYMENT')
    ) {
      return null;
    }
    const side: SettlementSide =
      voucher.type === 'CUSTOMER_RECEIPT' ? 'sales' : 'purchase';
    const booked = await bookedSettlementFunctional(tx, side, {
      id: voucher.id,
      type: voucher.type,
      partnerId: voucher.partnerId,
    });
    // Nothing on the partner's AR / AP to adjust (not posted, or an agent
    // collection that credited Agent funds payable).
    if (!booked) return null;
    const payRate =
      voucher.exchangeRate != null ? Number(voucher.exchangeRate) : 1;
    const capacity =
      Number(voucher.amount) +
      (side === 'sales' ? Number(voucher.feeAmount ?? 0) : 0);
    const required = await settlementClearedFunctional(
      tx,
      side,
      voucher.id,
      voucher.allocations,
      capacity,
      payRate,
    );
    const delta = Math.round((required - booked.amount) * 100) / 100;
    if (Math.abs(delta) < 0.01) return null;

    const fxAccountId =
      await this.accountMapping.resolveExchangeDifferenceAccount(tx);
    const description = `Realized FX on allocation — ${voucher.transactionNumber}`;
    const amount = Math.abs(delta);
    // Receipt: more AR to clear (delta > 0) → Cr AR / Dr FX loss; less →
    // Dr AR / Cr FX gain. Supplier payment: more AP to clear → Dr AP / Cr FX
    // gain; less → Cr AP / Dr FX loss.
    const clearsMore = delta > 0;
    const partnerLine: PostingLine = {
      accountId: booked.accountId,
      partnerId: voucher.partnerId,
      description,
      ...((side === 'sales') === clearsMore
        ? { credit: amount }
        : { debit: amount }),
    };
    const fxLine: PostingLine = {
      accountId: fxAccountId,
      description,
      ...(partnerLine.credit ? { debit: amount } : { credit: amount }),
    };
    return {
      lines: [partnerLine, fxLine],
      description,
      referenceNumber: voucher.transactionNumber,
      currencyId: voucher.currencyId,
      exchangeRate: payRate,
      linesInFunctionalCurrency: true,
      companyId: voucher.companyId,
      branchId: voucher.branchId,
      costCenterId: voucher.costCenterId,
      projectId: voucher.projectId,
    };
  }
}
