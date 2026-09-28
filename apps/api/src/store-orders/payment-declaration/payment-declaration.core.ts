import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentDeclarationKind,
  PaymentOrigin,
  PaymentStatus,
  Prisma,
  StoreOrderDeclaredPaymentStatus,
  StoreOrderPaymentStatus,
  type Payment,
} from '@prisma/client';
import {
  assertPaymentCurrency,
  computeStoreOrderSettlement,
  lockStoreOrderRow,
  roundMoney,
} from '../store-order-payment-settlement.util';
import { storeOrderPayableTotal } from '../store-order-line-amount';

/**
 * Sales/Finance payment declaration (payment-declaration-reconciliation).
 *
 * A declaration is what Sales (or Finance) reports the customer paid. It is
 * NEVER Finance verification and never creates accounting entries: a paid
 * declaration creates at most ONE unverified `Payment` claim per client
 * idempotency key; the order keeps a separate `declaredPaymentStatus`.
 *
 * Plain functions over a transaction client (no DI) so the Store Order
 * endpoint and Lead conversion (workflow engine) share one implementation.
 */

export type DeclarationKind = 'UNPAID' | 'FULL' | 'PARTIAL';

/** Claims that count toward the declared amount (REJECTED / DISPUTED never do). */
export const DECLARED_CLAIM_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.MATCHED,
  PaymentStatus.VERIFIED,
];

const EPSILON = 0.005;
const FUTURE_TOLERANCE_MS = 14 * 60 * 60 * 1000; // any timezone's "today"
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

export interface DeclarePaymentInput {
  storeOrderId: string;
  kind: DeclarationKind;
  amount?: number;
  paymentMethodId?: string;
  currencyId?: string;
  paymentDate?: string;
  referenceNumber?: string;
  stagedAttachmentIds?: string[];
  /**
   * Agents milestone (spec §7) — required for an agent order: the agent's
   * active payment destination the customer paid into. Its payment method
   * is the claim's method; ownership (COMPANY / AGENT) is stamped on the
   * claim. Rejected on company orders.
   */
  agentPaymentDestinationId?: string;
  idempotencyKey: string;
  origin: PaymentOrigin;
  userId: string;
  /** Caller holds `store-orders.manage` or `sales.receipts.confirm` (audited correction). */
  allowCorrection: boolean;
}

export interface DeclarePaymentDeps {
  generatePaymentNumber: (tx: Prisma.TransactionClient) => Promise<string>;
  /** Dual-write helper for the Finance-side StatusDefinition. */
  paymentStatusId: (
    status: StoreOrderPaymentStatus,
  ) => Promise<string | undefined> | string | undefined;
  finalizeAttachments?: (
    paymentId: string,
    storeOrderId: string,
    stagedIds: string[],
    userId: string,
    tx: Prisma.TransactionClient,
  ) => Promise<unknown>;
}

export interface DeclarePaymentResult {
  payment: Payment | null;
  /** False when the idempotency key already produced this payment (retry). */
  created: boolean;
  declaredPaymentStatus: StoreOrderDeclaredPaymentStatus;
  declaredAmount: string;
}

export function declaredStatusFor(
  declared: number,
  total: number,
): StoreOrderDeclaredPaymentStatus {
  if (total > EPSILON && declared + EPSILON >= total) {
    return StoreOrderDeclaredPaymentStatus.PAID;
  }
  if (declared > EPSILON) return StoreOrderDeclaredPaymentStatus.PARTIALLY_PAID;
  return StoreOrderDeclaredPaymentStatus.UNPAID;
}

