import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PaymentsService,
  type ConfirmClaimOptions,
} from '../payments/payments.service';

export type ConfirmInTxOptions = ConfirmClaimOptions;

export interface ConfirmInTxOutcome {
  receiptId: string | null;
  alreadyPosted: boolean;
}

/**
 * The one seam onto the claim lifecycle owned by the Payments module
 * (contracts.md §2 and §5). Reconciliation never posts a receipt itself: it
 * calls `PaymentsService.confirmInTx` inside its OWN transaction so the
 * allocation and the posting commit or roll back together. Kept as a
 * separate provider so tests can observe/stub exactly this boundary.
 */
@Injectable()
export class ClaimPostingAdapter {
  constructor(private readonly payments: PaymentsService) {}

  async confirmInTx(
    tx: Prisma.TransactionClient,
    paymentId: string,
    userId: string,
    opts: ConfirmInTxOptions,
  ): Promise<ConfirmInTxOutcome> {
    const result = await this.payments.confirmInTx(tx, paymentId, userId, opts);
    return { receiptId: result.receiptId, alreadyPosted: result.alreadyPosted };
  }

  dispute(paymentId: string, userId: string, reason: string) {
    return this.payments.dispute(paymentId, userId, reason);
  }
}
