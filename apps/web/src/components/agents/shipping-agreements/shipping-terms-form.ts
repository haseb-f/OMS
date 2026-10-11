import type { AgentShippingCodFeeMode, AgentShippingRateService } from "@/services/agents-service";
import type {
  ShippingAgreementDetail,
  ShippingAgreementRateInput,
  ShippingAgreementTermsInput,
} from "./shipping-agreements-api";

/**
 * Pure rules of the compact shipping-terms form (R17 §3): the default rate
 * (all services × all destinations, `ANY`) first, optional extra rates
 * (service and/or destination), the COD collection fee and each row's
 * explicit "amount includes the COD fee" choice. The API owns every business
 * rule (resolution, duplicates, versions); these only shape the input and
 * the live preview.
 */

export interface ExtraRateForm {
  /** Stable key for the row list (never sent). */
  key: string;
  service: AgentShippingRateService;
  /** '' = all destinations. */
  countryId: string;
  city: string;
  amount: string;
  /** The amount already includes the COD collection fee (all-inclusive). */
  includesCodFee: boolean;
}

export interface ShippingTermsForm {
  defaultAmount: string;
  defaultIncludesCodFee: boolean;
  /** '' = no COD collection fee. */
  codCollectionFee: string;
  extras: ExtraRateForm[];
  notes: string;
}

export type TermsFieldError =
  "defaultAmount" | "codCollectionFee" | "amount" | "cityNeedsCountry" | "duplicate";

export interface TermsErrors {
  defaultAmount?: TermsFieldError;
  codCollectionFee?: TermsFieldError;
  /** Per extra row key. */
  extras: Record<string, TermsFieldError>;
}

const MONEY = /^(\d+\.?\d{0,2}|\.\d{1,2})$/;

/** A non-negative amount with at most two decimals, or null. */
export function parseMoney(raw: string): number | null {
  const value = raw.trim();
  if (!MONEY.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** Whether a row can price a COD order (so its COD-fee choice matters). */
export const pricesCod = (service: AgentShippingRateService) =>
  service === "ANY" || service === "COD_CARRIER" || service === "COD_INTERNAL_COURIER";

const modeOf = (includes: boolean): AgentShippingCodFeeMode => (includes ? "INCLUDED" : "ADDED");

let nextKey = 0;
/** A new, empty extra rate row ("Add rate"). New rows default to ADDED. */
export function newExtraRate(): ExtraRateForm {
  nextKey += 1;
  return {
    key: `rate-${nextKey}`,
    service: "ANY",
    countryId: "",
    city: "",
    amount: "",
    includesCodFee: false,
  };
}

export const EMPTY_TERMS_FORM: ShippingTermsForm = {
  defaultAmount: "",
  defaultIncludesCodFee: false,
  codCollectionFee: "",
  extras: [],
  notes: "",
};

/** The form of an existing agreement: its ANY × all-destinations row is the default rate. */
export function termsFormFrom(
  agreement: Pick<ShippingAgreementDetail, "rates" | "codCollectionFee" | "notes"> | null,
): ShippingTermsForm {
  if (!agreement) return { ...EMPTY_TERMS_FORM, extras: [] };
  const fallback = agreement.rates.find((rate) => rate.service === "ANY" && !rate.countryId);
  return {
    defaultAmount: fallback ? String(fallback.amount) : "",
    defaultIncludesCodFee: fallback?.codFee === "INCLUDED",
    codCollectionFee:
      agreement.codCollectionFee == null || agreement.codCollectionFee === 0
        ? ""
        : String(agreement.codCollectionFee),
    extras: agreement.rates
      .filter((rate) => rate !== fallback)
      .map((rate) => ({
        ...newExtraRate(),
        service: rate.service,
        countryId: rate.countryId ?? "",
        city: rate.city,
        amount: String(rate.amount),
        includesCodFee: rate.codFee === "INCLUDED",
      })),
    notes: agreement.notes ?? "",
  };
}

const destinationKey = (countryId: string, city: string) =>
  countryId ? (city.trim() ? `${countryId}|${city.trim().toLocaleLowerCase()}` : countryId) : "*";

/**
 * The form → the API terms, or the field errors. The default rate is
 * required when `requireDefault` (a new agreement through this form); every
 * row needs an amount ≥ 0 (two decimals), a city needs its country, and no
 * service × destination may repeat (the default row is ANY × all).
 */
export function termsInputFrom(
  form: ShippingTermsForm,
  options: { requireDefault: boolean },
): { input: ShippingAgreementTermsInput; errors: null } | { input: null; errors: TermsErrors } {
  const errors: TermsErrors = { extras: {} };
  const rates: ShippingAgreementRateInput[] = [];
  const seen = new Set<string>();
  const fee = form.codCollectionFee.trim() ? parseMoney(form.codCollectionFee) : 0;
  if (fee == null) errors.codCollectionFee = "codCollectionFee";

  if (form.defaultAmount.trim() || options.requireDefault) {
    const amount = parseMoney(form.defaultAmount);
    if (amount == null) errors.defaultAmount = "defaultAmount";
    else {
      rates.push({ service: "ANY", amount, codFee: modeOf(form.defaultIncludesCodFee) });
      seen.add("ANY#*");
    }
  }
  for (const row of form.extras) {
    const city = row.city.trim();
    const amount = parseMoney(row.amount);
    if (city && !row.countryId) {
      errors.extras[row.key] = "cityNeedsCountry";
      continue;
    }
    if (amount == null) {
      errors.extras[row.key] = "amount";
      continue;
    }
    const key = `${row.service}#${destinationKey(row.countryId, city)}`;
    if (seen.has(key)) {
      errors.extras[row.key] = "duplicate";
      continue;
    }
    seen.add(key);
    rates.push({
      service: row.service,
      ...(row.countryId ? { countryId: row.countryId } : {}),
      ...(city ? { city } : {}),
      amount,
      codFee: pricesCod(row.service) ? modeOf(row.includesCodFee) : "ADDED",
    });
  }
  if (errors.defaultAmount || errors.codCollectionFee || Object.keys(errors.extras).length > 0) {
    return { input: null, errors };
  }
  return { input: { rates, codCollectionFee: fee ? fee : null }, errors: null };
}

export interface ChargePreview {
  /** What a prepaid order pays (null = this row never prices prepaid). */
  prepaid: number | null;
  /** What a COD order pays (null = this row never prices COD). */
  cod: number | null;
  base: number;
  /** The fee added on top (0 when none / included). */
  fee: number;
  included: boolean;
}

/**
 * The live preview of one rate: prepaid = the amount; COD = amount + fee
 * (ADDED) or the amount alone (INCLUDED). Prepaid never pays the fee.
 * Null when the amount is not a valid number yet.
 */
export function chargePreview(
  service: AgentShippingRateService,
  amountText: string,
  feeText: string,
  includesCodFee: boolean,
): ChargePreview | null {
  const base = parseMoney(amountText);
  if (base == null) return null;
  const fee = feeText.trim() ? (parseMoney(feeText) ?? 0) : 0;
  const prepaidRow =
    service === "ANY" || service === "PREPAID_CARRIER" || service === "PREPAID_INTERNAL_COURIER";
  const codRow = pricesCod(service);
  const added = codRow && !includesCodFee && fee > 0;
  return {
    prepaid: prepaidRow ? base : null,
    cod: codRow ? Math.round((base + (added ? fee : 0)) * 100) / 100 : null,
    base,
    fee: added ? fee : 0,
    included: codRow && includesCodFee,
  };
}
