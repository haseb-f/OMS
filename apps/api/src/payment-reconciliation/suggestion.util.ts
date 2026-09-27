import { normalizeArabicSearch } from '../common/text/arabic-search';
import { classifyProviderStatus, westernDigits } from './statement-row.util';

/**
 * Match suggestions (spec §5) — pure scoring so the ranking, the "strong"
 * badge and the ambiguity rule are unit-testable without a database.
 *
 * Signals, strongest first: exact provider/payment reference or order
 * number → E.164 phone → Arabic-normalized customer name. Every candidate is
 * cross-checked on amount, date window and provider status; method and
 * currency equality are enforced by the eligibility query itself.
 * Suggestions never confirm anything — every confirmation is an explicit
 * user action, and ambiguous rankings disable the one-click confirm.
 */

export type MatchSignal =
  | 'REFERENCE'
  | 'ORDER'
  | 'PHONE'
  | 'NAME'
  | 'NAME_PARTIAL'
  | 'AMOUNT'
  | 'AMOUNT_DIFFERS'
  | 'DATE'
  | 'DATE_OUT_OF_WINDOW'
  | 'CURRENCY'
  | 'STATUS'
  | 'STATUS_UNVERIFIED';

export interface MatchReason {
  signal: MatchSignal;
  detail: string;
}

export type SuggestionStrength = 'STRONG' | 'MEDIUM' | 'WEAK';

export const DATE_WINDOW_DAYS = 7;

const WEIGHTS = {
  REFERENCE: 100,
  ORDER: 100,
  PHONE: 40,
  NAME: 20,
  NAME_PARTIAL: 10,
  AMOUNT: 30,
  DATE: 10,
} as const;

export interface SuggestionLine {
  providerReference: string | null;
  orderReference: string | null;
  customerName: string | null;
  customerPhoneE164: string | null;
  providerStatus: string | null;
  /** Unallocated amount of the line. */
  remaining: number;
  transactionDate: Date;
  currencyCode: string;
}

export interface SuggestionCandidate {
  paymentId: string;
  referenceNumber: string | null;
  orderNumbers: string[];
  names: string[];
  phonesE164: string[];
  /** Unallocated amount of the claim. */
  remaining: number;
  paymentDate: Date;
}

export interface ScoredCandidate {
  paymentId: string;
  score: number;
  strength: SuggestionStrength;
  reasons: MatchReason[];
  amountMatches: boolean;
  /** False ⇒ not shown as a suggestion (the user can still pick it explicitly). */
  suggestible: boolean;
  dayDistance: number;
}

