import type { StatusTone } from "@/components/business/status-tone";
import type {
  PartnerAgreementFrequency,
  PartnershipStatus,
  StatementPeriodRow,
  StatementPeriodStatus,
} from "@/services/company-partners-service";

/**
 * R15 (spec-w4 §5, D15-15) — the presentation rules of the per-period partner
 * statement, shared by the staff partner page and the partner portal. Pure:
 * the callers supply the translations.
 */

/** Open = provisional estimate, under review = not approved yet, closed = approved. */
export const PERIOD_STATUS_TONE: Record<StatementPeriodStatus, StatusTone> = {
  OPEN: "info",
  UNDER_REVIEW: "warning",
  CLOSED: "success",
};

export const PARTNERSHIP_TONE: Record<PartnershipStatus, StatusTone> = {
  NO_AGREEMENT: "neutral",
  NOT_STARTED: "info",
  ACTIVE: "success",
  ENDED: "neutral",
};

/** A closed period's figures are approved (معتمد); anything else is provisional (تقديري). */
export function isApproved(row: Pick<StatementPeriodRow, "status">): boolean {
  return row.status === "CLOSED";
}

export interface PeriodNameWords {
  /** e.g. `(n, year) => "Q1 2026"`. */
  quarter: (quarter: number, year: number) => string;
}

/**
 * The name of a closing period in the UI language: "March 2026" / «مارس
 * 2026», "Q1 2026", "2026" — from its frequency and start month. Digits stay
 * Latin (the app's number convention).
 */
export function periodName(
  row: { periodFrom: string; frequency: PartnerAgreementFrequency },
  locale: "ar" | "en",
  words: PeriodNameWords,
): string {
  const [year, month] = row.periodFrom.split("-").map(Number);
  if (row.frequency === "ANNUAL") return String(year);
  if (row.frequency === "QUARTERLY") return words.quarter(Math.floor((month - 1) / 3) + 1, year);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Distinct "30% · Net profit" terms of a period's segments, in date order. */
export function periodTerms(
  row: Pick<StatementPeriodRow, "segments">,
  basisLabel: (basis: StatementPeriodRow["segments"][number]["basis"]) => string,
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const segment of row.segments) {
    const text = `${Number(segment.percent.toFixed(4))}% · ${basisLabel(segment.basis)}`;
    if (seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts.join(" / ");
}

/**
 * End date of an agreement entered as a duration (4.5): the day before the
 * same calendar day `months` later — 1 Jan + 12 months → 31 Dec, 16 Mar + 3
 * months → 15 Jun. The anniversary clamps to the month end (31 Jan + 1 month
 * → anniversary 28 Feb → ends 27 Feb). `start` and the result are
 * "YYYY-MM-DD"; a non-positive or non-integer duration gives null.
 */
export function agreementEndFromMonths(start: string, months: number): string | null {
  if (!Number.isInteger(months) || months <= 0) return null;
  const [year, month, day] = start.split("-").map(Number);
  if (!year || !month || !day) return null;
  const targetMonthIndex = month - 1 + months;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, targetMonthIndex, Math.min(day, lastDayOfTarget)));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}
