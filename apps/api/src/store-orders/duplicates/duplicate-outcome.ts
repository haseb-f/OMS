import { ConflictException } from '@nestjs/common';
import { StoreOrderDuplicateReviewStatus, type Prisma } from '@prisma/client';

/**
 * Round 5 Spec 1B — duplicate warning on order creation: the shared
 * vocabulary of the check, the caller's decision and what the create paths
 * (manual create, lead conversion, agent orders) persist from it.
 */

export const DUPLICATE_DECISIONS = [
  'USE_EXISTING_CUSTOMER',
  'INTENTIONAL_NEW_ORDER',
  'DIFFERENT_CUSTOMER',
] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

export interface DuplicateResolution {
  decision: DuplicateDecision;
  customerId?: string;
}

/** An existing order of the matched customer the caller may open. */
export interface DuplicateOrderSummary {
  id: string;
  orderNumber: string;
  orderDate: Date;
  /** Not delivered / collected / returned / cancelled yet. */
  active: boolean;
  paymentStatus: string;
  declaredPaymentStatus: string;
  fulfillmentStatus: {
    code: string;
    name: string;
    nameEn: string | null;
  } | null;
  total: number;
  currencyCode: string | null;
}

export interface DuplicateCustomerSummary {
  id: string;
  name: string;
  phoneMasked: string | null;
}

export interface DuplicateNameCandidate extends DuplicateCustomerSummary {
  orderCount: number;
  lastOrderDate: Date | null;
}

/**
 * What the caller may see. A cross-scope phone match carries nothing but the
 * flag — no name, id, order or count of a record outside the caller's scope.
 */
export type DuplicateCheckResult =
  | { kind: 'NONE' }
  | { kind: 'PHONE'; crossScope: true }
  | {
      kind: 'PHONE';
      crossScope: false;
      customer: DuplicateCustomerSummary;
      /** Orders the caller can open — active/unfulfilled first. */
      orders: DuplicateOrderSummary[];
      /** Orders of this customer inside the caller's customer scope that the caller cannot open (another owner's). */
      otherOrdersCount: number;
    }
  | { kind: 'NAME'; candidates: DuplicateNameCandidate[] };

/** Server-derived result of the enforced check — never taken from a client field. */
export interface DuplicateOutcome {
  /** The existing customer the order must use (never set for a cross-scope match). */
  partnerId: string | null;
  /** Cross-scope phone match: flag the order for an internal reviewer. */
  reviewPending: boolean;
  /** Order timeline row recording the decision. */
  activity: { action: string; details: string } | null;
}

export const NO_DUPLICATE: DuplicateOutcome = {
  partnerId: null,
  reviewPending: false,
  activity: null,
};

export const DUPLICATE_ACTIVITY = {
  INTENTIONAL_NEW_ORDER: 'INTENTIONAL_NEW_ORDER',
  USE_EXISTING_CUSTOMER: 'DUPLICATE_USE_EXISTING_CUSTOMER',
  DIFFERENT_CUSTOMER: 'DUPLICATE_DIFFERENT_CUSTOMER',
  REVIEW_REQUESTED: 'DUPLICATE_REVIEW_REQUESTED',
  REVIEW_RESOLVED: 'DUPLICATE_REVIEW_RESOLVED',
} as const;

/**
 * The client's per-form key, namespaced by channel and actor so two users
 * (or two agents) can never collide on — or replay — each other's key.
 */
export function scopedCreationKey(
  channel: 'store-order' | 'lead-convert' | 'agent-lead-convert',
  ownerId: string,
  key: string | null | undefined,
): string | null {
  const trimmed = key?.trim();
  return trimmed ? `${channel}:${ownerId}:${trimmed}` : null;
}

/** Columns every create path writes from the key and the outcome. */
export function duplicateOrderColumns(
  creationIdempotencyKey: string | null | undefined,
  outcome: DuplicateOutcome | null | undefined,
) {
  return {
    ...(creationIdempotencyKey ? { creationIdempotencyKey } : {}),
    ...(outcome?.reviewPending
      ? { duplicateReviewStatus: StoreOrderDuplicateReviewStatus.PENDING }
      : {}),
  };
}

export async function logDuplicateDecision(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
  outcome: DuplicateOutcome | null | undefined,
  userId?: string | null,
) {
  if (!outcome?.activity) return;
  await tx.storeOrderActivity.create({
    data: {
      storeOrderId,
      action: outcome.activity.action,
      details: outcome.activity.details,
      performedById: userId ?? null,
    },
  });
}

/** `+966501234567` → `+9665•••••567` (enough to recognise, not to copy). */
export function maskPhone(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length <= 6)
    return `${'•'.repeat(Math.max(text.length - 2, 1))}${text.slice(-2)}`;
  const head = text.slice(0, 5);
  const tail = text.slice(-3);
  return `${head}${'•'.repeat(text.length - head.length - tail.length)}${tail}`;
}

/** 409 with the same scoped payload the check returns. */
export function duplicateAcknowledgementRequired(
  duplicate: DuplicateCheckResult,
  reason: 'MISSING' | 'STALE' | 'INVALID' = 'MISSING',
) {
  const text = {
    MISSING: [
      'يوجد عميل مسجل بنفس البيانات — اختر فتح الطلب الحالي أو إنشاء طلب جديد لنفس العميل أو تعديل البيانات',
      'A customer with these details already exists — open the existing order, create a new order for this customer, or edit the details.',
    ],
    STALE: [
      'تغيرت نتيجة فحص التكرار — راجع العميل المطابق واختر مرة أخرى',
      'The duplicate check result changed — review the matching customer and choose again.',
    ],
    INVALID: [
      'هذا الرقم مسجل لعميل موجود — لا يمكن إنشاء عميل مختلف بنفس الرقم',
      'This phone belongs to an existing customer — a different customer cannot use the same number.',
    ],
  }[reason];
  return new ConflictException({
    code: 'DUPLICATE_ACKNOWLEDGEMENT_REQUIRED',
    message: `${text[0]} — ${text[1]}`,
    details: { duplicate },
  });
}
