import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BulkItemError,
  bulkFailure,
  type BulkItemsResult,
} from '../common/bulk/bulk-item-result';
import { PaymentMatchingService } from './payment-matching.service';
import { PaymentStatementsService } from './payment-statements.service';
import type { BulkAcceptMatchesDto } from './dto/bulk-accept-matches.dto';

export interface BulkAcceptPlan {
  /** The statement line id (the bulk item id). */
  id: string;
  providerReference: string | null;
  paymentId: string;
  paymentNumber: string;
  orderNumber: string | null;
  amount: number;
  currencyCode: string;
}

export interface BulkAcceptOutcome extends BulkAcceptPlan {
  posted: boolean;
  receiptId: string | null;
  replayed: boolean;
}

/**
 * "Accept strong suggestions" on the Matching tab. Every line is re-planned
 * on the server (a strong, unambiguous, amount-equal top suggestion only —
 * name/phone-only evidence never qualifies) and then confirmed through the
 * existing `PaymentMatchingService.confirm` — its own transaction, row
 * locks, currency/over-allocation checks and posting via
 * `PaymentsService.confirmInTx`. Nothing here posts or validates money on
 * its own.
 */
@Injectable()
export class PaymentBulkAcceptService {
  constructor(
    private readonly matching: PaymentMatchingService,
    private readonly statements: PaymentStatementsService,
  ) {}

  async bulkAccept(
    methodId: string,
    dto: BulkAcceptMatchesDto,
    userId: string,
  ): Promise<BulkItemsResult<BulkAcceptPlan | BulkAcceptOutcome>> {
    await this.statements.requireReconciledMethod(methodId);
    if (!dto.dryRun && !dto.idempotencyKey) {
      throw new BadRequestException('idempotencyKey is required.');
    }
    const seen = new Set<string>();
    const items = dto.items.filter((item) => {
      if (seen.has(item.statementLineId)) return false;
      seen.add(item.statementLineId);
      return true;
    });

    const result: BulkItemsResult<BulkAcceptPlan | BulkAcceptOutcome> = {
      succeeded: [],
      failed: [],
    };
    for (const item of items) {
      try {
        const plan = await this.plan(methodId, item);
        if (dto.dryRun) {
          result.succeeded.push(plan);
          continue;
        }
        const confirmed = await this.matching.confirm(
          methodId,
          {
            statementLineId: plan.id,
            allocations: [{ paymentId: plan.paymentId, amount: plan.amount }],
            idempotencyKey: `${dto.idempotencyKey}:${plan.id}`,
          },
          userId,
        );
        const posting = confirmed.postings.find(
          (row) => row.paymentId === plan.paymentId,
        );
        result.succeeded.push({
          ...plan,
          posted: posting?.posted ?? false,
          receiptId: posting?.receiptId ?? null,
          replayed: confirmed.replayed,
        });
      } catch (error) {
        result.failed.push(bulkFailure(item.statementLineId, error));
      }
    }
    return result;
  }

  private async plan(
    methodId: string,
    item: { statementLineId: string; paymentId?: string },
  ): Promise<BulkAcceptPlan> {
    const result = await this.matching.suggestions(
      methodId,
      item.statementLineId,
    );
    if (result.blockedReason) {
      throw new BulkItemError('NOT_MATCHABLE', result.blockedReason);
    }
    const top = result.candidates[0];
    if (!top) {
      throw new BulkItemError(
        'NO_SUGGESTION',
        'No eligible claim matches this transaction — match it explicitly or leave it for later.',
      );
    }
    if (result.ambiguous) {
      throw new BulkItemError(
        'AMBIGUOUS',
        'Several claims match this transaction equally well — pick the right one explicitly.',
      );
    }
    if (top.strength !== 'STRONG' || !top.amountMatches) {
      throw new BulkItemError(
        'NOT_STRONG',
        `The best suggestion (${top.claim.paymentNumber}) is ${top.strength.toLowerCase()}${top.amountMatches ? '' : ' and its amount differs'} — confirm it explicitly after review.`,
      );
    }
    if (item.paymentId && item.paymentId !== top.paymentId) {
      throw new BulkItemError(
        'SUGGESTION_CHANGED',
        `The strong suggestion for this transaction is now ${top.claim.paymentNumber}, not the one you reviewed — review it again.`,
      );
    }
    return {
      id: result.line.id,
      providerReference: result.line.providerReference,
      paymentId: top.paymentId,
      paymentNumber: top.claim.paymentNumber,
      orderNumber: top.claim.storeOrder?.internalOrderId ?? null,
      amount: result.line.remaining,
      currencyCode: result.line.currency.code,
    };
  }
}
