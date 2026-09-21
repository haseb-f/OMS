import { addUtcMonths } from '../fixed-assets/depreciation-schedule';

export interface RecognitionPeriodInput {
  periodStart: Date;
  periodEnd: Date;
  amount: number;
}

/** Equal monthly recognition; the final month absorbs rounding so the
 *  schedule always sums to exactly `amount`. */
export function buildMonthlyRecognitionSchedule(
  amount: number,
  periods: number,
  start: Date,
): RecognitionPeriodInput[] {
  const monthly = Math.round((amount / periods) * 100) / 100;
  const rows: RecognitionPeriodInput[] = [];
  let recognized = 0;
  for (let i = 0; i < periods; i += 1) {
    const periodStart = addUtcMonths(start, i);
    const periodEnd = new Date(addUtcMonths(start, i + 1).getTime() - 86400000);
    const lineAmount =
      i === periods - 1
        ? Math.round((amount - recognized) * 100) / 100
        : monthly;
    recognized = Math.round((recognized + lineAmount) * 100) / 100;
    rows.push({ periodStart, periodEnd, amount: lineAmount });
  }
  return rows;
}
