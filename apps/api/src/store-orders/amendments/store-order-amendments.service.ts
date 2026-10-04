import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PaymentStatus,
  Prisma,
  SalesDocumentStatus,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  StoreOrderShippingStage,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import { StoreOrdersService } from '../store-orders.service';
import { StoreOrderPaymentSyncService } from '../store-order-payment-sync.service';
import { lockStoreOrderRow } from '../store-order-payment-settlement.util';
import {
  derivedUnitPrice,
  storeOrderLineAmount,
  storeOrderPayableTotal,
} from '../store-order-line-amount';
import {
  declaredStatusFor,
  recomputeDeclaredPaymentStatus,
} from '../payment-declaration/payment-declaration.core';
import { StoreOrderDuplicatesService } from '../duplicates/store-order-duplicates.service';
import { assertCompanyOwnedProduct } from '../../products/assert-company-owned-products.util';
import {
  AgentOrdersService,
  type AgentOrderActor,
  type FrozenShipping,
} from '../../agents/orders/agent-orders.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { createHash } from 'node:crypto';
import {
  agentOrderColumns,
  agentOrderInitialStage,
  type AgentOrderPersistInput,
} from '../../agents/orders/agent-order-persist';
import { resolveAgentCustomerPartner } from '../../agents/orders/agent-customer';
import {
  PartnerPhoneInUseError,
  findPartnerIdByPhone,
  syncPartnerPhoneKeys,
} from '../../partners/partner-phone-keys';
import { AgentFulfillmentService } from '../../agents/finance/agent-fulfillment.service';
import { deliveryChannelOf } from '../../agents/pricing/agent-shipping-tariff';
import { repriceForConfirmedFee } from '../../agents/pricing/agent-shipping-reprice';
import {
  readAgentCustomerSnapshot,
  type AgentCustomerSnapshot,
  type AgentOrderSnapshot,
} from '../../agents/common/agent-terms';
import { agentForbidden } from '../../agents/common/agent-errors';
import { agentNotFound } from '../../agents/common/agent-visibility';
import {
  amendmentImpact,
  amendmentWindow,
  lineAllocationBlocked,
  blockingImpacts,
  hasAnyChange,
  missingAcknowledgements,
  money,
  touchesInvoice,
  touchesShippedContents,
  type AmendmentChangeKinds,
  type AmendmentImpact,
} from './amendment-impacts';
import type {
  AmendChangesDto,
  AmendmentCommitDto,
} from './dto/amend-store-order.dto';

type Db = Prisma.TransactionClient | PrismaService;

/** Who amends — `agent` is the server-verified portal context, never a client field. */
export interface AmendmentActor {
  userId: string;
  agent?: AgentRequestContext;
}

export const ORDER_AMENDED_ACTIVITY = 'ORDER_AMENDED';
export const LABEL_REISSUE_ACTIVITY = 'LABEL_REISSUE_REQUIRED';
const AMENDMENT_DISCREPANCY_SUFFIX = ' (order amendment).';

/** Stable digest of the previewed impacts (codes + amounts) — a changed set is a stale preview. */
export function impactsFingerprint(impacts: AmendmentImpact[]): string {
  const canonical = impacts.map((i) => [
    i.code,
    i.severity,
    Object.keys(i.params ?? {})
      .sort()
      .map((key) => [key, i.params[key]]),
  ]);
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 32);
}

const EPSILON = 0.005;
const DRAFT_INVOICE_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.DRAFT,
  SalesDocumentStatus.PENDING_APPROVAL,
  SalesDocumentStatus.APPROVED,
];

const ORDER_SELECT = {
  id: true,
  internalOrderId: true,
  deliveryCountryId: true,
  deliveryCity: true,
  deliveryAddress: true,
  version: true,
  deletedAt: true,
  orderDate: true,
  partnerId: true,
  employeeId: true,
  currencyId: true,
  paymentType: true,
  fulfillmentMethod: true,
  shippingStage: true,
  agentId: true,
  agentTermsSnapshot: true,
  agentDispatchedAt: true,
  agentEarnedAt: true,
  pricingMode: true,
  merchandiseAmount: true,
  discountAmount: true,
  taxAmount: true,
  shippingCharge: true,
  shippingChargeSource: true,
  shippingRateAmount: true,
  shippingOverrideReason: true,
  serviceCharge: true,
  payableTotal: true,
  shippingPricingStatus: true,
  customerTotalStatus: true,
  declaredPaymentStatus: true,
  declaredAmount: true,
  paymentStatus: true,
  paymentDiscrepancy: true,
  paymentDiscrepancyReason: true,
  updatedAt: true,
  updatedBy: true,
  currency: { select: { id: true, code: true } },
  partner: {
    select: {
      id: true,
      name: true,
      phone: true,
      mobile: true,
      email: true,
      countryId: true,
      city: true,
      address: true,
      country: { select: { code: true } },
    },
  },
  fulfillmentStatus: { select: { code: true } },
  items: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      agreedAmount: true,
      product: { select: { name: true, displayName: true } },
      investmentAllocations: { select: { status: true } },
      reallocations: { select: { status: true } },
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      trackingNumber: true,
      attemptNumber: true,
      shippingCompany: { select: { id: true, type: true } },
    },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      paymentNumber: true,
      amount: true,
      status: true,
      currency: { select: { code: true } },
    },
  },
  invoices: {
    where: {
      deletedAt: null,
      status: { not: SalesDocumentStatus.CANCELLED },
    },
    select: { id: true, invoiceNumber: true, status: true },
  },
} satisfies Prisma.StoreOrderSelect;

type LoadedOrder = Prisma.StoreOrderGetPayload<{
  select: typeof ORDER_SELECT;
}>;

interface NextLine {
  itemId: string | null;
  productId: string;
  quantity: number;
  agreedAmount: number;
  unitPrice: number;
}

interface CustomerSnapshotView {
  partnerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  countryId: string | null;
  city: string | null;
  address: string | null;
}

/** Everything the commit writes, derived once by `plan()` (preview = plan without writes). */
interface AmendmentPlan {
  order: LoadedOrder;
  isAgentOrder: boolean;
  kinds: AmendmentChangeKinds;
  impacts: AmendmentImpact[];
  lines: NextLine[];
  total: number;
  currencyId: string;
  currencyCode: string;
  paymentType: StoreOrderPaymentType;
  fulfillmentMethod: StoreOrderFulfillmentMethod;
  /** Company order: partner master corrections (identity + destination). */
  partnerUpdate: Prisma.PartnerUpdateInput | null;
  /** Company order that has its OWN delivery destination (R11): the destination amendment is written there, never to the customer master. */
  orderDeliveryUpdate: {
    deliveryCountryId: string | null;
    deliveryCity: string | null;
    deliveryAddress: string | null;
  } | null;
  /** Company order: switch to this existing customer. */
  switchToPartnerId: string | null;
  /** Agent order: the full re-quote to persist. */
  agentQuote: AgentOrderPersistInput | null;
  /** Agent order: the typed customer's mobile changed — re-link the customer. */
  agentRelinkCustomer: boolean;
  agentReviewPending: boolean;
  /** Agent order: the typed customer written into the snapshot. */
  agentCustomer: AgentCustomerSnapshot | null;
  customerBefore: CustomerSnapshotView;
  customerAfter: CustomerSnapshotView;
  changes: Record<string, unknown>;
}

/** R11 — the order carries its own delivery destination (any of the three fields set). */
function hasOwnDestination(order: {
  deliveryCountryId: string | null;
  deliveryCity: string | null;
  deliveryAddress: string | null;
}): boolean {
  return !!(
    order.deliveryCountryId ||
    order.deliveryCity ||
    order.deliveryAddress
  );
}

const num = (value: Prisma.Decimal | number | string | null | undefined) =>
  value == null ? 0 : Number(value);

const sameMoney = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/**
 * Round 5 Spec 1A — guided order amendments until delivery.
 *
 * Two steps: `preview` computes the impact report without writing; `commit`
 * re-evaluates the same plan inside one transaction under the order row lock,
 * refuses a stale `expectedVersion` (409 ORDER_VERSION_CONFLICT), any
 * blocking impact, or a missing acknowledgement, then writes the change, the
 * recomputed totals and payment state, one append-only `StoreOrderAmendment`
 * row and an `ORDER_AMENDED` timeline entry. Posted payments and posted
 * invoices are never edited; agent orders are fully re-quoted through
 * `AgentOrdersService.quoteAmendment` (the same `prepare()` as submission).
 */
