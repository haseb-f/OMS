import { Injectable } from '@nestjs/common';
import { phoneSearchCandidates } from '../../common/phone/phone-number.service';
import { PaymentStatus, Prisma } from '@prisma/client';
import { evaluateShippingReadiness } from '../../store-orders/shipments/shipping-handoff';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import { storeOrderPayableTotal } from '../../store-orders/store-order-line-amount';
import {
  agentNotFound,
  agentStoreOrderWhere,
  resolveAgentVisibility,
  type AgentVisibility,
} from '../common/agent-visibility';
import { AgentOrdersService } from '../orders/agent-orders.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import type {
  AgentOrderPricingDto,
  ConvertAgentLeadDto,
  ConfirmCustomerTotalDto,
  CreateAgentOrderDto,
  DeclareAgentOrderPaymentDto,
} from '../orders/dto/agent-order.dto';
import { agentShippingPricingView } from '../pricing/agent-shipping-pricing-view';
import { periodBounds } from '../finance/agent-statement.service';
import {
  isAgentOrderDigitalOnly,
  readAgentCustomerSnapshot,
} from '../common/agent-terms';
import type { AgentPortalOrdersQueryDto } from './dto/agent-portal.dto';

const num = (value: Prisma.Decimal | number | null | undefined) =>
  value == null ? null : Number(value);

/** Portal URL for an evidence file (authorized by `AgentPortalService.getAttachmentFile`). */
export const portalAttachmentUrl = (attachmentId: string) =>
  `/agent-portal/attachments/${attachmentId}/file`;

const STATUS_SELECT = {
  select: { code: true, name: true, nameEn: true, color: true },
} as const;

/** List columns — never internal notes, cost/profit fields or staff emails. */
const ORDER_LIST_SELECT = {
  id: true,
  internalOrderId: true,
  /** Spec 1A — optimistic concurrency for amendments. */
  version: true,
  orderDate: true,
  createdAt: true,
  fulfillmentMethod: true,
  paymentType: true,
  pricingMode: true,
  merchandiseAmount: true,
  discountAmount: true,
  taxAmount: true,
  shippingCharge: true,
  serviceCharge: true,
  payableTotal: true,
  declaredPaymentStatus: true,
  declaredAmount: true,
  paymentStatus: true,
  paymentDiscrepancy: true,
  agentDispatchedAt: true,
  agentEarnedAt: true,
  shippingPricingStatus: true,
  customerTotalStatus: true,
  currency: { select: { id: true, code: true } },
  /** Only `.customer` / the contractual shipping fee are read (the customer as typed on this order — S1). */
  agentTermsSnapshot: true,
  partner: { select: { name: true, mobile: true } },
  employee: { select: { id: true, fullName: true } },
  fulfillmentStatus: STATUS_SELECT,
  items: {
    where: { deletedAt: null },
    select: { quantity: true, unitPrice: true, agreedAmount: true },
  },
} satisfies Prisma.StoreOrderSelect;

/**
 * Claim status as the agent sees it (spec §6.2/§7): a declaration is only a
 * declaration until Finance acts — never labelled "verified" before that.
 */
function claimVerification(status: PaymentStatus) {
  switch (status) {
    case PaymentStatus.PENDING:
      return 'DECLARED_AWAITING_FINANCE';
    case PaymentStatus.MATCHED:
      return 'FINANCE_MATCHED';
    case PaymentStatus.VERIFIED:
      return 'FINANCE_VERIFIED';
    case PaymentStatus.REJECTED:
      return 'REJECTED';
    case PaymentStatus.DISPUTED:
      return 'DISPUTED';
    default:
      return 'DECLARED_AWAITING_FINANCE';
  }
}

/**
 * Agent-portal order reads and writes (spec §6, §10). Writes delegate to
 * `AgentOrdersService` with the verified agent context; every response is
 * re-read through the caller's visibility and shaped for external users.
 */
