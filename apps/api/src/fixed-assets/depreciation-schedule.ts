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