@Injectable()
export class StoreOrderAmendmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeOrders: StoreOrdersService,
    private readonly agentOrders: AgentOrdersService,
    private readonly duplicates: StoreOrderDuplicatesService,
    private readonly resolver: PermissionsResolverService,
    private readonly numbering: NumberingEngineService,
    private readonly phones: PhoneNumberService,
    private readonly statusResolver: WorkflowStatusResolverService,
    private readonly paymentSync: StoreOrderPaymentSyncService,
    private readonly agentFulfillment: AgentFulfillmentService,
    private readonly salesScope: SalesScopeService,
  ) {}

  // ── Public operations ───────────────────────────────────────────────────

  async preview(
    orderId: string,
    changes: AmendChangesDto,
    actor: AmendmentActor,
  ) {
    await this.assertAccess(orderId, actor);
    const plan = await this.plan(this.prisma, orderId, changes, actor);
    return this.present(plan);
  }

  async commit(
    orderId: string,
    dto: AmendmentCommitDto,
    actor: AmendmentActor,
  ) {
    await this.assertAccess(orderId, actor);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, orderId);
        const head = await tx.storeOrder.findUniqueOrThrow({
          where: { id: orderId },
          select: { version: true, updatedAt: true, updatedBy: true },
        });
        if (head.version !== dto.expectedVersion) {
          throw await this.versionConflict(tx, head);
        }
        const plan = await this.plan(tx, orderId, dto.changes, actor);
        // The acknowledgements were given for the previewed amounts: a
        // different impact set (e.g. a payment posted meanwhile) is stale.
        if (
          dto.impactsFingerprint &&
          dto.impactsFingerprint !== impactsFingerprint(plan.impacts)
        ) {
          throw new ConflictException({
            code: 'AMENDMENT_PREVIEW_STALE',
            message:
              'The impact of this amendment changed since the preview — review it again.',
            details: { impacts: plan.impacts },
          });
        }
        const blocking = blockingImpacts(plan.impacts);
        if (blocking.length > 0) {
          throw new UnprocessableEntityException({
            code: 'AMENDMENT_BLOCKED',
            message: blocking.map((i) => i.message).join(' '),
            details: { impacts: plan.impacts },
          });
        }
        const missing = missingAcknowledgements(
          plan.impacts,
          dto.acknowledgements,
        );
        if (missing.length > 0) {
          throw new ConflictException({
            code: 'AMENDMENT_ACKNOWLEDGEMENT_REQUIRED',
            message: `Acknowledge before saving: ${missing.join(', ')}.`,
            details: { missing, impacts: plan.impacts },
          });
        }
        return this.apply(tx, plan, dto, actor);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    const invoice = result.regenerateInvoice
      ? await this.regenerateInvoice(orderId, actor.userId)
      : null;
    return {
      amendmentId: result.amendmentId,
      version: result.version,
      impacts: result.impacts,
      invoiceRegeneration: invoice,
    };
  }

  /** Amendment history of one order (internal detail / agent portal detail). */
  async list(orderId: string, actor: AmendmentActor) {
    await this.assertAccess(orderId, actor);
    const rows = await this.prisma.storeOrderAmendment.findMany({
      where: { storeOrderId: orderId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        reason: true,
        actorType: true,
        createdAt: true,
        changes: true,
        impacts: true,
        previousSnapshot: !actor.agent,
        actor: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      reason: row.reason,
      actorType: row.actorType,
      actorName: row.actor?.fullName ?? null,
      createdAt: row.createdAt,
      changes: row.changes,
      impacts: row.impacts,
      ...(actor.agent ? {} : { previousSnapshot: row.previousSnapshot }),
    }));
  }

  // ── Access ──────────────────────────────────────────────────────────────

  /**
   * Internal: the order through the caller's sales scope (404 otherwise);
   * agent orders also need `agents.view`. Agent users: their agent and
   * record visibility only — another agent's order is simply not found.
   */
  private async assertAccess(orderId: string, actor: AmendmentActor) {
    if (actor.agent) {
      const resolved = await this.agentOrders.resolveActor(
        this.agentActor(actor),
      );
      await this.agentOrders.findAgentOrderForActor(orderId, resolved);
      return;
    }
    const order = await this.storeOrders.findOne(orderId, actor.userId);
    if (
      order.agentId &&
      !(await this.resolver.hasPermission(actor.userId, 'agents.view'))
    ) {
      throw agentForbidden(
        'PERMISSION_REQUIRED',
        'تعديل طلب وكيل يتطلب صلاحية عرض الوكلاء',
        'Amending an agent order requires agents.view.',
      );
    }
  }

  private agentActor(actor: AmendmentActor): AgentOrderActor {
    return { userId: actor.userId, agent: actor.agent };
  }

  // ── Plan (shared by preview and commit) ─────────────────────────────────

  private async plan(
    db: Db,
    orderId: string,
    changes: AmendChangesDto,
    actor: AmendmentActor,
  ): Promise<AmendmentPlan> {
    const order = await db.storeOrder.findFirst({
      where: { id: orderId },
      select: ORDER_SELECT,
    });
    if (!order) throw agentNotFound('Order');
    const isAgentOrder = Boolean(order.agentId);
    const impacts: AmendmentImpact[] = [];

    // Customer before / after. A company-order switch starts from the new
    // customer's own record; corrections are compared against that base.
    const customerBefore = this.customerView(order);
    if (
      isAgentOrder &&
      changes.customer?.partnerId &&
      changes.customer.partnerId !== order.partnerId
    ) {
      throw new BadRequestException({
        code: 'AGENT_ORDER_CUSTOMER_SWITCH',
        message:
          'An agent order’s customer is identified by the typed name and mobile — correct those instead of choosing another customer.',
      });
    }
    const switchToPartnerId =
      !isAgentOrder &&
      changes.customer?.partnerId &&
      changes.customer.partnerId !== order.partnerId
        ? changes.customer.partnerId
        : null;
    const customerBase = switchToPartnerId
      ? await this.switchTarget(db, switchToPartnerId, actor, impacts)
      : customerBefore;
    const customerAfter: CustomerSnapshotView = { ...customerBase };
    if (changes.destination) {
      customerAfter.countryId = changes.destination.countryId ?? null;
      customerAfter.city = changes.destination.city?.trim() || null;
      customerAfter.address = changes.destination.address?.trim() || null;
    }
    if (changes.customer) {
      if (changes.customer.name !== undefined) {
        customerAfter.name = changes.customer.name.trim();
      }
      if (changes.customer.phone !== undefined) {
        customerAfter.phone = await this.normalizePhone(
          db,
          changes.customer.phone,
          customerAfter.countryId,
        );
      }
      if (changes.customer.email !== undefined && !isAgentOrder) {
        customerAfter.email = changes.customer.email.trim() || null;
      }
    }

    const currencyId = changes.currencyId ?? order.currencyId;
    const paymentType = changes.paymentType ?? order.paymentType;
    const fulfillmentMethod =
      changes.fulfillmentMethod ?? order.fulfillmentMethod;

    // Lines (the full list replaces the current one).
    const requested = changes.items ?? null;
    const byId = new Map(order.items.map((item) => [item.id, item]));
    if (requested) {
      const seen = new Set<string>();
      for (const line of requested) {
        if (!line.itemId) continue;
        if (!byId.has(line.itemId) || seen.has(line.itemId)) {
          throw new BadRequestException(
            `Line ${line.itemId} does not belong to Store Order ${order.internalOrderId}.`,
          );
        }
        seen.add(line.itemId);
      }
    }

    let lines: NextLine[];
    let total: number;
    let agentQuote: AgentOrderPersistInput | null = null;
    let currencyCode = order.currency.code;

    // The shipping destination is the order's effective address: switching
    // to a customer with another address moves the parcel too.
    const differs = (a: CustomerSnapshotView, b: CustomerSnapshotView) =>
      a.countryId !== b.countryId ||
      (a.city ?? '') !== (b.city ?? '') ||
      (a.address ?? '') !== (b.address ?? '');
    const destinationChanged = differs(customerAfter, customerBefore);
    // R11 — an order delivered to its own address keeps that address on the
    // order: amending the destination never rewrites the customer master.
    const ownDestination = hasOwnDestination(order);
    /** Company customer master address to write (differs from that customer's own record). */
    const partnerAddressChanged =
      !isAgentOrder &&
      !ownDestination &&
      !!changes.destination &&
      differs(customerAfter, customerBase);
    const orderDeliveryUpdate =
      !isAgentOrder && ownDestination && destinationChanged
        ? {
            deliveryCountryId: customerAfter.countryId,
            deliveryCity: customerAfter.city?.trim() || null,
            deliveryAddress: customerAfter.address?.trim() || null,
          }
        : null;

    const kinds: AmendmentChangeKinds = {
      items: false,
      amounts: false,
      currency: currencyId !== order.currencyId,
      paymentType: paymentType !== order.paymentType,
      fulfillmentMethod: fulfillmentMethod !== order.fulfillmentMethod,
      destination: destinationChanged,
      customerSwitch: !!switchToPartnerId,
      customerCorrection:
        customerAfter.name !== customerBase.name ||
        (customerAfter.phone ?? '') !== (customerBase.phone ?? '') ||
        (customerAfter.email ?? '') !== (customerBase.email ?? ''),
      pricing:
        isAgentOrder &&
        ((changes.pricingMode !== undefined &&
          changes.pricingMode !== order.pricingMode) ||
          (changes.agreedTotal !== undefined &&
            !sameMoney(changes.agreedTotal, num(order.payableTotal)))),
    };
    if (requested) this.classifyLines(order, requested, kinds);
    if (!hasAnyChange(kinds)) {
      throw new BadRequestException({
        code: 'AMENDMENT_NO_CHANGES',
        message: 'Nothing to amend — change at least one field.',
      });
    }

    const needsRequote =
      isAgentOrder &&
      (kinds.items ||
        kinds.amounts ||
        kinds.currency ||
        kinds.paymentType ||
        kinds.fulfillmentMethod ||
        kinds.destination ||
        kinds.pricing);
    let agentCustomer: AgentCustomerSnapshot | null = null;
    if (isAgentOrder && !needsRequote) {
      // Customer contact only: the typed customer on the order snapshot
      // changes; prices, tariff and commission stay as submitted.
      lines = await this.companyLines(db, order, null);
      total = num(order.payableTotal);
      agentCustomer = {
        name: customerAfter.name,
        mobile: customerAfter.phone,
        countryId: customerAfter.countryId,
        city: customerAfter.city,
        address: customerAfter.address,
      };
    } else if (isAgentOrder) {
      // Spec 2 freeze: without a destination / payment type / method /
      // currency change the order keeps its shipping terms and frozen
      // per-channel tariffs (a charge never carries into another currency).
      const frozenShipping =
        kinds.destination ||
        kinds.paymentType ||
        kinds.fulfillmentMethod ||
        kinds.currency
          ? null
          : this.frozenShipping(order);
      if (!frozenShipping && order.shippingChargeSource === 'MANUAL') {
        impacts.push(
          amendmentImpact(
            'AGENT_SHIPPING_OVERRIDE_DROPPED',
            `The manual shipping charge ${money(num(order.shippingCharge))} no longer applies — shipping is re-priced from the agreement for the new destination / payment type.`,
            { previous: money(num(order.shippingCharge)) },
          ),
        );
      }
      const quote = await this.agentOrders.quoteAmendment(
        {
          pricingMode:
            changes.pricingMode ?? order.pricingMode ?? 'SHIPPING_ADDED',
          lines: (requested ?? this.currentLines(order)).map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            lineAmount: line.agreedAmount,
          })),
          agreedTotal:
            changes.agreedTotal ??
            ((changes.pricingMode ?? order.pricingMode) === 'SHIPPING_INCLUDED'
              ? num(order.payableTotal)
              : undefined),
          fulfillmentMethod,
          paymentType,
          countryId: customerAfter.countryId ?? undefined,
          city: customerAfter.city ?? undefined,
          address: customerAfter.address ?? undefined,
          serviceCharge: num(order.serviceCharge),
          currencyId: changes.currencyId,
          agentId: order.agentId!,
        },
        this.agentActor(actor),
        {
          orderDate: order.orderDate,
          employeeId: order.employeeId,
          frozenShipping,
          customer: {
            name: customerAfter.name,
            mobile: customerAfter.phone,
            countryId: customerAfter.countryId,
            city: customerAfter.city,
            address: customerAfter.address,
          },
        },
      );
      for (const issue of quote.issues) {
        impacts.push(
          amendmentImpact('AGENT_PRICING_INVALID', issue.message, {
            issueCode: issue.code,
            lineKey: issue.lineKey ?? null,
          }),
        );
      }
      agentQuote = quote.persist;
      agentCustomer = agentQuote?.customer ?? null;
      const source = requested ?? this.currentLines(order);
      lines = agentQuote
        ? agentQuote.lines.map((line, index) => ({
            itemId: source[index]?.itemId ?? null,
            productId: line.productId,
            quantity: line.quantity,
            agreedAmount: line.agreedAmount,
            unitPrice: line.unitPrice,
          }))
        : source.map((line) => ({
            itemId: line.itemId ?? null,
            productId: line.productId,
            quantity: line.quantity,
            agreedAmount: line.agreedAmount ?? 0,
            unitPrice: derivedUnitPrice(line.quantity, line.agreedAmount ?? 0),
          }));
      total = agentQuote ? agentQuote.payableTotal : num(order.payableTotal);
      // A re-quote replaces line amounts (allocation) even when the input
      // lines are unchanged — that is an amount change of the order.
      if (agentQuote) {
        const current = this.currentLines(order);
        if (
          agentQuote.lines.length === current.length &&
          agentQuote.lines.some(
            (line, index) =>
              !sameMoney(line.agreedAmount, current[index].agreedAmount ?? 0),
          )
        ) {
          kinds.amounts = true;
        }
      }
    } else {
      lines = await this.companyLines(db, order, requested);
      total = lines.reduce((sum, line) => sum + line.agreedAmount, 0);
    }
    const nextCurrencyId = agentQuote?.currencyId ?? currencyId;
    if (nextCurrencyId !== order.currencyId) {
      kinds.currency = true;
      const currency = await db.currency.findFirst({
        where: { id: nextCurrencyId },
        select: { code: true },
      });
      if (!currency) {
        throw new BadRequestException(`Currency ${nextCurrencyId} not found.`);
      }
      currencyCode = currency.code;
    }
    // Shipping already chose the delivery method: the payable is the one the
    // confirmed fee yields (the commit re-resolves it the same way).
    if (isAgentOrder && agentQuote) {
      total = this.agentPricingImpacts(order, agentQuote, impacts);
    }
    total = Math.round(total * 100) / 100;

    // ── Editable window ──
    const latest = order.shipments[0] ?? null;
    const window = amendmentWindow({
      archived: order.deletedAt != null,
      fulfillmentCode: order.fulfillmentStatus?.code,
      latestShipmentStatus: latest?.status,
    });
    if (window === 'LOCKED') {
      impacts.unshift(
        amendmentImpact(
          'ORDER_LOCKED_AFTER_DELIVERY',
          `Order ${order.internalOrderId} is delivered, collected, returned, cancelled or archived — use the return / refund / adjustment workflows.`,
          { orderNumber: order.internalOrderId },
        ),
      );
    } else if (window === 'IN_TRANSIT' && touchesShippedContents(kinds)) {
      impacts.push(
        amendmentImpact(
          'ORDER_IN_TRANSIT',
          'The shipment is on its way — items, quantities, address and fulfillment method cannot change; use a return / reshipment. Prices and customer contact can still change.',
          { tracking: latest?.trackingNumber ?? null },
        ),
      );
    }

    // ── Agent orders ──
    if (isAgentOrder) {
      if (order.agentEarnedAt) {
        impacts.push(
          amendmentImpact(
            'AGENT_COMMISSION_EARNED',
            'The agent commission of this order is already earned — use the agent return / adjustment workflow.',
          ),
        );
      }
      if (order.agentDispatchedAt) {
        impacts.push(
          amendmentImpact(
            'AGENT_STOCK_ISSUED',
            'The agent stock of this order was already issued — use the agent return / adjustment workflow.',
          ),
        );
      }
      if (
        actor.agent &&
        (order.payments.some((p) => p.status === PaymentStatus.VERIFIED) ||
          order.invoices.length > 0)
      ) {
        impacts.push(
          amendmentImpact(
            'AGENT_FINANCIAL_RECORDS',
            'This order has a posted payment or invoice — ask the company’s agent manager to amend it.',
          ),
        );
      }
    }

    // ── Totals and payments ──
    const previousTotal = Math.round(storeOrderPayableTotal(order) * 100) / 100;
    const totalChanged = !sameMoney(previousTotal, total);
    if (total <= EPSILON && window !== 'LOCKED') {
      impacts.push(
        amendmentImpact(
          'ORDER_TOTAL_ZERO',
          'The order total must be greater than 0.00 — enter the agreed amount of at least one line.',
        ),
      );
    }
    // A label carries the contents, the address and — cash on delivery — the
    // amount the carrier collects: any of them changing needs a new label.
    const collectionChanged =
      kinds.paymentType || (paymentType === 'CASH_ON_DELIVERY' && totalChanged);
    if (
      window === 'OPEN' &&
      latest?.status === 'LABEL_CREATED' &&
      (touchesShippedContents(kinds) || collectionChanged)
    ) {
      impacts.push(
        amendmentImpact(
          'LABEL_REISSUE_REQUIRED',
          `Label ${latest.trackingNumber ?? `#${latest.attemptNumber}`} must be cancelled and reissued.`,
          { tracking: latest.trackingNumber ?? `#${latest.attemptNumber}` },
        ),
      );
    }
    this.allocationImpacts(order, lines, impacts);
    if (totalChanged) {
      impacts.push(
        amendmentImpact(
          'TOTALS_CHANGED',
          `Order total ${money(previousTotal)} ${order.currency.code} → ${money(total)} ${currencyCode}.`,
          {
            previous: money(previousTotal),
            previousCurrency: order.currency.code,
            next: money(total),
            currency: currencyCode,
          },
        ),
      );
    }
    this.paymentImpacts(
      order,
      kinds,
      total,
      totalChanged,
      currencyCode,
      impacts,
    );

    // ── Invoice (company orders) ──
    if (touchesInvoice(kinds)) {
      for (const invoice of order.invoices) {
        if (DRAFT_INVOICE_STATUSES.includes(invoice.status)) {
          impacts.push(
            amendmentImpact(
              'INVOICE_DRAFT_CANCELLED',
              `Draft invoice ${invoice.invoiceNumber} will be cancelled and a new invoice issued from the amended order.`,
              { invoice: invoice.invoiceNumber },
            ),
          );
        } else {
          impacts.push(
            amendmentImpact(
              'INVOICE_POSTED',
              `Sales Invoice ${invoice.invoiceNumber} is posted and is never changed. Correct it with a Sales Return (Sales → Returns) referencing ${invoice.invoiceNumber}, and record the difference as a separate order.`,
              { invoice: invoice.invoiceNumber },
            ),
          );
        }
      }
    }

    // ── Customer ──
    let partnerUpdate: Prisma.PartnerUpdateInput | null = null;
    let agentRelinkCustomer = false;
    let agentReviewPending = false;
    if (isAgentOrder) {
      if (
        agentCustomer?.mobile &&
        agentCustomer.mobile !== (customerBefore.phone ?? null)
      ) {
        agentRelinkCustomer = true;
        const scope = actor.agent
          ? await this.duplicates.agentScope(actor.agent)
          : {
              kind: 'AGENT' as const,
              agentId: order.agentId!,
              userId: actor.userId,
              visibility: null,
            };
        const match = await this.duplicates.check(
          { phone: agentCustomer.mobile, countryId: agentCustomer.countryId },
          scope,
        );
        if (match.kind === 'PHONE' && match.crossScope) {
          agentReviewPending = true;
          impacts.push(
            amendmentImpact(
              'CUSTOMER_DUPLICATE_REVIEW',
              'The new mobile matches a customer outside your scope — the order is flagged for duplicate review.',
            ),
          );
        } else if (
          match.kind === 'PHONE' &&
          !match.crossScope &&
          match.customer.id !== order.partnerId
        ) {
          impacts.push(
            amendmentImpact(
              'CUSTOMER_RELINKED',
              `The new mobile belongs to the existing customer ${match.customer.name} — the order is linked to that customer.`,
              { customer: match.customer.name },
            ),
          );
        }
      }
    } else {
      const partnerId = switchToPartnerId ?? order.partnerId;
      const correction = kinds.customerCorrection || partnerAddressChanged;
      if (correction) {
        partnerUpdate = await this.companyCustomerImpacts(
          db,
          order,
          partnerId,
          customerBase,
          customerAfter,
          { ...kinds, destination: partnerAddressChanged },
          actor,
          impacts,
        );
      }
    }

    const knownNames = new Set(order.items.map((item) => item.productId));
    const addedIds = [
      ...new Set(
        lines.map((l) => l.productId).filter((id) => !knownNames.has(id)),
      ),
    ];
    const productNames = new Map(
      addedIds.length
        ? (
            await db.product.findMany({
              where: { id: { in: addedIds } },
              select: { id: true, name: true, displayName: true },
            })
          ).map((p) => [p.id, p.displayName || p.name] as const)
        : [],
    );

    // A locked order shows only the lock.
    const finalImpacts =
      window === 'LOCKED'
        ? impacts.filter((i) => i.code === 'ORDER_LOCKED_AFTER_DELIVERY')
        : impacts;

    return {
      order,
      isAgentOrder,
      kinds,
      impacts: finalImpacts,
      lines,
      total,
      currencyId: nextCurrencyId,
      currencyCode,
      paymentType,
      fulfillmentMethod,
      partnerUpdate,
      orderDeliveryUpdate,
      switchToPartnerId,
      agentQuote,
      agentRelinkCustomer,
      agentReviewPending,
      agentCustomer,
      customerBefore,
      customerAfter,
      changes: this.describeChanges(
        order,
        kinds,
        lines,
        total,
        customerBefore,
        customerAfter,
        {
          productNames,
          currencyCode,
          paymentType,
          fulfillmentMethod,
          pricingMode: agentQuote?.pricingMode ?? order.pricingMode,
        },
      ),
    };
  }

  /** Marks `items` (product / quantity / add / remove) vs `amounts` (agreed amount only). */
  private classifyLines(
    order: LoadedOrder,
    requested: NonNullable<AmendChangesDto['items']>,
    kinds: AmendmentChangeKinds,
  ) {
    const byId = new Map(order.items.map((item) => [item.id, item]));
    const kept = new Set(requested.map((l) => l.itemId).filter(Boolean));
    if (order.items.some((item) => !kept.has(item.id))) kinds.items = true;
    for (const line of requested) {
      const item = line.itemId ? byId.get(line.itemId) : undefined;
      if (!item) {
        kinds.items = true;
        continue;
      }
      if (
        item.productId !== line.productId ||
        item.quantity !== line.quantity
      ) {
        kinds.items = true;
      }
      if (
        line.agreedAmount !== undefined &&
        !sameMoney(line.agreedAmount, storeOrderLineAmount(item))
      ) {
        kinds.amounts = true;
      }
    }
  }

  private currentLines(order: LoadedOrder) {
    return order.items.map((item) => ({
      itemId: item.id,
      productId: item.productId,
      quantity: item.quantity,
      agreedAmount: storeOrderLineAmount(item),
    }));
  }

  /** Company lines: agreed amounts entered by the user; products active and company-owned. */
  private async companyLines(
    db: Db,
    order: LoadedOrder,
    requested: AmendChangesDto['items'] | null,
  ): Promise<NextLine[]> {
    if (!requested) {
      return order.items.map((item) => ({
        itemId: item.id,
        productId: item.productId,
        quantity: item.quantity,
        agreedAmount: storeOrderLineAmount(item),
        unitPrice: Number(item.unitPrice),
      }));
    }
    const existing = new Map(order.items.map((item) => [item.id, item]));
    const newProductIds = [
      ...new Set(
        requested
          .filter((l) => {
            const item = l.itemId ? existing.get(l.itemId) : undefined;
            return !item || item.productId !== l.productId;
          })
          .map((l) => l.productId),
      ),
    ];
    if (newProductIds.length > 0) {
      const products = await db.product.findMany({
        where: { id: { in: newProductIds }, deletedAt: null },
        select: { id: true, status: true, ownerAgentId: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      for (const id of newProductIds) {
        const product = byId.get(id);
        if (!product || product.status !== 'ACTIVE') {
          throw new BadRequestException(
            `Product ${id} not found or is not active.`,
          );
        }
        assertCompanyOwnedProduct(product);
      }
    }
    return requested.map((line) => {
      const item = line.itemId ? existing.get(line.itemId) : undefined;
      const agreedAmount =
        line.agreedAmount ?? (item ? storeOrderLineAmount(item) : undefined);
      if (agreedAmount === undefined) {
        throw new BadRequestException(
          'Enter the agreed amount of every new line.',
        );
      }
      return {
        itemId: item?.id ?? null,
        productId: line.productId,
        quantity: line.quantity,
        agreedAmount,
        unitPrice: derivedUnitPrice(line.quantity, agreedAmount),
      };
    });
  }

  /**
   * Re-quote impacts of an agent order and the payable it ends at: with the
   * delivery method already chosen, the commit re-resolves the fee for that
   * channel (`AgentShippingPricingService`), so the preview applies the same
   * `repriceForConfirmedFee` and reports that payable — never the
   * provisional one.
   */
  private agentPricingImpacts(
    order: LoadedOrder,
    quote: AgentOrderPersistInput,
    impacts: AmendmentImpact[],
  ): number {
    const snapshot =
      order.agentTermsSnapshot as unknown as AgentOrderSnapshot | null;
    const before = snapshot?.agentShippingCharge ?? null;
    const after = quote.agentShippingCharge;
    const company = order.shipments[0]?.shippingCompany ?? null;
    let status = quote.shippingPricingStatus;
    let fee = after?.amount ?? null;
    let payable = quote.payableTotal;
    if (
      company &&
      after?.byChannel &&
      quote.fulfillmentMethod === 'SHIPPING' &&
      !quote.digitalOnly &&
      quote.shippingPricingStatus !== 'NOT_APPLICABLE'
    ) {
      const channel = deliveryChannelOf(company.type);
      const tariff = after.byChannel[channel];
      if (!tariff) {
        impacts.push(
          amendmentImpact(
            'AGENT_SHIPPING_TARIFF_MISSING',
            `The agent agreement has no shipping tariff for the assigned delivery method (${channel}) × ${quote.paymentType} × the new destination — add it to the agreement or ask Shipping to choose another delivery method first.`,
            { deliveryChannel: channel, paymentType: quote.paymentType },
          ),
        );
        return payable;
      }
      const repriced = repriceForConfirmedFee({
        mode: quote.pricingMode,
        merchandiseAmount: quote.merchandiseAmount,
        taxAmount: quote.taxAmount,
        serviceCharge: quote.serviceCharge,
        shippingCharge: quote.shippingCharge,
        payableTotal: quote.payableTotal,
        lines: quote.lines.map((line, index) => ({
          id: String(index),
          quantity: line.quantity,
          amount: line.agreedAmount,
        })),
        fee: tariff.amount,
      });
      if (repriced.kind === 'REFUSED') {
        impacts.push(
          amendmentImpact(
            'AGENT_PRICING_INVALID',
            `رسم الشحن (${money(repriced.fee)}) لا يترك مبلغًا للمنتجات ضمن الإجمالي المتفق عليه (${money(repriced.agreedTotal)}) — The shipping fee (${money(repriced.fee)}) leaves no merchandise amount within the agreed total (${money(repriced.agreedTotal)}).`,
            {
              issueCode: repriced.code,
              fee: money(repriced.fee),
              agreedTotal: money(repriced.agreedTotal),
            },
          ),
        );
        return payable;
      }
      // A higher confirmed payable (shipping added) waits for the customer's
      // agreement; until then the provisional payable stands.
      if (repriced.kind === 'APPLY') payable = repriced.payableTotal;
      status = 'CONFIRMED';
      fee = tariff.amount;
    }
    impacts.push(
      amendmentImpact(
        'AGENT_REQUOTED',
        `Re-quoted under agreement ${quote.agentTermsSnapshot.agreementNumber}: payable ${money(num(order.payableTotal))} → ${money(payable)}; the commission snapshot is replaced (the previous one is kept in the amendment history).`,
        {
          agreement: quote.agentTermsSnapshot.agreementNumber,
          previous: money(num(order.payableTotal)),
          next: money(payable),
        },
      ),
    );
    const feeChanged =
      (before?.amount ?? null) !== fee ||
      order.shippingPricingStatus !== status;
    if (feeChanged && (before || after)) {
      impacts.push(
        amendmentImpact(
          'AGENT_SHIPPING_REPRICED',
          `Agent shipping fee ${before ? money(before.amount) : '—'} (${order.shippingPricingStatus}) → ${fee == null ? '—' : money(fee)} (${status}).`,
          {
            previous: before ? money(before.amount) : null,
            next: fee == null ? null : money(fee),
            previousStatus: order.shippingPricingStatus,
            nextStatus: status,
          },
        ),
      );
    }
    return payable;
  }

  /** The order's current shipping terms, carried forward by a re-quote (Spec 2 freeze). */
  private frozenShipping(order: LoadedOrder): FrozenShipping {
    const snapshot =
      order.agentTermsSnapshot as unknown as AgentOrderSnapshot | null;
    const lines = snapshot?.lines;
    return {
      digitalOnly: lines ? lines.every((line) => !line.inventoryLine) : false,
      charge: num(order.shippingCharge),
      source: order.shippingChargeSource ?? 'NONE',
      rateAmount:
        order.shippingRateAmount == null ? null : num(order.shippingRateAmount),
      overrideReason: order.shippingOverrideReason,
      agentShippingCharge: snapshot?.agentShippingCharge ?? null,
      shippingPricingStatus: order.shippingPricingStatus,
    };
  }

  /**
   * Investment allocations pin a sold line (quantity, product, amount): a
   * change needs the allocation reversed first; a removal is impossible
   * while any allocation row references the line.
   */
  private allocationImpacts(
    order: LoadedOrder,
    lines: NextLine[],
    impacts: AmendmentImpact[],
  ) {
    const next = new Map(
      lines.filter((l) => l.itemId).map((l) => [l.itemId!, l]),
    );
    for (const item of order.items) {
      const line = next.get(item.id);
      const blocked = lineAllocationBlocked({
        removed: !line,
        changed:
          !!line &&
          (line.productId !== item.productId ||
            line.quantity !== item.quantity ||
            !sameMoney(line.agreedAmount, storeOrderLineAmount(item))),
        allocationStatuses: item.investmentAllocations.map((a) => a.status),
        reallocationStatuses: item.reallocations.map((r) => r.status),
      });
      if (blocked) {
        const product =
          item.product?.displayName || item.product?.name || item.productId;
        impacts.push(
          amendmentImpact(
            'LINE_HAS_ALLOCATIONS',
            `Line ${product} is allocated to an investment opportunity — reverse that allocation first.`,
            { product },
          ),
        );
      }
    }
  }

  private paymentImpacts(
    order: LoadedOrder,
    kinds: AmendmentChangeKinds,
    total: number,
    totalChanged: boolean,
    currencyCode: string,
    impacts: AmendmentImpact[],
  ) {
    const payments = order.payments;
    const posted = payments.filter(
      (p) =>
        p.status === PaymentStatus.VERIFIED ||
        p.status === PaymentStatus.MATCHED,
    );
    const unposted = payments.filter(
      (p) =>
        p.status === PaymentStatus.PENDING ||
        p.status === PaymentStatus.MATCHED ||
        p.status === PaymentStatus.DISPUTED,
    );
    if (kinds.currency) {
      const first = posted[0];
      if (first) {
        impacts.push(
          amendmentImpact(
            'CURRENCY_LOCKED_BY_PAYMENT',
            `Reverse or refund payment ${first.paymentNumber} (${money(num(first.amount))} ${first.currency.code}) first — a posted or matched payment keeps the order currency.`,
            {
              payment: first.paymentNumber,
              amount: money(num(first.amount)),
              currency: first.currency.code,
            },
          ),
        );
      } else if (unposted.length > 0) {
        impacts.push(
          amendmentImpact(
            'CURRENCY_DECLARATIONS_REVIEW',
            `${unposted.length} payment declaration(s) stay in ${order.currency.code}; the order is flagged for Finance review.`,
            { count: unposted.length, currency: order.currency.code },
          ),
        );
      }
    }
    if (!totalChanged) return;
    const standing = payments
      .filter(
        (p) =>
          p.status === PaymentStatus.PENDING ||
          p.status === PaymentStatus.MATCHED ||
          p.status === PaymentStatus.VERIFIED,
      )
      .reduce((sum, p) => sum + num(p.amount), 0);
    const verified = payments
      .filter((p) => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + num(p.amount), 0);
    if (unposted.length > 0) {
      const nextStatus = declaredStatusFor(standing, total);
      impacts.push(
        amendmentImpact(
          'DECLARATION_REEVALUATED',
          standing > total + EPSILON
            ? `Declared ${money(standing)} exceeds the new total ${money(total)} ${currencyCode}: declarations are kept unchanged and the order is flagged as a payment discrepancy.`
            : `Declarations are kept unchanged (${money(standing)}); the declared status becomes ${nextStatus} against the new total ${money(total)} ${currencyCode}.`,
          {
            declared: money(standing),
            next: money(total),
            status: nextStatus,
            exceeds: standing > total + EPSILON ? 1 : 0,
          },
        ),
      );
    }
    if (verified > EPSILON) {
      if (total + EPSILON < verified) {
        impacts.push(
          amendmentImpact(
            'PAYMENT_OVERPAID_REFUND',
            `Posted payments ${money(verified)} exceed the new total ${money(total)} ${currencyCode}: the order becomes Overpaid by ${money(verified - total)}. Posted payments are not changed — refund the excess through Finance → Customer refunds.`,
            {
              paid: money(verified),
              next: money(total),
              excess: money(verified - total),
              currency: currencyCode,
            },
          ),
        );
      } else {
        impacts.push(
          amendmentImpact(
            'PAYMENT_STATUS_REEVALUATED',
            `Posted payments ${money(verified)} stay unchanged; the payment status is re-evaluated against ${money(total)} ${currencyCode}.`,
            {
              paid: money(verified),
              next: money(total),
              currency: currencyCode,
            },
          ),
        );
      }
    }
  }

  /**
   * The customer a company order switches to. Spec 1B rule: an agent's
   * customer (or a record that is not a customer) is never attached to a
   * company order.
   */
  private async switchTarget(
    db: Db,
    partnerId: string,
    actor: AmendmentActor,
    impacts: AmendmentImpact[],
  ): Promise<CustomerSnapshotView> {
    const partner = await db.partner.findFirst({
      where: { id: partnerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        mobile: true,
        email: true,
        countryId: true,
        city: true,
        address: true,
        agent: { select: { id: true } },
        roles: { select: { role: true } },
        _count: {
          select: {
            storeOrders: { where: { agentId: null, deletedAt: null } },
          },
        },
        storeOrders: {
          where: { agentId: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!partner) {
      throw new BadRequestException(`Customer ${partnerId} not found.`);
    }
    const agentOwned =
      partner.agent != null ||
      (partner.storeOrders.length > 0 && partner._count.storeOrders === 0);
    if (
      agentOwned ||
      !partner.roles.some((r) => r.role === 'CUSTOMER') ||
      !(await this.customerInSalesScope(db, partner.id, actor.userId))
    ) {
      impacts.push(
        amendmentImpact(
          'CUSTOMER_OUT_OF_SCOPE',
          'This customer cannot be attached to a company order — choose a company customer.',
        ),
      );
    }
    return {
      partnerId: partner.id,
      name: partner.name,
      phone: partner.phone ?? partner.mobile,
      email: partner.email,
      countryId: partner.countryId,
      city: partner.city,
      address: partner.address,
    };
  }

  /**
   * The sales scope of the caller (same rule as the order lists and the
   * duplicate check): all-scope users, a customer with an order the caller
   * may open, or a customer with no order and no lead outside the scope.
   */
  private async customerInSalesScope(
    db: Db,
    partnerId: string,
    userId: string,
  ): Promise<boolean> {
    const scope = await this.salesScope.resolve(userId);
    if (scope.kind === 'ALL') return true;
    const visible = await db.storeOrder.count({
      where: {
        partnerId,
        deletedAt: null,
        agentId: null,
        ...this.salesScope.storeOrderWhere(scope),
      },
    });
    if (visible > 0) return true;
    const [orders, foreignLeads] = await Promise.all([
      db.storeOrder.count({ where: { partnerId, deletedAt: null } }),
      db.lead.count({
        where: { partnerId, NOT: this.salesScope.leadWhere(scope) },
      }),
    ]);
    return orders === 0 && foreignLeads === 0;
  }

  /** E.164 against the destination country (then without one); invalid → 400. */
  private async normalizePhone(
    db: Db,
    raw: string,
    countryId: string | null,
  ): Promise<string | null> {
    if (!raw.trim()) return null;
    const country = countryId
      ? await db.country.findFirst({
          where: { id: countryId },
          select: { code: true },
        })
      : null;
    const normalized =
      this.phones.normalizeToE164(raw, country?.code) ??
      this.phones.normalizeToE164(raw);
    if (!normalized) {
      throw new BadRequestException({
        code: 'CUSTOMER_PHONE_INVALID',
        message: 'The customer phone number is not valid.',
      });
    }
    return normalized;
  }

  /**
   * Company order customer master correction (identity needs `partners.edit`)
   * and destination: the phone must not belong to another customer (same
   * rule as the create duplicate check); a customer with other orders is a
   * shared master record — acknowledged.
   */
  private async companyCustomerImpacts(
    db: Db,
    order: LoadedOrder,
    partnerId: string,
    before: CustomerSnapshotView,
    after: CustomerSnapshotView,
    kinds: AmendmentChangeKinds,
    actor: AmendmentActor,
    impacts: AmendmentImpact[],
  ): Promise<Prisma.PartnerUpdateInput | null> {
    const data: Prisma.PartnerUpdateInput = {};
    if (kinds.customerCorrection) {
      if (!(await this.resolver.hasPermission(actor.userId, 'partners.edit'))) {
        impacts.push(
          amendmentImpact(
            'CUSTOMER_PERMISSION_REQUIRED',
            'Correcting the customer’s name, phone or email needs the "partners.edit" permission.',
          ),
        );
        return null;
      }
      if (after.name !== before.name) data.name = after.name;
      if ((after.email ?? '') !== (before.email ?? ''))
        data.email = after.email || null;
      if ((after.phone ?? '') !== (before.phone ?? '')) {
        const normalized = after.phone;
        if (normalized) {
          // O3 — one phone = one customer: any other partner holding the
          // number (with or without orders, any scope) blocks the correction.
          const owner = await findPartnerIdByPhone(db, [normalized], partnerId);
          if (owner) {
            const match = await this.duplicates.check(
              { phone: normalized },
              { kind: 'COMPANY', userId: actor.userId },
            );
            const named =
              match.kind === 'PHONE' &&
              !match.crossScope &&
              match.customer.id === owner
                ? match.customer.name
                : null;
            impacts.push(
              amendmentImpact(
                'CUSTOMER_PHONE_IN_USE',
                named
                  ? `This phone belongs to customer ${named} — switch the order to that customer instead.`
                  : 'This phone belongs to another customer outside your scope — it cannot be moved to this customer.',
                { customer: named },
              ),
            );
          }
        }
        data.phone = normalized;
        data.mobile = normalized;
      }
    }
    if (kinds.destination) {
      data.country = after.countryId
        ? { connect: { id: after.countryId } }
        : { disconnect: true };
      data.city = after.city;
      data.address = after.address;
    }
    const others = await db.storeOrder.count({
      where: { partnerId, deletedAt: null, id: { not: order.id } },
    });
    if (others > 0) {
      impacts.push(
        amendmentImpact(
          'CUSTOMER_MASTER_SHARED',
          `The customer record is shared by ${others} other order(s) — the correction applies to the customer everywhere.`,
          { count: others },
        ),
      );
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  // ── Commit writes ───────────────────────────────────────────────────────

  private async apply(
    tx: Prisma.TransactionClient,
    plan: AmendmentPlan,
    dto: AmendmentCommitDto,
    actor: AmendmentActor,
  ) {
    const { order } = plan;
    const userId = actor.userId;
    const acknowledged = [...new Set(dto.acknowledgements ?? [])].filter(
      (code) => plan.impacts.some((i) => i.code === code),
    );

    // Lines: update kept, create new, remove dropped (the amendment row keeps them).
    if (plan.kinds.items || plan.kinds.amounts || plan.agentQuote) {
      const keep = new Set(plan.lines.map((l) => l.itemId).filter(Boolean));
      const removed = order.items.filter((item) => !keep.has(item.id));
      if (removed.length > 0) {
        await tx.storeOrderItem.deleteMany({
          where: { id: { in: removed.map((i) => i.id) } },
        });
      }
      for (const line of plan.lines) {
        const data = {
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          agreedAmount: line.agreedAmount,
        };
        if (line.itemId) {
          await tx.storeOrderItem.update({ where: { id: line.itemId }, data });
        } else {
          await tx.storeOrderItem.create({
            data: { ...data, storeOrderId: order.id },
          });
        }
      }
    }

    // Customer.
    let partnerId = plan.switchToPartnerId ?? order.partnerId;
    if (plan.partnerUpdate) {
      const before = await tx.partner.findUniqueOrThrow({
        where: { id: partnerId },
        select: {
          phone: true,
          mobile: true,
          country: { select: { code: true } },
        },
      });
      const updated = await tx.partner.update({
        where: { id: partnerId },
        data: { ...plan.partnerUpdate, updatedBy: userId },
        select: {
          phone: true,
          mobile: true,
          country: { select: { code: true } },
        },
      });
      // O3 — the corrected phone is claimed race-safely (a concurrent
      // claim of the same number refuses the commit).
      await syncPartnerPhoneKeys(
        tx,
        this.phones,
        partnerId,
        before,
        updated,
        updated.country?.code,
      ).catch((error: unknown) => {
        throw error instanceof PartnerPhoneInUseError
          ? new ConflictException({
              code: 'CUSTOMER_PHONE_IN_USE',
              message:
                'This phone belongs to another customer — it cannot be moved to this customer.',
            })
          : error;
      });
    }
    if (plan.orderDeliveryUpdate) {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: plan.orderDeliveryUpdate,
      });
    }
    if (plan.isAgentOrder && plan.agentRelinkCustomer && plan.agentCustomer) {
      // O3 — the partner owning the new mobile (any scope) is reused, never
      // updated; a match outside the agent's scope was flagged for review.
      partnerId = await resolveAgentCustomerPartner(
        tx,
        { numbering: this.numbering, phones: this.phones },
        plan.agentCustomer,
        userId,
      );
    }

    // Order row.
    const data: Prisma.StoreOrderUncheckedUpdateInput = {
      partnerId,
      currencyId: plan.currencyId,
      paymentType: plan.paymentType,
      fulfillmentMethod: plan.fulfillmentMethod,
      updatedBy: userId,
      version: { increment: 1 },
    };
    if (plan.kinds.fulfillmentMethod || this.digitalOnlyChanged(plan)) {
      Object.assign(data, this.initialStage(plan));
    }
    if (plan.agentQuote) {
      Object.assign(data, agentOrderColumns(plan.agentQuote), {
        // The re-quote supersedes a pending customer-total agreement.
        customerTotalStatus: 'NONE',
      });
    } else if (plan.isAgentOrder && plan.agentCustomer) {
      data.agentTermsSnapshot = {
        ...(order.agentTermsSnapshot as unknown as AgentOrderSnapshot),
        customer: plan.agentCustomer,
      } as unknown as Prisma.InputJsonValue;
    }
    if (plan.agentReviewPending) {
      data.duplicateReviewStatus = 'PENDING';
    }
    await tx.storeOrder.update({ where: { id: order.id }, data });

    // Label issued before the change: must be cancelled and reissued.
    const latest = order.shipments[0];
    if (
      plan.impacts.some((i) => i.code === 'LABEL_REISSUE_REQUIRED') &&
      latest
    ) {
      await tx.shipment.update({
        where: { id: latest.id },
        data: {
          labelReissueRequired: true,
          labelReissueRequestedAt: new Date(),
          labelReissueRequestedById: userId,
          updatedBy: userId,
        },
      });
      await tx.storeOrderActivity.create({
        data: {
          storeOrderId: order.id,
          action: LABEL_REISSUE_ACTIVITY,
          details: `Label ${latest.trackingNumber ?? `#${latest.attemptNumber}`} must be cancelled and reissued — the order was amended after it was issued.`,
          performedById: userId,
        },
      });
    }

    // Draft invoices are cancelled (a posted one blocked the plan).
    let regenerateInvoice = false;
    if (touchesInvoice(plan.kinds)) {
      for (const invoice of order.invoices) {
        if (!DRAFT_INVOICE_STATUSES.includes(invoice.status)) continue;
        await tx.salesInvoice.update({
          where: { id: invoice.id },
          data: {
            status: SalesDocumentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledBy: userId,
            updatedBy: userId,
          },
        });
        await tx.salesInvoiceActivity.create({
          data: {
            salesInvoiceId: invoice.id,
            type: 'INVOICE_CANCELLED',
            description: `Sales Invoice ${invoice.invoiceNumber} cancelled — Store Order ${order.internalOrderId} was amended`,
            createdBy: userId,
          },
        });
        regenerateInvoice = true;
      }
    }

    // Agent order with a chosen delivery method: re-resolve the tariff.
    if (
      plan.agentQuote &&
      latest?.shippingCompany &&
      plan.fulfillmentMethod === 'SHIPPING' &&
      !order.agentDispatchedAt
    ) {
      await this.agentFulfillment.onShippingCompanyAssigned(
        tx,
        order.id,
        userId,
      );
    }

    // Payment state (after the final payable is known): declarations kept,
    // re-evaluated; posted payments untouched.
    const declared = await recomputeDeclaredPaymentStatus(tx, order.id);
    const discrepancies: string[] = [];
    if (declared && declared.declaredAmount > declared.total + EPSILON) {
      discrepancies.push(
        `Declared ${money(declared.declaredAmount)} exceeds the amended total ${money(declared.total)}`,
      );
    }
    if (plan.impacts.some((i) => i.code === 'CURRENCY_DECLARATIONS_REVIEW')) {
      discrepancies.push(
        `Order currency changed ${order.currency.code} → ${plan.currencyCode}; declarations in ${order.currency.code} need Finance review`,
      );
    }
    if (discrepancies.length > 0) {
      await tx.storeOrder.update({
        where: { id: order.id },
        data: {
          paymentDiscrepancy: true,
          paymentDiscrepancyReason:
            `${discrepancies.join('. ')}${AMENDMENT_DISCREPANCY_SUFFIX}`.slice(
              0,
              1000,
            ),
        },
      });
    } else if (
      order.paymentDiscrepancy &&
      order.paymentDiscrepancyReason?.endsWith(AMENDMENT_DISCREPANCY_SUFFIX)
    ) {
      // A discrepancy an earlier amendment raised is resolved by this one
      // (Finance-raised discrepancies are never cleared here).
      await tx.storeOrder.update({
        where: { id: order.id },
        data: { paymentDiscrepancy: false, paymentDiscrepancyReason: null },
      });
    }
    await this.paymentSync.recompute(order.id, tx);

    const { version } = await tx.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { version: true },
    });
    const amendment = await tx.storeOrderAmendment.create({
      data: {
        storeOrderId: order.id,
        version,
        reason: dto.reason,
        actorId: userId,
        actorType: actor.agent ? 'AGENT' : 'INTERNAL',
        changes: plan.changes as Prisma.InputJsonValue,
        impacts: {
          impacts: plan.impacts,
          acknowledged,
        } as unknown as Prisma.InputJsonValue,
        previousSnapshot: this.previousSnapshot(order),
      },
      select: { id: true },
    });
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId: order.id,
        action: ORDER_AMENDED_ACTIVITY,
        details:
          `Amendment v${version}: ${this.summary(plan)} — reason: ${dto.reason}`.slice(
            0,
            2000,
          ),
        performedById: userId,
      },
    });
    return {
      amendmentId: amendment.id,
      version,
      impacts: plan.impacts,
      regenerateInvoice: regenerateInvoice && !plan.isAgentOrder,
    };
  }

  /** Agent re-quote turned a physical order digital-only, or back (frozen per-line stock flags). */
  private digitalOnlyChanged(plan: AmendmentPlan): boolean {
    if (!plan.agentQuote) return false;
    const snapshot = plan.order
      .agentTermsSnapshot as unknown as AgentOrderSnapshot | null;
    const before = snapshot?.lines
      ? snapshot.lines.every((line) => !line.inventoryLine)
      : false;
    return before !== plan.agentQuote.digitalOnly;
  }

  /** New fulfillment method → its initial stage (company and agent rules). */
  private initialStage(plan: AmendmentPlan) {
    if (plan.agentQuote) {
      const stage = agentOrderInitialStage(plan.agentQuote);
      return {
        shippingStage: stage.shippingStage,
        fulfillmentStatusId: this.statusResolver.fulfillmentStatusIdByCode(
          stage.fulfillmentCode,
        ),
      };
    }
    const pickup =
      plan.fulfillmentMethod === StoreOrderFulfillmentMethod.PICKUP;
    return {
      shippingStage: pickup
        ? StoreOrderShippingStage.NOT_READY
        : StoreOrderShippingStage.READY_FOR_SHIPPING,
      fulfillmentStatusId: this.statusResolver.fulfillmentStatusIdByCode(
        pickup ? 'AWAITING_PREPARATION' : 'READY',
      ),
    };
  }

  /** Posted invoice re-issue after a cancelled draft: only once the order is fully paid (the normal rule). */
  private async regenerateInvoice(orderId: string, userId: string) {
    const order = await this.prisma.storeOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { paymentStatus: true },
    });
    if (order.paymentStatus !== 'FULLY_PAID_RECONCILED') {
      return {
        regenerated: false,
        message:
          'The draft invoice was cancelled. Generate the new invoice once the order is fully paid.',
      };
    }
    try {
      const invoice = await this.storeOrders.generateInvoice(orderId, userId);
      return { regenerated: true, invoiceNumber: invoice.invoiceNumber };
    } catch (error) {
      return {
        regenerated: false,
        message: `The draft invoice was cancelled; the new invoice could not be generated automatically (${error instanceof Error ? error.message : 'error'}). Use Generate invoice on the order.`,
      };
    }
  }

  // ── Presentation / audit ────────────────────────────────────────────────

  private present(plan: AmendmentPlan) {
    const blocking = blockingImpacts(plan.impacts);
    return {
      orderId: plan.order.id,
      version: plan.order.version,
      canCommit: blocking.length === 0,
      impacts: plan.impacts,
      impactsFingerprint: impactsFingerprint(plan.impacts),
      requiredAcknowledgements: [
        ...new Set(
          plan.impacts
            .filter((i) => i.severity === 'ACKNOWLEDGE')
            .map((i) => i.code),
        ),
      ],
      totals: {
        currency: plan.currencyCode,
        previousCurrency: plan.order.currency.code,
        previous: money(storeOrderPayableTotal(plan.order)),
        next: money(plan.total),
      },
      changes: plan.changes,
    };
  }

  private customerView(order: LoadedOrder): CustomerSnapshotView {
    if (order.agentId) {
      const typed = readAgentCustomerSnapshot(order.agentTermsSnapshot);
      return {
        partnerId: order.partnerId,
        name: typed?.name ?? order.partner.name,
        phone: typed ? typed.mobile : order.partner.mobile,
        email: null,
        countryId: typed?.countryId ?? null,
        city: typed?.city ?? null,
        address: typed?.address ?? null,
      };
    }
    // R11 — the order's own destination wins over the customer's.
    const own = hasOwnDestination(order);
    return {
      partnerId: order.partnerId,
      name: order.partner.name,
      phone: order.partner.phone ?? order.partner.mobile,
      email: order.partner.email,
      countryId: own ? order.deliveryCountryId : order.partner.countryId,
      city: own ? order.deliveryCity : order.partner.city,
      address: own ? order.deliveryAddress : order.partner.address,
    };
  }

  private describeChanges(
    order: LoadedOrder,
    kinds: AmendmentChangeKinds,
    lines: NextLine[],
    total: number,
    customerBefore: CustomerSnapshotView,
    customerAfter: CustomerSnapshotView,
    next: {
      productNames: Map<string, string>;
      currencyCode: string;
      paymentType: string;
      fulfillmentMethod: string;
      pricingMode: string | null;
    },
  ) {
    const fields: Record<string, { old: unknown; new: unknown }> = {};
    if (kinds.currency) {
      fields.currency = { old: order.currency.code, new: next.currencyCode };
    }
    if (kinds.paymentType) {
      fields.paymentType = { old: order.paymentType, new: next.paymentType };
    }
    if (kinds.fulfillmentMethod) {
      fields.fulfillmentMethod = {
        old: order.fulfillmentMethod,
        new: next.fulfillmentMethod,
      };
    }
    if (kinds.pricing) {
      fields.pricingMode = { old: order.pricingMode, new: next.pricingMode };
    }
    if (kinds.destination) {
      fields.destination = {
        old: {
          countryId: customerBefore.countryId,
          city: customerBefore.city,
          address: customerBefore.address,
        },
        new: {
          countryId: customerAfter.countryId,
          city: customerAfter.city,
          address: customerAfter.address,
        },
      };
    }
    if (kinds.customerSwitch || kinds.customerCorrection) {
      fields.customer = {
        old: {
          partnerId: customerBefore.partnerId,
          name: customerBefore.name,
          phone: customerBefore.phone,
          email: customerBefore.email,
        },
        new: {
          partnerId: customerAfter.partnerId,
          name: customerAfter.name,
          phone: customerAfter.phone,
          email: customerAfter.email,
        },
      };
    }
    const previousTotal = storeOrderPayableTotal(order);
    if (!sameMoney(previousTotal, total)) {
      fields.total = { old: money(previousTotal), new: money(total) };
    }
    const nameOf = (
      item: LoadedOrder['items'][number] | undefined,
      productId: string,
    ) =>
      item && item.productId === productId
        ? item.product?.displayName || item.product?.name || productId
        : productId;
    const byId = new Map(order.items.map((item) => [item.id, item]));
    const kept = new Set(lines.map((l) => l.itemId).filter(Boolean));
    const lineDiffs: Array<Record<string, unknown>> = [];
    for (const item of order.items) {
      if (!kept.has(item.id)) {
        lineDiffs.push({
          kind: 'REMOVED',
          productId: item.productId,
          product: nameOf(item, item.productId),
          old: {
            quantity: item.quantity,
            agreedAmount: money(storeOrderLineAmount(item)),
          },
        });
      }
    }
    for (const line of lines) {
      const item = line.itemId ? byId.get(line.itemId) : undefined;
      if (!item) {
        lineDiffs.push({
          kind: 'ADDED',
          productId: line.productId,
          product: next.productNames.get(line.productId) ?? line.productId,
          new: {
            quantity: line.quantity,
            agreedAmount: money(line.agreedAmount),
          },
        });
        continue;
      }
      const amount = storeOrderLineAmount(item);
      if (
        item.productId !== line.productId ||
        item.quantity !== line.quantity ||
        !sameMoney(amount, line.agreedAmount)
      ) {
        lineDiffs.push({
          kind: 'CHANGED',
          productId: line.productId,
          product: nameOf(item, item.productId),
          old: {
            productId: item.productId,
            quantity: item.quantity,
            agreedAmount: money(amount),
          },
          new: {
            productId: line.productId,
            quantity: line.quantity,
            agreedAmount: money(line.agreedAmount),
          },
        });
      }
    }
    return { fields, lines: lineDiffs };
  }

  private previousSnapshot(order: LoadedOrder) {
    return {
      version: order.version,
      partnerId: order.partnerId,
      currencyId: order.currencyId,
      currency: order.currency.code,
      paymentType: order.paymentType,
      fulfillmentMethod: order.fulfillmentMethod,
      shippingStage: order.shippingStage,
      fulfillmentStatus: order.fulfillmentStatus?.code ?? null,
      declaredPaymentStatus: order.declaredPaymentStatus,
      declaredAmount: money(num(order.declaredAmount)),
      paymentStatus: order.paymentStatus,
      payableTotal: money(storeOrderPayableTotal(order)),
      pricing: order.agentId
        ? {
            pricingMode: order.pricingMode,
            merchandiseAmount: money(num(order.merchandiseAmount)),
            discountAmount: money(num(order.discountAmount)),
            taxAmount: money(num(order.taxAmount)),
            shippingCharge: money(num(order.shippingCharge)),
            shippingChargeSource: order.shippingChargeSource,
            shippingRateAmount:
              order.shippingRateAmount == null
                ? null
                : money(num(order.shippingRateAmount)),
            serviceCharge: money(num(order.serviceCharge)),
            shippingPricingStatus: order.shippingPricingStatus,
            customerTotalStatus: order.customerTotalStatus,
          }
        : null,
      agentTermsSnapshot: order.agentTermsSnapshot ?? null,
      lines: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: money(num(item.unitPrice)),
        agreedAmount: money(storeOrderLineAmount(item)),
      })),
    };
  }

  private summary(plan: AmendmentPlan): string {
    const parts: string[] = [];
    const k = plan.kinds;
    if (k.items) parts.push('items');
    if (k.amounts) parts.push('amounts');
    if (k.currency)
      parts.push(`currency ${plan.order.currency.code} → ${plan.currencyCode}`);
    if (k.paymentType)
      parts.push(`payment ${plan.order.paymentType} → ${plan.paymentType}`);
    if (k.fulfillmentMethod) {
      parts.push(
        `fulfillment ${plan.order.fulfillmentMethod} → ${plan.fulfillmentMethod}`,
      );
    }
    if (k.destination) parts.push('destination');
    if (k.customerSwitch) parts.push('customer switched');
    if (k.customerCorrection) parts.push('customer corrected');
    if (k.pricing) parts.push('pricing');
    const previousTotal = storeOrderPayableTotal(plan.order);
    if (!sameMoney(previousTotal, plan.total)) {
      parts.push(
        `total ${money(previousTotal)} → ${money(plan.total)} ${plan.currencyCode}`,
      );
    }
    return parts.join(', ');
  }

  private async versionConflict(
    tx: Prisma.TransactionClient,
    head: { version: number; updatedAt: Date; updatedBy: string | null },
  ) {
    const user = head.updatedBy
      ? await tx.user.findUnique({
          where: { id: head.updatedBy },
          select: { fullName: true },
        })
      : null;
    const who = user?.fullName ?? 'another user';
    return new ConflictException({
      code: 'ORDER_VERSION_CONFLICT',
      message: `This order was changed by ${who} at ${head.updatedAt.toISOString()}. Reload to see the latest version.`,
      details: {
        currentVersion: head.version,
        changedBy: user?.fullName ?? null,
        changedAt: head.updatedAt.toISOString(),
      },
    });
  }
}
