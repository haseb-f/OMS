/**
 * Advanced customer lookup (R7) — pure helpers: query classification and the
 * masking rules. Kept free of Nest/Prisma so the disclosure rules are unit
 * testable on their own.
 */

import { normalizePhoneDigits } from '../common/phone/phone-number.service';

export const MIN_PHONE_DIGITS = 7;
/** A name query is a person's name, not a prefix: two words, six letters in all. */
export const MIN_NAME_WORDS = 2;
export const MIN_NAME_WORD_CHARS = 2;
export const MIN_NAME_CHARS = 6;
export const MAX_QUERY_CHARS = 60;
export const MAX_RESULTS = 5;
/** An exact identifier (a full phone number, a document number) is not sweepable: more rows may be listed. */
export const MAX_EXACT_RESULTS = 20;

/** Per-user anti-enumeration budget, enforced from the audit table. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMIT_MAX_PER_WINDOW = 15;
export const RATE_LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
export const RATE_LIMIT_MAX_PER_DAY = 100;

export type LookupQuery =
  | { kind: 'PHONE'; value: string; digits: string }
  | { kind: 'ORDER_NUMBER'; value: string }
  | { kind: 'NAME'; value: string; words: string[] }
  | { kind: 'INVALID'; reason: 'TOO_SHORT' | 'TOO_LONG' | 'EMPTY' };

const PHONE_SHAPE = /^[+\d\s().-]+$/;
/** An OMS document number such as STO-2026-027225 or LD-2026-018688. */
const DOCUMENT_NUMBER = /^[A-Za-z]{2,5}-\d{4}-\d{3,}$/;

/** Phone if it looks like one (digits and phone punctuation only), else name. */
export function classifyQuery(raw: string | null | undefined): LookupQuery {
  // Arabic-Indic / Persian digits and a full-width "＋" are digits and a plus: a
  // phone typed on an Arabic keyboard is a phone, not a one-word name.
  const value = normalizePhoneDigits(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!value) return { kind: 'INVALID', reason: 'EMPTY' };
  if (value.length > MAX_QUERY_CHARS) {
    return { kind: 'INVALID', reason: 'TOO_LONG' };
  }
  if (DOCUMENT_NUMBER.test(value)) {
    return { kind: 'ORDER_NUMBER', value: value.toUpperCase() };
  }
  if (PHONE_SHAPE.test(value)) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < MIN_PHONE_DIGITS) {
      return { kind: 'INVALID', reason: 'TOO_SHORT' };
    }
    return { kind: 'PHONE', value, digits };
  }
  const words = value.split(' ').filter(Boolean);
  if (
    words.length < MIN_NAME_WORDS ||
    words.some((word) => [...word].length < MIN_NAME_WORD_CHARS) ||
    [...words.join('')].length < MIN_NAME_CHARS
  ) {
    return { kind: 'INVALID', reason: 'TOO_SHORT' };
  }
  return { kind: 'NAME', value, words };
}

/** "+966501234567" -> "+966•••••567": country prefix + last three digits only. */
export function maskPhone(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 6) return '•'.repeat(Math.max(digits.length, 3));
  // Keep the calling-code-sized head and the last three digits only.
  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `+${head}${'•'.repeat(digits.length - 6)}${tail}`;
}

/** "Ahmed Salem Ali" -> "Ah••• Sa••• Al•••": two letters per word, never more. */
export function maskName(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
  return words
    .map((word) => {
      const chars = [...word];
      if (chars.length <= 1) return '•••';
      return `${chars.slice(0, 2).join('')}•••`;
    })
    .join(' ');
}

export type OrderStatusBucket =
  'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'RETURNED';

/** Coarse, customer-facing-safe bucket from the fulfillment status code. */
export function orderStatusBucket(
  fulfillmentCode: string | null | undefined,
): OrderStatusBucket {
  switch (fulfillmentCode) {
    case 'DELIVERED':
    case 'COLLECTED':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'RETURNED':
      return 'RETURNED';
    default:
      return 'IN_PROGRESS';
  }
}

export type LeadStatusBucket = 'OPEN' | 'CONVERTED' | 'CLOSED';

export function leadStatusBucket(
  statusCode: string | null | undefined,
): LeadStatusBucket {
  if (statusCode === 'CONVERTED') return 'CONVERTED';
  if (statusCode === 'LOST' || statusCode === 'DISQUALIFIED') return 'CLOSED';
  return 'OPEN';
}
