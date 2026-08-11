import { IsEnum } from 'class-validator';
import { StoreOrderPaymentStatus } from '@prisma/client';

/**
 * `UNMATCHED`/`PAYMENT_REVIEW` are not auto-computed by
 * `StoreOrderPaymentSyncService` (see its class doc) — a human sets them
 * explicitly via this dedicated operation when a payment linked to this
 * order sits unmatched/ambiguous in the bank-matching engine.
 */
export class SetPaymentReviewStatusDto {
  @IsEnum(
    [StoreOrderPaymentStatus.UNMATCHED, StoreOrderPaymentStatus.PAYMENT_REVIEW],
    { message: 'status must be UNMATCHED or PAYMENT_REVIEW' },
  )
  status!: 'UNMATCHED' | 'PAYMENT_REVIEW';
}
