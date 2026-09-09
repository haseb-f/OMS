/**
 * Shared "YYYY-MM" period helper — every HR Milestone 1 module (Sales
 * Targets, KPI Evaluations, Commission Calculations, Payroll Runs) keys its
 * monthly rows by this exact string, so the month↔date-range conversion
 * lives in one place rather than being re-derived per module.
 */
export function periodToDateRange(period: string): { start: Date; end: Date } {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
