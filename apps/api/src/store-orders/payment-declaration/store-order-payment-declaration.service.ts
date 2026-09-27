import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import { AttachmentsService } from '../../common/storage/attachments.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PaymentDeclarationFieldsDto } from '../dto/declare-store-order-payment.dto';
import {
  declarePaymentInTx,
  findByIdempotencyKey,
  isIdempotencyConflict,
  type DeclarePaymentDeps,
  type DeclarePaymentResult,
} from './payment-declaration.core';

/** Declaring is allowed with EITHER permission (any-of). */
export const DECLARE_PAYMENT_PERMISSIONS = [
  'store-orders.edit',
  'sales.receipts.create',
] as const;
/** Holding one of these makes a post-fulfillment / post-posting change an allowed, audited correction. */
export const DECLARATION_CORRECTION_PERMISSIONS = [
  'store-orders.manage',
  'sales.receipts.confirm',
] as const;

export interface DeclarationActor {
  userId: string;
  origin: PaymentOrigin;
  allowCorrection: boolean;
}

@Injectable()
export class StoreOrderPaymentDeclarationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly statusResolver: WorkflowStatusResolverService,
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /**
   * Any-of permission check for declarations (the PermissionsGuard maps one
   * route to one permission, so the endpoint opts out of it and calls this).
   * Origin: FINANCE_DECLARATION when the caller holds `sales.receipts.confirm`
   * (Finance authority), otherwise SALES_DECLARATION.
   */
  async resolveActor(userId: string): Promise<DeclarationActor> {
    const has = (name: string) => this.permissions.hasPermission(userId, name);
    const [canEdit, canCreateReceipt, canManage, canConfirm] =
      await Promise.all([
        has(DECLARE_PAYMENT_PERMISSIONS[0]),
        has(DECLARE_PAYMENT_PERMISSIONS[1]),
        has(DECLARATION_CORRECTION_PERMISSIONS[0]),
        has(DECLARATION_CORRECTION_PERMISSIONS[1]),
      ]);
    // `store-orders.manage` is the broader store-order authority, so it may
    // declare as well (owner decision at integration).
    if (!canEdit && !canCreateReceipt && !canManage) {
      throw new ForbiddenException(
        'لا تملك صلاحية تسجيل إفادة دفع العميل — Missing permission "store-orders.edit", "store-orders.manage" or "sales.receipts.create" to declare a customer payment.',
      );
    }
    return {
      userId,
      origin: canConfirm
        ? PaymentOrigin.FINANCE_DECLARATION
        : PaymentOrigin.SALES_DECLARATION,
      allowCorrection: canManage || canConfirm,
    };
  }

  deps(): DeclarePaymentDeps {
    return {
      generatePaymentNumber: (tx) =>
        this.numberingEngine.generateNumber('PAYMENT', undefined, tx),
      paymentStatusId: (status) => this.statusResolver.paymentStatusId(status),
      finalizeAttachments: (paymentId, storeOrderId, ids, userId, tx) =>
        this.attachments.finalizeForPayment(
          paymentId,
          storeOrderId,
          ids,
          userId,
          tx,
        ),
    };
  }

  /** Inside an existing transaction (order create). */
  declareInTx(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    dto: PaymentDeclarationFieldsDto,
    idempotencyKey: string,
    actor: DeclarationActor,
  ): Promise<DeclarePaymentResult> {
    return declarePaymentInTx(tx, this.deps(), {
      storeOrderId,
      kind: dto.kind,
      amount: dto.amount,
      paymentMethodId: dto.paymentMethodId,
      currencyId: dto.currencyId,
      paymentDate: dto.paymentDate,
      referenceNumber: dto.referenceNumber,
      stagedAttachmentIds: dto.stagedAttachmentIds,
      idempotencyKey,
      origin: actor.origin,
      userId: actor.userId,
      allowCorrection: actor.allowCorrection,
    });
  }

  /**
   * `POST /store-orders/:id/payment-declaration`. One claim per idempotency
   * key: a concurrent duplicate either waits on the order row lock and then
   * sees the first claim, or loses the unique index race (P2002) and gets
   * the existing row back.
   */
  async declare(
    storeOrderId: string,
    dto: PaymentDeclarationFieldsDto,
    idempotencyKey: string,
    actor: DeclarationActor,
  ): Promise<DeclarePaymentResult> {
    try {
      return await this.prisma.$transaction(
        (tx) => this.declareInTx(tx, storeOrderId, dto, idempotencyKey, actor),
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (!isIdempotencyConflict(error)) throw error;
      const existing = await findByIdempotencyKey(
        this.prisma,
        idempotencyKey.trim(),
        storeOrderId,
      );
      if (!existing) throw error;
      const order = await this.prisma.storeOrder.findUniqueOrThrow({
        where: { id: storeOrderId },
        select: { declaredPaymentStatus: true, declaredAmount: true },
      });
      return {
        payment: existing,
        created: false,
        declaredPaymentStatus: order.declaredPaymentStatus,
        declaredAmount: Number(order.declaredAmount).toFixed(2),
      };
    }
  }
}