export function normalizeReference(value: string | null | undefined): string {
  return westernDigits(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normalizeName(value: string): string {
  return normalizeArabicSearch(value)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

const DAY_MS = 86_400_000;

function dayDistance(a: Date, b: Date): number {
  const dayA = Math.floor(a.getTime() / DAY_MS);
  const dayB = Math.floor(b.getTime() / DAY_MS);
  return Math.abs(dayA - dayB);
}

export function scoreCandidate(
  line: SuggestionLine,
  candidate: SuggestionCandidate,
): ScoredCandidate {
  const reasons: MatchReason[] = [];
  let score = 0;

  const lineRef = normalizeReference(line.providerReference);
  const lineOrder = normalizeReference(line.orderReference);
  const claimRef = normalizeReference(candidate.referenceNumber);
  const orderKeys = candidate.orderNumbers
    .map(normalizeReference)
    .filter(Boolean);

  const referenceHit =
    !!claimRef && (claimRef === lineRef || claimRef === lineOrder);
  if (referenceHit) {
    score += WEIGHTS.REFERENCE;
    reasons.push({
      signal: 'REFERENCE',
      detail: `Payment reference ${candidate.referenceNumber} = provider reference`,
    });
  }
  const orderHit =
    orderKeys.length > 0 &&
    ((!!lineOrder && orderKeys.includes(lineOrder)) ||
      (!!lineRef && orderKeys.includes(lineRef)));
  if (orderHit) {
    score += WEIGHTS.ORDER;
    reasons.push({
      signal: 'ORDER',
      detail: `Order ${line.orderReference ?? line.providerReference} matches the claim's order`,
    });
  }

  const phoneHit =
    !!line.customerPhoneE164 &&
    candidate.phonesE164.includes(line.customerPhoneE164);
  if (phoneHit) {
    score += WEIGHTS.PHONE;
    reasons.push({
      signal: 'PHONE',
      detail: `Phone ${line.customerPhoneE164}`,
    });
  }

  let nameHit: 'FULL' | 'PARTIAL' | null = null;
  const lineName = line.customerName ? normalizeName(line.customerName) : '';
  if (lineName.length >= 3) {
    for (const raw of candidate.names) {
      const name = normalizeName(raw);
      if (name.length < 3) continue;
      if (name === lineName) {
        nameHit = 'FULL';
        break;
      }
      if (name.includes(lineName) || lineName.includes(name)) {
        nameHit = 'PARTIAL';
      }
    }
  }
  if (nameHit === 'FULL') {
    score += WEIGHTS.NAME;
    reasons.push({ signal: 'NAME', detail: `Name "${line.customerName}"` });
  } else if (nameHit === 'PARTIAL') {
    score += WEIGHTS.NAME_PARTIAL;
    reasons.push({
      signal: 'NAME_PARTIAL',
      detail: `Name partially matches "${line.customerName}"`,
    });
  }

  const amountMatches = Math.abs(line.remaining - candidate.remaining) < 0.005;
  if (amountMatches) {
    score += WEIGHTS.AMOUNT;
    reasons.push({
      signal: 'AMOUNT',
      detail: `Amount ${line.remaining.toFixed(2)} ${line.currencyCode}`,
    });
  } else {
    reasons.push({
      signal: 'AMOUNT_DIFFERS',
      detail: `Line ${line.remaining.toFixed(2)} vs claim ${candidate.remaining.toFixed(2)} ${line.currencyCode}`,
    });
  }

  const distance = dayDistance(line.transactionDate, candidate.paymentDate);
  const dateInWindow = distance <= DATE_WINDOW_DAYS;
  if (dateInWindow) {
    score += WEIGHTS.DATE;
    reasons.push({
      signal: 'DATE',
      detail: distance === 0 ? 'Same day' : `${distance} day(s) apart`,
    });
  } else {
    reasons.push({
      signal: 'DATE_OUT_OF_WINDOW',
      detail: `${distance} days apart (window ±${DATE_WINDOW_DAYS})`,
    });
  }

  reasons.push({ signal: 'CURRENCY', detail: line.currencyCode });
  const statusClass = classifyProviderStatus(line.providerStatus);
  reasons.push(
    statusClass === 'SUCCESS'
      ? { signal: 'STATUS', detail: line.providerStatus ?? '' }
      : {
          signal: 'STATUS_UNVERIFIED',
          detail: line.providerStatus
            ? `Provider status "${line.providerStatus}" is not a known success status`
            : 'No provider status',
        },
  );

  const strongIdentity = referenceHit || orderHit;
  const strength: SuggestionStrength =
    strongIdentity || (phoneHit && amountMatches && dateInWindow)
      ? 'STRONG'
      : phoneHit || (nameHit !== null && amountMatches)
        ? 'MEDIUM'
        : 'WEAK';

  // Amount equality is required for a suggestion unless an exact
  // reference/order ties the pair (the explicit partial-allocation case).
  const suggestible =
    statusClass !== 'FAILED' &&
    (amountMatches
      ? strongIdentity || phoneHit || nameHit !== null || dateInWindow
      : strongIdentity);

  return {
    paymentId: candidate.paymentId,
    score,
    strength,
    reasons,
    amountMatches,
    suggestible,
    dayDistance: distance,
  };
}

export interface RankedSuggestions {
  candidates: ScoredCandidate[];
  /** Two or more candidates share the top score — the user must pick explicitly. */
  ambiguous: boolean;
}

export function rankSuggestions(
  line: SuggestionLine,
  candidates: SuggestionCandidate[],
  limit = 10,
): RankedSuggestions {
  if (classifyProviderStatus(line.providerStatus) === 'FAILED') {
    return { candidates: [], ambiguous: false };
  }
  const scored = candidates
    .map((candidate) => scoreCandidate(line, candidate))
    .filter((candidate) => candidate.suggestible)
    .sort((a, b) => b.score - a.score || a.dayDistance - b.dayDistance);
  const top = scored[0]?.score;
  const ambiguous =
    top !== undefined && scored.filter((c) => c.score === top).length > 1;
  return { candidates: scored.slice(0, limit), ambiguous };
}
