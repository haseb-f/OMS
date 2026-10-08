import type { StatusTone } from "@/components/business/status-tone";
import { formatDate } from "@/lib/date";
import type { AgentShippingService } from "@/services/agents-service";
import type {
  ShippingAgreementActivation,
  ShippingAgreementList,
  ShippingAgreementRateInput,
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
 * Where an ACTIVE agreement stands against `today` ("YYYY-MM-DD"): in force,
 * not started yet, or past its end date (closed by a newer version).
 */
export function activePhase(
  agreement: { status: ShippingAgreementStatus; effectiveFrom: string; effectiveTo: string | null },
  today: string,
): "IN_FORCE" | "SCHEDULED" | "ENDED" | null {
  if (agreement.status !== "ACTIVE") return null;
  if (calendarDay(agreement.effectiveFrom) > today) return "SCHEDULED";
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

export interface RateFormState {
  service: AgentShippingService | "";
  /** '' = all destinations. */
  countryId: string;
  city: string;
  amount: string;
}

export const EMPTY_RATE_FORM: RateFormState = { service: "", countryId: "", city: "", amount: "" };

export type RateFormError = "service" | "amount" | "cityNeedsCountry";

/**
 * The rate form → the API input, or the first field error. 0 is a valid
 * (explicitly free) charge; a city needs its country.
 */
export function rateInputFrom(
  form: RateFormState,
): { input: ShippingAgreementRateInput; error: null } | { input: null; error: RateFormError } {
  if (!form.service) return { input: null, error: "service" };
  const city = form.city.trim();
  if (city && !form.countryId) return { input: null, error: "cityNeedsCountry" };
  const raw = form.amount.trim();
  const amount = Number(raw);
  // Plain non-negative decimal with at most two decimals ("60", "60.5", ".5").
  if (!/^(\d+\.?\d{0,2}|\.\d{1,2})$/.test(raw) || !Number.isFinite(amount)) {
    return { input: null, error: "amount" };
  }
  return {
    input: {
      service: form.service,
      ...(form.countryId ? { countryId: form.countryId } : {}),
      ...(city ? { city } : {}),
      amount,
    },
    error: null,
  };
}
