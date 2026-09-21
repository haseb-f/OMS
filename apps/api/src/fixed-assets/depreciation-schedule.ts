export interface DepreciationPeriodInput {
  periodStart: Date;
  periodEnd: Date;
  amount: number;
}

export function addUtcMonths(date: Date, months: number) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
    ),
  );
}

export function buildStraightLineSchedule(
  cost: number,
  salvage: number,
  months: number,
  start: Date,
): DepreciationPeriodInput[] {
  const depreciable = Math.max(Math.round((cost - salvage) * 100) / 100, 0);
  if (depreciable === 0 || months <= 0) return [];
  const monthly = Math.round((depreciable / months) * 100) / 100;
  const periods: DepreciationPeriodInput[] = [];
  let recognized = 0;
  for (let i = 0; i < months; i += 1) {
    const periodStart = addUtcMonths(start, i);
    const periodEnd = new Date(addUtcMonths(start, i + 1).getTime() - 86400000);
    const amount =
      i === months - 1
        ? Math.round((depreciable - recognized) * 100) / 100
        : monthly;
    recognized = Math.round((recognized + amount) * 100) / 100;
    periods.push({ periodStart, periodEnd, amount });
  }
  return periods;
}

/**
 * Double-declining balance, monthly, switching to straight-line on the
 * remaining book value once that yields the larger charge (so the asset
 * reaches exactly its salvage value in the final month). Every amount is
 * rounded to cents; the last period absorbs the rounding remainder.
 */
export function buildDecliningBalanceSchedule(
  cost: number,
  salvage: number,
  months: number,
  start: Date,
): DepreciationPeriodInput[] {
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const depreciable = Math.max(round2(cost - salvage), 0);
  if (depreciable === 0 || months <= 0) return [];
  const monthlyRate = 2 / months;
  const periods: DepreciationPeriodInput[] = [];
  let bookValue = round2(cost);
  for (let i = 0; i < months; i += 1) {
    const remainingMonths = months - i;
    const remainingDepreciable = round2(bookValue - salvage);
    let amount: number;
    if (i === months - 1) {
      amount = remainingDepreciable;
    } else {
      const declining = round2(bookValue * monthlyRate);
      const straight = round2(remainingDepreciable / remainingMonths);
      amount = Math.min(Math.max(declining, straight), remainingDepreciable);
    }
    const periodStart = addUtcMonths(start, i);
    const periodEnd = new Date(addUtcMonths(start, i + 1).getTime() - 86400000);
    periods.push({ periodStart, periodEnd, amount: Math.max(amount, 0) });
    bookValue = round2(bookValue - amount);
  }
  return periods;
}

export function buildDepreciationSchedule(
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE',
  cost: number,
  salvage: number,
  months: number,
  start: Date,
): DepreciationPeriodInput[] {
  return method === 'DECLINING_BALANCE'
    ? buildDecliningBalanceSchedule(cost, salvage, months, start)
    : buildStraightLineSchedule(cost, salvage, months, start);
}