/** Sum of claims that still stand (PENDING / MATCHED / VERIFIED). */
export async function standingClaimsTotal(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<number> {
  const agg = await tx.payment.aggregate({
    where: {
      storeOrderId,
      deletedAt: null,
      status: { in: DECLARED_CLAIM_STATUSES },
    },
    _sum: { amount: true },
  });
  return roundMoney(Number(agg._sum.amount ?? 0));
}

/**
 * Recomputes `declaredPaymentStatus` / `declaredAmount` from the standing
 * claims. Never touches `paymentStatus` (Finance) or fulfillment.
 */
export async function recomputeDeclaredPaymentStatus(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
) {
  const order = await tx.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      payableTotal: true,
      items: {
        where: { deletedAt: null },
        select: { quantity: true, unitPrice: true, agreedAmount: true },
      },
    },
  });
  if (!order) return null;
  // Agent orders: merchandise + shipping + service (spec §5); legacy: Σ lines.
  const total = roundMoney(storeOrderPayableTotal(order));
  const declared = await standingClaimsTotal(tx, storeOrderId);
  const declaredPaymentStatus = declaredStatusFor(declared, total);
  await tx.storeOrder.update({
    where: { id: storeOrderId },
    data: { declaredPaymentStatus, declaredAmount: declared },
  });
  return { declaredPaymentStatus, declaredAmount: declared, total };
}

/** Shipment row exists, or a pickup order reached Collected/Returned. */
export async function hasFulfillmentStarted(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<boolean> {
  const order = await tx.storeOrder.findUnique({
    where: { id: storeOrderId },
    select: {
      fulfillmentStatus: { select: { code: true } },
      _count: { select: { shipments: { where: { deletedAt: null } } } },
    },
  });
  if (!order) return false;
  if (order._count.shipments > 0) return true;
  const code = order.fulfillmentStatus?.code;
  return code === 'COLLECTED' || code === 'RETURNED';
}

/**
 * Finance rejected/disputed a claim: when fulfillment already started, flag
 * the order for action. Shipment/pickup history is never touched.
 */
export async function flagDiscrepancyIfFulfilled(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
  reason: string,
): Promise<boolean> {
  if (!(await hasFulfillmentStarted(tx, storeOrderId))) return false;
  await tx.storeOrder.update({
    where: { id: storeOrderId },
    data: {
      paymentDiscrepancy: true,
      paymentDiscrepancyReason: reason.slice(0, 1000),
    },
  });
  return true;
}

/** PaymentMethod name → PaymentSource (the required "how paid" FK), with the default source as fallback. */
export async function resolvePaymentSourceId(
  tx: Prisma.TransactionClient,
  input: { paymentSourceId?: string; paymentMethodId?: string },
): Promise<string> {
  if (input.paymentSourceId) {
    const source = await tx.paymentSource.findFirst({
      where: { id: input.paymentSourceId, deletedAt: null, isActive: true },
    });
    if (!source) {
      throw new BadRequestException(
        'مصدر الدفع غير موجود أو غير نشط — Payment source not found or is not active.',
      );
    }
    return source.id;
  }
  if (input.paymentMethodId) {
    const method = await tx.paymentMethod.findFirst({
      where: { id: input.paymentMethodId, deletedAt: null },
    });
    if (!method) {
      throw new BadRequestException(
        'طريقة الدفع غير موجودة — Payment method not found.',
      );
    }
    const byName = await tx.paymentSource.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        name: { equals: method.name, mode: 'insensitive' },
      },
    });
    if (byName) return byName.id;
  }
  const fallback = await tx.paymentSource.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
  });
  if (!fallback) {
    throw new BadRequestException(
      'لا يوجد مصدر دفع نشط مُعرّف — No active Payment Source is configured.',
    );
  }
  return fallback.id;
}

export function assertIdempotencyKey(key: string | undefined): string {
  const trimmed = key?.trim();
  if (!trimmed) {
    throw new BadRequestException(
      'idempotencyKey is required — generate one per declaration attempt so a retry never creates a second claim.',
    );
  }
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException('idempotencyKey is too long.');
  }
  return trimmed;
}

function parsePaymentDate(value: string | undefined): Date {
  if (!value) {
    throw new BadRequestException(
      'تاريخ الدفع مطلوب — Payment date is required.',
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(
      'تاريخ الدفع غير صالح — Payment date is invalid.',
    );
  }
  if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new BadRequestException(
      'لا يمكن أن يكون تاريخ الدفع في المستقبل — Payment date cannot be in the future.',
    );
  }
  return date;
}