@Injectable()
export class AgentPortalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly orders: AgentOrdersService,
    private readonly statements: AgentStatementService,
  ) {}

  visibility(agent: AgentRequestContext) {
    return resolveAgentVisibility(agent, this.resolver);
  }

  // ── Writes (delegated) ────────────────────────────────────────────────

  quote(agent: AgentRequestContext, dto: AgentOrderPricingDto) {
    return this.orders.quote(this.stripInternalFields(dto), {
      userId: agent.userId,
      agent,
    });
  }

  async create(
    agent: AgentRequestContext,
    dto: CreateAgentOrderDto,
    idempotencyKey?: string,
  ) {
    const created = await this.orders.createAgentOrder(
      {
        ...this.stripInternalFields(dto),
        ownerUserId: undefined,
        idempotencyKey: dto.idempotencyKey ?? idempotencyKey,
      },
      { userId: agent.userId, agent },
    );
    return this.withReplayFlag(created, await this.detail(agent, created.id));
  }

  async convertLead(
    agent: AgentRequestContext,
    leadId: string,
    dto: ConvertAgentLeadDto,
  ) {
    const created = await this.orders.convertAgentLead(
      leadId,
      this.stripInternalFields(dto),
      { userId: agent.userId, agent },
    );
    return this.withReplayFlag(created, await this.detail(agent, created.id));
  }

  /** Spec 1B — a retried submit keeps its `idempotentReplay` flag through the portal shape. */
  private withReplayFlag<T extends object>(created: object, detail: T) {
    return 'idempotentReplay' in created
      ? { ...detail, idempotentReplay: true as const }
      : detail;
  }

  async declare(
    agent: AgentRequestContext,
    orderId: string,
    dto: DeclareAgentOrderPaymentDto,
  ) {
    await this.orders.declareAgentOrderPayment(orderId, dto, {
      userId: agent.userId,
      agent,
    });
    return this.detail(agent, orderId);
  }

  /** Spec 2 — the agent (owner / admin) records the customer's agreement to the new total. */
  async confirmCustomerTotal(
    agent: AgentRequestContext,
    orderId: string,
    dto: ConfirmCustomerTotalDto,
  ) {
    await this.orders.confirmCustomerTotal(orderId, dto, {
      userId: agent.userId,
      agent,
    });
    return this.detail(agent, orderId);
  }

  /** Internal-staff-only DTO fields are dropped for agent callers. */
  private stripInternalFields<T extends AgentOrderPricingDto>(dto: T): T {
    return { ...dto, agentId: undefined, orderDate: undefined };
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  private listWhere(
    visibility: AgentVisibility,
    query: AgentPortalOrdersQueryDto,
  ): Prisma.StoreOrderWhereInput {
    const { start, end } = periodBounds(query.from, query.to);
    const where: Prisma.StoreOrderWhereInput = {
      ...agentStoreOrderWhere(visibility),
      ...(query.declaredPaymentStatus
        ? { declaredPaymentStatus: query.declaredPaymentStatus }
        : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.fulfillmentMethod
        ? { fulfillmentMethod: query.fulfillmentMethod }
        : {}),
      ...(query.fulfillmentStatusCode
        ? { fulfillmentStatus: { code: query.fulfillmentStatusCode } }
        : {}),
      ...(start || end
        ? {
            orderDate: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { internalOrderId: { contains: search, mode: 'insensitive' } },
        // O3 — the customer record may be shared with other scopes: search
        // the customer as typed on the order (snapshot), never the master
        // record's name; the mobile is the shared identity itself.
        {
          agentTermsSnapshot: {
            path: ['customer', 'name'],
            string_contains: search,
          },
        },
        { partner: { mobile: { contains: search } } },
        // The shared customer identity searched in any phone format (Arabic digits, national, 00/+).
        ...phoneSearchCandidates(search).flatMap((digits) => [
          { partner: { mobile: { contains: digits } } },
          { partner: { phone: { contains: digits } } },
        ]),
        { lead: { leadNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  async list(agent: AgentRequestContext, query: AgentPortalOrdersQueryDto) {
    const visibility = await this.visibility(agent);
    const where = this.listWhere(visibility, query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        select: ORDER_LIST_SELECT,
        orderBy: [{ orderDate: 'desc' }, { internalOrderId: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.presentListRow(row)),
      total,
      page,
      pageSize,
    };
  }

  private presentListRow(
    row: Prisma.StoreOrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>,
  ) {
    return {
      id: row.id,
      internalOrderId: row.internalOrderId,
      orderDate: row.orderDate,
      createdAt: row.createdAt,
      customer: this.orderCustomer(row),
      owner: row.employee,
      fulfillmentMethod: row.fulfillmentMethod,
      paymentType: row.paymentType,
      currency: row.currency,
      itemCount: row.items.length,
      breakdown: {
        mode: row.pricingMode,
        merchandiseAmount: num(row.merchandiseAmount),
        discountAmount: num(row.discountAmount),
        taxAmount: num(row.taxAmount),
        shippingCharge: num(row.shippingCharge),
        serviceCharge: num(row.serviceCharge),
        payableTotal: storeOrderPayableTotal(row),
      },
      /** Spec 2 — PENDING_METHOD: shipping (and a shipping-added total) is provisional. */
      shippingPricingStatus: row.shippingPricingStatus,
      customerTotalStatus: row.customerTotalStatus,
      declaredPaymentStatus: row.declaredPaymentStatus,
      declaredAmount: Number(row.declaredAmount),
      financePaymentStatus: row.paymentStatus,
      paymentDiscrepancy: row.paymentDiscrepancy,
      fulfillmentStatus: row.fulfillmentStatus,
      dispatchedAt: row.agentDispatchedAt,
      earnedAt: row.agentEarnedAt,
    };
  }

  /** Order detail inside the caller's visibility; anything else is 404. */
  async detail(agent: AgentRequestContext, orderId: string) {
    const visibility = await this.visibility(agent);
    const order = await this.prisma.storeOrder.findFirst({
      where: { id: orderId, ...agentStoreOrderWhere(visibility) },
      select: {
        ...ORDER_LIST_SELECT,
        shippingChargeSource: true,
        shippingRateAmount: true,
        shippingOverrideReason: true,
        shippingStage: true,
        deletedAt: true,
        paymentStatusDef: { select: { code: true } },
        paymentDiscrepancyReason: true,
        lead: { select: { id: true, leadNumber: true } },
        items: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            agreedAmount: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                nameEn: true,
                displayName: true,
                isInventoryItem: true,
              },
            },
          },
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            paymentNumber: true,
            paymentDate: true,
            createdAt: true,
            amount: true,
            declarationKind: true,
            referenceNumber: true,
            status: true,
            verifiedAt: true,
            rejectedAt: true,
            rejectionReason: true,
            destinationOwnership: true,
            currency: { select: { code: true } },
            paymentMethod: { select: { id: true, name: true } },
            agentPaymentDestination: {
              select: { id: true, label: true, ownership: true },
            },
            // Only evidence uploaded by this agent's own users (S8) — never
            // internal Finance evidence attached to the same claim.
            attachments: {
              where: {
                deletedAt: null,
                attachmentId: { not: null },
                attachment: { uploadedBy: { agentId: agent.agentId } },
              },
              select: {
                attachment: {
                  select: {
                    id: true,
                    originalName: true,
                    mimeType: true,
                    sizeBytes: true,
                    createdAt: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        },
        shipments: {
          where: { deletedAt: null },
          orderBy: { attemptNumber: 'asc' },
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            trackingNumber: true,
            isReship: true,
            createdAt: true,
            updatedAt: true,
            shippingStatus: { select: { code: true, name: true, color: true } },
            shippingCompany: { select: { id: true, name: true } },
          },
        },
        agentReturns: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            returnNumber: true,
            createdAt: true,
            merchandiseAmount: true,
            lines: true,
            reason: true,
          },
        },
      },
    });
    if (!order) throw agentNotFound('Order');

    const stages = await this.statements.paymentStages(agent.agentId, {
      storeOrderId: order.id,
    });
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const payableTotal = storeOrderPayableTotal(order);
    const claims = order.payments.map((payment) => {
      const stage = stageById.get(payment.id);
      return {
        id: payment.id,
        paymentNumber: payment.paymentNumber,
        paymentDate: payment.paymentDate,
        declaredAt: payment.createdAt,
        amount: Number(payment.amount),
        currencyCode: payment.currency.code,
        declarationKind: payment.declarationKind,
        reference: payment.referenceNumber,
        financeStatus: payment.status,
        verification: claimVerification(payment.status),
        verifiedAt: payment.verifiedAt,
        rejectedAt: payment.rejectedAt,
        rejectionReason: payment.rejectionReason,
        destination: payment.agentPaymentDestination
          ? {
              id: payment.agentPaymentDestination.id,
              label: payment.agentPaymentDestination.label,
              ownership: payment.agentPaymentDestination.ownership,
            }
          : null,
        ownership: payment.destinationOwnership,
        method: payment.paymentMethod,
        stage: stage?.stage ?? null,
        availableAt: stage?.availableAt ?? null,
        paidOutAmount: stage?.paidOutAmount ?? 0,
        attachments: payment.attachments
          .map((link) => link.attachment)
          .filter((a): a is NonNullable<typeof a> => !!a && a.deletedAt == null)
          .map((a) => ({
            attachmentId: a.id,
            fileName: a.originalName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            createdAt: a.createdAt,
            fileUrl: portalAttachmentUrl(a.id),
          })),
      };
    });
    const confirmedAmount = (statuses: PaymentStatus[]) =>
      Math.round(
        order.payments
          .filter((p) => statuses.includes(p.status))
          .reduce((s, p) => s + Number(p.amount) * 100, 0),
      ) / 100;

    return {
      id: order.id,
      internalOrderId: order.internalOrderId,
      version: order.version,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      owner: order.employee,
      lead: order.lead,
      customer: await this.orderCustomerDetail(order),
      fulfillmentMethod: order.fulfillmentMethod,
      paymentType: order.paymentType,
      currency: order.currency,
      lines: order.items.map((item) => ({
        id: item.id,
        product: item.product,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        lineAmount: Number(item.agreedAmount),
      })),
      breakdown: {
        mode: order.pricingMode,
        merchandiseAmount: num(order.merchandiseAmount),
        discountAmount: num(order.discountAmount),
        taxAmount: num(order.taxAmount),
        shippingCharge: num(order.shippingCharge),
        shippingChargeSource: order.shippingChargeSource,
        shippingRateAmount: num(order.shippingRateAmount),
        shippingOverrideReason: order.shippingOverrideReason,
        serviceCharge: num(order.serviceCharge),
        payableTotal,
      },
      /** Spec 2 — customer shipping + contractual fee only (never carrier cost or margin). */
      shippingPricing: agentShippingPricingView(
        order,
        confirmedAmount([PaymentStatus.VERIFIED]),
      ),
      payment: {
        declaredPaymentStatus: order.declaredPaymentStatus,
        declaredAmount: Number(order.declaredAmount),
        /** Finance-verified amount — separate from what was declared. */
        financeVerifiedAmount: confirmedAmount([PaymentStatus.VERIFIED]),
        financeMatchedAmount: confirmedAmount([PaymentStatus.MATCHED]),
        financePaymentStatus: order.paymentStatus,
        paymentDiscrepancy: order.paymentDiscrepancy,
        paymentDiscrepancyReason: order.paymentDiscrepancyReason,
        remainingToDeclare: Math.max(
          0,
          Math.round((payableTotal - Number(order.declaredAmount)) * 100) / 100,
        ),
        claims,
      },
      fulfillment: {
        status: order.fulfillmentStatus,
        shippingStage: order.shippingStage,
        /**
         * R6 SHIP — read-only: why a shipping order has not reached the
         * company Shipping team yet (blocker code only; null = in Shipping).
         */
        shippingBlocker:
          order.fulfillmentMethod === 'SHIPPING' && order.shipments.length === 0
            ? evaluateShippingReadiness(order).blocker
            : null,
        dispatchedAt: order.agentDispatchedAt,
        earnedAt: order.agentEarnedAt,
        /** No inventory line (frozen stock flag): nothing to ship — completed once earned. */
        digitalOnly: isAgentOrderDigitalOnly(order),
        pickup:
          order.fulfillmentMethod === 'PICKUP'
            ? { status: order.fulfillmentStatus }
            : null,
        shipments: order.shipments.map((s) => ({
          id: s.id,
          attemptNumber: s.attemptNumber,
          status: s.status,
          carrierStatus: s.shippingStatus,
          shippingCompany: s.shippingCompany,
          trackingNumber: s.trackingNumber,
          isReship: s.isReship,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      },
      returns: order.agentReturns.map((r) => ({
        id: r.id,
        returnNumber: r.returnNumber,
        createdAt: r.createdAt,
        merchandiseAmount: Number(r.merchandiseAmount),
        lines: r.lines,
        reason: r.reason,
      })),
      timeline: this.timeline(order, claims),
    };
  }

  /**
   * The customer shown to the agent (S1): exactly what was typed on this
   * order (snapshot). Orders created before the snapshot existed show only
   * name + mobile of the order's partner — never another party's address.
   */
  private orderCustomer(row: {
    agentTermsSnapshot: Prisma.JsonValue;
    partner: { name: string; mobile: string | null };
  }) {
    const typed = readAgentCustomerSnapshot(row.agentTermsSnapshot);
    return typed
      ? { name: typed.name, mobile: typed.mobile }
      : { name: row.partner.name, mobile: row.partner.mobile };
  }

  private async orderCustomerDetail(row: {
    agentTermsSnapshot: Prisma.JsonValue;
    partner: { name: string; mobile: string | null };
  }) {
    const typed = readAgentCustomerSnapshot(row.agentTermsSnapshot);
    if (!typed) {
      return {
        ...this.orderCustomer(row),
        city: null,
        address: null,
        country: null,
      };
    }
    const country = typed.countryId
      ? await this.prisma.country.findUnique({
          where: { id: typed.countryId },
          select: { id: true, name: true, nameEn: true },
        })
      : null;
    return {
      name: typed.name,
      mobile: typed.mobile,
      city: typed.city,
      address: typed.address,
      country,
    };
  }

  /**
   * Timeline built from business events only (never internal activity rows,
   * notes or staff identities).
   */
  private timeline(
    order: {
      createdAt: Date;
      agentDispatchedAt: Date | null;
      agentEarnedAt: Date | null;
      shipments: Array<{
        attemptNumber: number;
        createdAt: Date;
        status: string | null;
      }>;
      agentReturns: Array<{ returnNumber: string; createdAt: Date }>;
    },
    claims: Array<{
      paymentNumber: string;
      declaredAt: Date;
      amount: number;
      verifiedAt: Date | null;
      rejectedAt: Date | null;
      financeStatus: PaymentStatus;
    }>,
  ) {
    const events: Array<{ at: Date; event: string; reference?: string }> = [
      { at: order.createdAt, event: 'ORDER_CREATED' },
    ];
    for (const claim of claims) {
      events.push({
        at: claim.declaredAt,
        event: 'PAYMENT_DECLARED',
        reference: claim.paymentNumber,
      });
      if (claim.verifiedAt) {
        events.push({
          at: claim.verifiedAt,
          event: 'PAYMENT_FINANCE_VERIFIED',
          reference: claim.paymentNumber,
        });
      }
      if (claim.rejectedAt) {
        events.push({
          at: claim.rejectedAt,
          event:
            claim.financeStatus === PaymentStatus.DISPUTED
              ? 'PAYMENT_DISPUTED'
              : 'PAYMENT_REJECTED',
          reference: claim.paymentNumber,
        });
      }
    }
    for (const shipment of order.shipments) {
      events.push({
        at: shipment.createdAt,
        event: 'SHIPMENT_CREATED',
        reference: `#${shipment.attemptNumber}`,
      });
    }
    if (order.agentDispatchedAt) {
      events.push({ at: order.agentDispatchedAt, event: 'DISPATCHED' });
    }
    if (order.agentEarnedAt) {
      events.push({ at: order.agentEarnedAt, event: 'EARNING_EVENT_REACHED' });
    }
    for (const ret of order.agentReturns) {
      events.push({
        at: ret.createdAt,
        event: 'RETURN_RECEIVED',
        reference: ret.returnNumber,
      });
    }
    return events.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
}
