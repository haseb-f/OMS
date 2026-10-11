import type { StatusTone } from "@/components/business/status-tone";
import { formatDate } from "@/lib/date";
import type { AgentShippingService } from "@/services/agents-service";
import type {
  ShippingAgreementActivation,
  ShippingAgreementList,
  ShippingAgreementStatus,
  ShippingCountryRef,
} from "./shipping-agreements-api";

/**
 * Pure view rules of the agent shipping agreement screen (R15 D15-13). The
 * API owns every business rule (resolution, coverage, overlap); these only
 * decide what the screen shows and which actions it offers.
 */

/** The four services, in the order every screen lists them (same as the API). */
export const SHIPPING_SERVICES: readonly AgentShippingService[] = [
  "PREPAID_CARRIER",
  "COD_CARRIER",
  "COD_INTERNAL_COURIER",
  "PREPAID_INTERNAL_COURIER",
];

export const SHIPPING_AGREEMENT_STATUS_TONE: Record<ShippingAgreementStatus, StatusTone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  INACTIVE: "warning",
};

/** "YYYY-MM-DD" of an API calendar date ("2026-10-08T00:00:00.000Z" or "2026-10-08"). */
export const calendarDay = (value: string) => value.slice(0, 10);

/** "01 Jan 2026 – 31 Dec 2026", or "01 Jan 2026 – <open>" for an open-ended agreement. */
export function agreementPeriod(
  agreement: { effectiveFrom: string; effectiveTo: string | null },
  openEndedLabel: string,
): string {
  const to = agreement.effectiveTo ? formatDate(agreement.effectiveTo) : openEndedLabel;
  return `${formatDate(agreement.effectiveFrom)} – ${to}`;
}

/**
 * Where an ACTIVE agreement stands against `today` ("YYYY-MM-DD") and `now`:
 * in force, not started yet, or ended — past its end date, or (R17 §2)
 * closed at an instant by a newer version saved later the same day.
 */
export function activePhase(
  agreement: {
    status: ShippingAgreementStatus;
    effectiveFrom: string;
    effectiveTo: string | null;
    activeFrom?: string | null;
    activeTo?: string | null;
  },
  today: string,
  now: Date = new Date(),
): "IN_FORCE" | "SCHEDULED" | "ENDED" | null {
  if (agreement.status !== "ACTIVE") return null;
  if (agreement.activeTo && new Date(agreement.activeTo) <= now) return "ENDED";
  if (calendarDay(agreement.effectiveFrom) > today) return "SCHEDULED";
  if (agreement.activeFrom && new Date(agreement.activeFrom) > now) return "SCHEDULED";
  if (agreement.effectiveTo && calendarDay(agreement.effectiveTo) < today) return "ENDED";
  return "IN_FORCE";
}

/** The agreement the section opens on: in force today, else the newest draft, else the newest. */
export function defaultSelectedAgreement(list: ShippingAgreementList): string | null {
  return (
    list.inForceId ??
    list.items.find((item) => item.status === "DRAFT")?.id ??
    list.items[0]?.id ??
    null
  );
}

/** "Egypt / Cairo", "Egypt", or null for all destinations (the caller names it). */
export function destinationName(
  destination: { country: ShippingCountryRef | null; city: string | null },
  locale: string,
): string | null {
  if (!destination.country) return null;
  const country = (locale === "en" ? destination.country.nameEn : null) ?? destination.country.name;
  const city = destination.city?.trim();
  return city ? `${country} / ${city}` : country;
}

/**
 * Activate is offered only when the server says the draft is ready, and —
 * when it overlaps the earlier agreement — only once "replace from" is chosen.
 */
export function canConfirmActivation(
  activation: ShippingAgreementActivation | null,
  replaceFrom: boolean,
): boolean {
  if (!activation?.ready) return false;
  return activation.overlapping.length === 0 || replaceFrom;
}
