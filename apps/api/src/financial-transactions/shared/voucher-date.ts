import { BadRequestException } from '@nestjs/common';
import {
  businessDateOf,
  todayBusinessDate,
} from '../../common/time/business-date';

/**
 * R22 F8 — since D1 a voucher posts on its voucher date (the day the money
 * moved), so that date may never be later than today's business day
 * (Africa/Cairo): a typo would book bank and AR / AP in a future period.
 * Checked at create, update and Confirm.
 */
export function assertVoucherDateNotInFuture(
  date: Date | string | null | undefined,
  now: Date = new Date(),
): void {
  if (date == null || date === '') return;
  const instant = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(instant.getTime())) return;
  const day = businessDateOf(instant);
  const today = todayBusinessDate(now);
  if (day > today) {
    throw new BadRequestException({
      code: 'VOUCHER_DATE_IN_FUTURE',
      message: `تاريخ السند (${day}) بعد اليوم (${today}) — The voucher date ${day} is after today (${today}); a receipt / payment is dated on the day the money moved.`,
      fields: [{ field: 'transactionDate', constraints: ['in_future'] }],
    });
  }
}
