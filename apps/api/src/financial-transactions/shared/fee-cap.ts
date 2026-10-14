import { BadRequestException } from '@nestjs/common';

/**
 * R22 D5 (V1) — a fee the bank / provider kept is part of the money that
 * was paid: it can never exceed the money itself. Applies to a receipt's
 * `feeAmount` (editor, bank reconciliation) and to a store-order payment's
 * recorded actual provider fee (`actualFeeAmount`). A fee equal to the
 * amount is allowed (nothing reached the bank); above it is refused —
 * otherwise a 100 receipt with a 1,000 "fee" would settle a 1,100 invoice
 * and book 1,000 of expense out of thin air.
 */
export function assertFeeWithinAmount(fee: number, amount: number): void {
  const roundedFee = Math.round(fee * 100) / 100;
  const roundedAmount = Math.round(amount * 100) / 100;
  if (roundedFee - roundedAmount > 0.005) {
    throw new BadRequestException({
      code: 'FEE_EXCEEDS_AMOUNT',
      message: `الرسوم (${roundedFee.toFixed(2)}) لا يمكن أن تتجاوز المبلغ (${roundedAmount.toFixed(2)}) — The fee (${roundedFee.toFixed(2)}) cannot exceed the amount it was deducted from (${roundedAmount.toFixed(2)}).`,
      fields: [{ field: 'feeAmount', constraints: ['fee_exceeds_amount'] }],
    });
  }
}