/** Returns the claim a key already produced, refusing a key reused for another order. */
export async function findByIdempotencyKey(
  client: Prisma.TransactionClient,
  idempotencyKey: string,
  storeOrderId: string,
): Promise<Payment | null> {
  const existing = await client.payment.findUnique({
    where: { idempotencyKey },
  });
  if (existing && existing.storeOrderId !== storeOrderId) {
    throw new ConflictException(
      'هذا الطلب سبق حفظه لطلب مختلف؛ أعد فتح النافذة وحاول مرة أخرى — This idempotency key was already used for a different order.',
    );
  }
  return existing;
}

async function currentDeclared(
  tx: Prisma.TransactionClient,
  storeOrderId: string,
): Promise<{ status: StoreOrderDeclaredPaymentStatus; amount: string }> {
  const row = await tx.storeOrder.findUniqueOrThrow({
    where: { id: storeOrderId },
    select: { declaredPaymentStatus: true, declaredAmount: true },
  });
  return {
    status: row.declaredPaymentStatus,
    amount: Number(row.declaredAmount).toFixed(2),
  };
}

/**
 * Records one declaration inside the caller's transaction. Locks the order
 * row so concurrent submits serialize; a repeated idempotency key returns
 * the first claim unchanged.
 */
export async function declarePaymentInTx(
  tx: Prisma.TransactionClient,
  deps: DeclarePaymentDeps,
  input: DeclarePaymentInput,
): Promise<DeclarePaymentResult> {
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const { storeOrderId } = input;

  await lockStoreOrderRow(tx, storeOrderId);

  const replay = await findByIdempotencyKey(tx, idempotencyKey, storeOrderId);
  if (replay) {
    const declared = await currentDeclared(tx, storeOrderId);
    return {
      payment: replay,
      created: false,
      declaredPaymentStatus: declared.status,
      declaredAmount: declared.amount,
    };
  }

  const order = await tx.storeOrder.findFirst({
    where: { id: storeOrderId, deletedAt: null },
    select: {
      id: true,
      internalOrderId: true,
      currencyId: true,
      paymentStatus: true,
      declaredPaymentStatus: true,
      agentId: true,
      agentTermsSnapshot: true,
      partner: { select: { name: true } },
    },
  });
  if (!order) {
    throw new NotFoundException(`Store Order ${storeOrderId} not found`);
  }

  const settlement = await computeStoreOrderSettlement(tx, storeOrderId);
  const total = settlement.total;
  const alreadyDeclared = roundMoney(settlement.claimed);
  const remaining = roundMoney(Math.max(total - alreadyDeclared, 0));

  // Correction gate: after fulfillment started or a claim was VERIFIED, ANY
  // new declaration (even one that leaves the declared status unchanged) is
  // an audited correction reserved to store-orders.manage /
  // sales.receipts.confirm. Idempotent replays returned above never get here.
  const assertCorrectionAllowed = async () => {
    if (input.allowCorrection) return;
    const posted = await tx.payment.count({
      where: {
        storeOrderId,
        deletedAt: null,
        status: PaymentStatus.VERIFIED,
      },
    });
    if (posted > 0 || (await hasFulfillmentStarted(tx, storeOrderId))) {
      throw new ForbiddenException(
        'بدأ تنفيذ الطلب أو تم ترحيل دفعة له، لذا يُعدّ تغيير إفادة الدفع الآن تصحيحًا يتطلب صلاحية إدارة الطلبات أو تأكيد المقبوضات — Fulfillment has started or a payment is already posted for this order; changing the payment declaration now is a correction that requires the store-orders.manage or sales.receipts.confirm permission.',
      );
    }
  };

  if (input.kind === 'UNPAID') {
    if (alreadyDeclared > EPSILON) {
      throw new ConflictException(
        `This order already has declared payments of ${alreadyDeclared.toFixed(2)}. They must be disputed or rejected by Finance before the order can be declared unpaid.`,
      );
    }
    await assertCorrectionAllowed();
    const result = await recomputeDeclaredPaymentStatus(tx, storeOrderId);
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId,
        action: 'PAYMENT_DECLARED',
        details: 'Customer payment declared: unpaid',
        performedById: input.userId,
      },
    });
    return {
      payment: null,
      created: false,
      declaredPaymentStatus:
        result?.declaredPaymentStatus ?? StoreOrderDeclaredPaymentStatus.UNPAID,
      declaredAmount: (result?.declaredAmount ?? 0).toFixed(2),
    };
  }

  if (total <= EPSILON) {
    throw new BadRequestException(
      'لا توجد أسعار لبنود الطلب (الإجمالي 0.00)؛ حدّد المبالغ المتفق عليها قبل الإفادة بالدفع — This order has no priced lines (total 0.00); set the agreed line amounts before declaring a payment.',
    );
  }
  if (remaining <= EPSILON) {
    throw new ConflictException(
      `The order total (${total.toFixed(2)}) is already fully declared — nothing remains to declare.`,
    );
  }

  let amount: number;
  if (input.kind === 'FULL') {
    // Never re-entered: the validated total minus standing claims.
    amount = remaining;
  } else {
    amount = roundMoney(Number(input.amount ?? 0));
    if (!(amount > 0)) {
      throw new BadRequestException(
        'A partial payment needs an amount greater than zero.',
      );
    }
    if (amount > remaining + EPSILON) {
      throw new BadRequestException(
        `Declared amount ${amount.toFixed(2)} exceeds the remaining ${remaining.toFixed(2)} of the order total.`,
      );
    }
  }

  if (!input.currencyId) {
    throw new BadRequestException('العملة مطلوبة — Currency is required.');
  }
  assertPaymentCurrency(order.currencyId, input.currencyId);

  const agentDestination = await resolveAgentDeclarationDestination(
    tx,
    order,
    input.agentPaymentDestinationId,
    input.paymentMethodId,
  );
  if (agentDestination) {
    input = { ...input, paymentMethodId: agentDestination.paymentMethodId };
  }

  if (!input.paymentMethodId) {
    throw new BadRequestException(
      'طريقة الدفع مطلوبة — Payment method is required.',
    );
  }
  const method = await tx.paymentMethod.findFirst({
    where: { id: input.paymentMethodId, deletedAt: null },
    select: { id: true, name: true, isActive: true },
  });
  if (!method || !method.isActive) {
    throw new BadRequestException(
      'طريقة الدفع غير موجودة أو غير نشطة — Payment method not found or is not active.',
    );
  }
  const paymentDate = parsePaymentDate(input.paymentDate);

  await assertCorrectionAllowed();

  const paymentSourceId = await resolvePaymentSourceId(tx, {
    paymentMethodId: method.id,
  });
  const paymentNumber = await deps.generatePaymentNumber(tx);
  const kind =
    input.kind === 'FULL'
      ? PaymentDeclarationKind.FULL
      : PaymentDeclarationKind.PARTIAL;

  const payment = await tx.payment.create({
    data: {
      paymentNumber,
      storeOrderId,
      paymentDate,
      amount,
      currencyId: order.currencyId,
      paymentSourceId,
      paymentMethodId: method.id,
      receivingAccountId: null,
      origin: input.origin,
      declarationKind: kind,
      idempotencyKey,
      ...(agentDestination
        ? {
            agentId: agentDestination.agentId,
            destinationOwnership: agentDestination.ownership,
            agentPaymentDestinationId: agentDestination.id,
          }
        : {}),
      referenceNumber: input.referenceNumber?.trim() || undefined,
      senderName: order.partner?.name?.trim() || 'Customer',
      status: PaymentStatus.PENDING,
      createdBy: input.userId,
      updatedBy: input.userId,
    },
  });

  if (input.stagedAttachmentIds?.length && deps.finalizeAttachments) {
    await deps.finalizeAttachments(
      payment.id,
      storeOrderId,
      input.stagedAttachmentIds,
      input.userId,
      tx,
    );
  }

  const label = `${kind === PaymentDeclarationKind.FULL ? 'paid in full' : 'partially paid'} ${amount.toFixed(2)} via ${method.name}`;
  await tx.paymentActivity.create({
    data: {
      paymentId: payment.id,
      type: 'PAYMENT_DECLARED',
      description: `Customer payment declared (${input.origin}): ${label} — awaiting Finance verification`,
      metadata: {
        origin: input.origin,
        declarationKind: kind,
        paymentMethodId: method.id,
        idempotencyKey,
        userId: input.userId,
      },
    },
  });
  await tx.storeOrderActivity.create({
    data: {
      storeOrderId,
      action: 'PAYMENT_DECLARED',
      details: `Payment ${payment.paymentNumber} declared: ${label} (not verified by Finance)`,
      performedById: input.userId,
    },
  });

  // Finance-side status only moves Unpaid → "reported, awaiting review";
  // it never becomes Paid without verification. Both columns dual-written.
  if (order.paymentStatus === StoreOrderPaymentStatus.PAYMENT_PENDING) {
    const statusId = await deps.paymentStatusId(
      StoreOrderPaymentStatus.PAYMENT_REVIEW,
    );
    await tx.storeOrder.update({
      where: { id: storeOrderId },
      data: {
        paymentStatus: StoreOrderPaymentStatus.PAYMENT_REVIEW,
        ...(statusId ? { paymentStatusId: statusId } : {}),
      },
    });
  }

  const result = await recomputeDeclaredPaymentStatus(tx, storeOrderId);
  return {
    payment,
    created: true,
    declaredPaymentStatus:
      result?.declaredPaymentStatus ?? StoreOrderDeclaredPaymentStatus.UNPAID,
    declaredAmount: (result?.declaredAmount ?? 0).toFixed(2),
  };
}

