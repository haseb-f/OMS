import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreOrderDuplicateReviewStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from '../../partners/partners.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { storeOrderPayableTotal } from '../store-order-line-amount';
import { DUPLICATE_ACTIVITY } from './duplicate-outcome';
import type { ResolveDuplicateReviewDto } from './dto/duplicate.dto';

const REVIEW_ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  orderDate: true,
  createdAt: true,
  paymentStatus: true,
  payableTotal: true,
  duplicateReviewStatus: true,
  duplicateReviewedAt: true,
  duplicateReviewNote: true,
  duplicateReviewedBy: { select: { id: true, fullName: true } },
  currency: { select: { code: true } },
  agent: { select: { id: true, name: true, agentNumber: true } },
  employee: { select: { id: true, fullName: true } },
  fulfillmentStatus: { select: { code: true, name: true, nameEn: true } },
  items: {
    where: { deletedAt: null },
    select: { quantity: true, unitPrice: true, agreedAmount: true },
  },
} satisfies Prisma.StoreOrderSelect;

type ReviewOrderRow = Prisma.StoreOrderGetPayload<{
  select: typeof REVIEW_ORDER_SELECT;
}>;

/**
 * Round 5 Spec 1B — the internal reviewer's side of a cross-scope duplicate
 * (`store-orders.duplicate_review`). The reviewer sees both sides whatever
 * their sales scope: the flagged order and every other customer holding the
 * same phone, with their recent orders. Resolution only records the verdict;
 * a confirmed duplicate is cancelled through the order's normal flow.
 */
@Injectable()
export class StoreOrderDuplicateReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
    private readonly phones: PhoneNumberService,
  ) {}

  async detail(orderId: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        ...REVIEW_ORDER_SELECT,
        partner: {
          select: {
            id: true,
            partnerNumber: true,
            name: true,
            phone: true,
            mobile: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Store Order not found');

    const phones = [order.partner.mobile, order.partner.phone]
      .map((value) => this.phones.normalizeToE164(value))
      .filter((value): value is string => !!value);
    const others = (
      await Promise.all(
        [...new Set(phones)].map((phone) =>
          this.partners.lookupAllByPhone(phone),
        ),
      )
    )
      .flat()
      .filter(
        (partner, index, all) =>
          partner.id !== order.partner.id &&
          all.findIndex((row) => row.id === partner.id) === index,
      );
    const otherOrders = others.length
      ? await this.prisma.storeOrder.findMany({
          where: {
            partnerId: { in: others.map((partner) => partner.id) },
            deletedAt: null,
            id: { not: order.id },
          },
          select: { ...REVIEW_ORDER_SELECT, partnerId: true },
          orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
          take: 50,
        })
      : [];

    return {
      order: {
        ...this.presentOrder(order),
        customer: order.partner,
        duplicateReviewStatus: order.duplicateReviewStatus,
        reviewedBy: order.duplicateReviewedBy,
        reviewedAt: order.duplicateReviewedAt,
        reviewNote: order.duplicateReviewNote,
      },
      matches: others
        .map((partner) => ({
          customer: {
            id: partner.id,
            partnerNumber: partner.partnerNumber,
            name: partner.name,
            phone: partner.mobile ?? partner.phone,
          },
          orders: otherOrders
            .filter((row) => row.partnerId === partner.id)
            .slice(0, 5)
            .map((row) => this.presentOrder(row)),
        }))
        .filter((match) => match.orders.length > 0),
    };
  }

  async resolve(
    orderId: string,
    dto: ResolveDuplicateReviewDto,
    userId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.updateMany({
        where: {
          id: orderId,
          deletedAt: null,
          duplicateReviewStatus: StoreOrderDuplicateReviewStatus.PENDING,
        },
        data: {
          duplicateReviewStatus: dto.decision,
          duplicateReviewedById: userId,
          duplicateReviewedAt: new Date(),
          duplicateReviewNote: dto.note ?? null,
          updatedBy: userId,
        },
      });
      if (updated.count === 0) {
        const exists = await tx.storeOrder.findFirst({
          where: { id: orderId, deletedAt: null },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException('Store Order not found');
        throw new ConflictException({
          code: 'DUPLICATE_REVIEW_NOT_PENDING',
          message:
            'تمت مراجعة هذا الطلب مسبقًا — This order has no pending duplicate review.',
        });
      }
      await tx.storeOrderActivity.create({
        data: {
          storeOrderId: orderId,
          action: DUPLICATE_ACTIVITY.REVIEW_RESOLVED,
          details: `${dto.decision === 'CONFIRMED_DUPLICATE' ? 'Confirmed duplicate — cancel it through the order’s normal flow' : 'Confirmed distinct customer order'}${dto.note ? `: ${dto.note}` : ''}`,
          performedById: userId,
        },
      });
    });
    return this.detail(orderId);
  }

  private presentOrder(row: ReviewOrderRow) {
    return {
      id: row.id,
      orderNumber: row.internalOrderId,
      orderDate: row.orderDate,
      createdAt: row.createdAt,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      total: storeOrderPayableTotal(row),
      currencyCode: row.currency?.code ?? null,
      agent: row.agent,
      owner: row.employee,
    };
  }
}