/**
 * Agents milestone (spec §7): the payment destination of an agent-order
 * declaration — one of the order agent's ACTIVE destinations whose payment
 * method is active; an AGENT-owned destination only when the order's terms
 * snapshot allowed agent destinations. Company orders take no destination.
 */
export async function resolveAgentDeclarationDestination(
  tx: Prisma.TransactionClient,
  order: { agentId: string | null; agentTermsSnapshot: Prisma.JsonValue },
  destinationId: string | undefined,
  paymentMethodId: string | undefined,
) {
  if (!order.agentId) {
    if (destinationId) {
      throw new BadRequestException({
        code: 'AGENT_DESTINATION_NOT_APPLICABLE',
        message:
          'وجهة الدفع الخاصة بالوكلاء لا تنطبق على طلبات الشركة — Agent payment destinations apply to agent orders only.',
      });
    }
    return null;
  }
  if (!destinationId) {
    throw new BadRequestException({
      code: 'AGENT_DESTINATION_REQUIRED',
      message:
        'اختر وجهة الدفع المعتمدة للوكيل — Choose one of the agent’s authorized payment destinations.',
    });
  }
  const destination = await tx.agentPaymentDestination.findFirst({
    where: { id: destinationId, agentId: order.agentId, isActive: true },
    select: {
      id: true,
      agentId: true,
      ownership: true,
      paymentMethodId: true,
      paymentMethod: { select: { isActive: true, deletedAt: true } },
    },
  });
  if (
    !destination ||
    !destination.paymentMethod.isActive ||
    destination.paymentMethod.deletedAt
  ) {
    throw new BadRequestException({
      code: 'AGENT_DESTINATION_INVALID',
      message:
        'وجهة الدفع غير متاحة لهذا الوكيل — This payment destination is not available for the order’s agent.',
    });
  }
  if (paymentMethodId && paymentMethodId !== destination.paymentMethodId) {
    throw new BadRequestException({
      code: 'AGENT_DESTINATION_METHOD_MISMATCH',
      message:
        'طريقة الدفع لا تطابق وجهة الدفع المختارة — The payment method does not match the chosen destination.',
    });
  }
  if (destination.ownership === 'AGENT') {
    const snapshot = order.agentTermsSnapshot as {
      allowAgentDestinations?: boolean;
    } | null;
    if (!snapshot?.allowAgentDestinations) {
      throw new BadRequestException({
        code: 'AGENT_DESTINATION_NOT_ALLOWED',
        message:
          'اتفاقية هذا الطلب لا تسمح بالدفع مباشرة للوكيل — This order’s agreement does not allow payments straight to the agent.',
      });
    }
  }
  return destination;
}

export function isIdempotencyConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target)
    ? target.map(String).join(',')
    : typeof target === 'string'
      ? target
      : '';
  return text === '' || text.includes('idempotency');
}
