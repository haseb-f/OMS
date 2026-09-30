import { Injectable } from '@nestjs/common';
import {
  PaymentOrigin,
  Prisma,
  StoreOrderFulfillmentMethod,
  StoreOrderPaymentType,
  StoreOrderSource,
  type Agent,
  type AgentAgreement,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import {
  StoreOrderPaymentDeclarationService,
  type DeclarationActor,
} from '../../store-orders/payment-declaration/store-order-payment-declaration.service';
import type { CreateStoreOrderDto } from '../../store-orders/dto/create-store-order.dto';
import type { FindStoreOrdersQueryDto } from '../../store-orders/dto/find-store-orders-query.dto';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  AgentPricingError,
  computeAgentOrderPricing,
  type AgentPricingBreakdown,
} from '../pricing/agent-order-pricing';
import {
  snapshotAgreementTerms,
  type AgentCustomerSnapshot,
} from '../common/agent-terms';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../../common/phone/phone-number.service';
import {
  agentStoreOrderWhere,
  agentNotFound,
  resolveAgentVisibility,
} from '../common/agent-visibility';
import {
  agentConflict,
  agentForbidden,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import {
  loadAgreementTariffs,
  resolveActiveAgreement,
} from '../admin/agent-agreements.service';
import {
  resolveSubmissionTariff,
  type ResolvedTariff,
  type SubmissionTariff,
} from '../pricing/agent-shipping-tariff';
import type { AgentOrderPersistInput } from './agent-order-persist';
import { AgentFulfillmentService } from '../finance/agent-fulfillment.service';
import { lockStoreOrderRow } from '../../store-orders/store-order-payment-settlement.util';
import {
  agentShippingEconomics,
  agentShippingPricingView,
} from '../pricing/agent-shipping-pricing-view';
import type { AgentOrderSnapshot } from '../common/agent-terms';
import {
  StoreOrderDuplicatesService,
  type DuplicateScope,
} from '../../store-orders/duplicates/store-order-duplicates.service';
import {
  assertReplayable,
  payloadFingerprint,
  scopedCreationKey,
} from '../../store-orders/duplicates/duplicate-outcome';
import { AgentCommissionRatesService } from '../commission/agent-commission-rates.service';
import {
  AgentCommissionRateMissingError,
  AgentItemTypeMissingError,
  settleAgentShipping,
  type AgentLineCommissionRate,
} from '../commission/agent-commission';
import type { AgentShippingChargeSnapshot } from '../common/agent-terms';
import type {
  AgentDeclarationFieldsDto,
  AgentOrderPricingDto,
  ConvertAgentLeadDto,
  CreateAgentOrderDto,
  DeclareAgentOrderPaymentDto,
} from './dto/agent-order.dto';

/**
 * Who acts. `agent` is the server-verified context of an agent user (from
 * `@CurrentAgent()`); without it the caller must be an internal user.
 * Never built from a client field.
 */
export interface AgentOrderActor {
  userId: string;
  agent?: AgentRequestContext;
}

export interface AgentOrderIssue {
  code: string;
  message: string;
  lineKey?: string;
}

interface ResolvedActor {
  userId: string;
  agentId: string | null;
  isAgentUser: boolean;
  agent?: AgentRequestContext;
}

interface PreparedOrder {
  issues: AgentOrderIssue[];
  agent: Pick<Agent, 'id' | 'name' | 'agentNumber' | 'status'> | null;
  agreement: AgentAgreement | null;
  currencyId: string | null;
  fulfillmentMethod: StoreOrderFulfillmentMethod;
  paymentType: StoreOrderPaymentType;
  digitalOnly: boolean;
  shipping: {
    rate: ResolvedTariff | null;
    charge: number | null;
    source: 'NONE' | 'RATE' | 'MANUAL' | null;
    overrideAllowed: boolean;
  };
  shippingOverrideReason: string | null;
  lines: Array<{
    productId: string;
    name: string | null;
    quantity: number;
    listUnitPrice: number | null;
    isInventoryItem: boolean;
    /** commission-policy.md A2 — explicit PRODUCT / SERVICE (null = unclassified). */
    itemType: 'PRODUCT' | 'SERVICE' | null;
  }>;
  breakdown: AgentPricingBreakdown | null;
  /** A3/A6 — the predetermined agent shipping charge (PREDETERMINED_CHARGE policy only). */
  agentShippingCharge: AgentShippingChargeSnapshot | null;
  /** Spec 2 — whether that charge is final or waits for the delivery method. */
  shippingPricingStatus: 'NOT_APPLICABLE' | 'PENDING_METHOD' | 'CONFIRMED';
  /** Per-line commission rate resolved on the order date (commission-policy.md A4). */
  commissionRates: AgentLineCommissionRate[] | null;
}

/** The submission-time tariff of one channel, as frozen in the order snapshot. */
const frozenTariff = (tariff: ResolvedTariff | null) =>
  tariff ? { rateId: tariff.id, amount: tariff.amount } : null;

const issue = (code: string, message: string, lineKey?: string) => ({
  code,
  message,
  ...(lineKey ? { lineKey } : {}),
});

class DuplicateAgentOrder extends Error {
  constructor(readonly storeOrderId: string) {
    super('Duplicate agent order submit');
  }
}

/** Internal staff may create agent orders with `agents.edit`, or `store-orders.create` + `agents.view`. */
export const INTERNAL_AGENT_ORDER_PERMISSIONS = {
  any: 'agents.edit',
  pair: ['store-orders.create', 'agents.view'],
} as const;

/**
 * Agent orders (spec §4–§6): quote, direct creation, lead conversion and
 * payment declarations. Owner agent, agreement, terms snapshot and price
 * breakdown are derived here — never trusted from the client — and persisted
 * through the existing Store Order / lead conversion paths.
 */
@Injectable()
export class AgentOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly storeOrders: StoreOrdersService,
    private readonly workflow: WorkflowEngineService,
    private readonly declarations: StoreOrderPaymentDeclarationService,
    private readonly phones: PhoneNumberService,
    private readonly commissionRates: AgentCommissionRatesService,
    private readonly fulfillment: AgentFulfillmentService,
    private readonly duplicates: StoreOrderDuplicatesService,
  ) {}

  // ── Internal workspace list ─────────────────────────────────────────────

  /**
   * Agents workspace → Orders tab (`GET /agents/:id/orders`, `agents.view`).
   * Same filters, pagination and row shape as the Store Orders list, always
   * pinned to this agent and deliberately NOT narrowed by the internal
   * sales-employee scope: agent orders are owned by agent users (never an
   * internal employee), and whoever holds `agents.view` manages the agent.
   * Profitability is never included (agent orders have no company economics).
   */
  async listForAgent(agentId: string, query: FindStoreOrdersQueryDto) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return this.storeOrders.findAll(
      {
        ...query,
        agentId,
        includeProfitability: undefined,
        costState: undefined,
        lossMaking: undefined,
      },
      undefined,
      false,
    );
  }

  // ── Quote (no writes) ───────────────────────────────────────────────────

  /** Live breakdown + configured shipping rate + validation messages. */
  async quote(input: AgentOrderPricingDto, actor: AgentOrderActor) {
    const resolved = await this.resolveActor(actor);
    if (!resolved.isAgentUser) {
      await this.assertInternalPermission(resolved.userId, 'agents.view');
    }
    const prepared = await this.prepare(input, resolved);
    return this.present(prepared);
  }

  // ── Direct order ────────────────────────────────────────────────────────

  async createAgentOrder(input: CreateAgentOrderDto, actor: AgentOrderActor) {
    const resolved = await this.resolveActor(actor);
    if (resolved.isAgentUser) {
      await this.assertAgentPermission(resolved, 'agent.orders.create');
      if (input.declaration && input.declaration.kind !== 'UNPAID') {
        await this.assertAgentPermission(resolved, 'agent.payments.declare');
      }
    } else {
      await this.assertInternalCreate(resolved.userId);
    }
    // One effective destination (F-M5): the order's country/city/address,
    // else the customer's — used for the rate lookup AND persisted.
    const effective: CreateAgentOrderDto = {
      ...input,
      countryId: input.countryId ?? input.customer.countryId,
      city: input.city ?? input.customer.city,
      address: input.address ?? input.customer.address,
    };
    const prepared = await this.prepare(effective, resolved);
    this.throwIfInvalid(prepared);
    const agentId = prepared.agent!.id;
    const customer = await this.customerSnapshot({
      name: input.customer.name,
      mobile: input.customer.mobile,
      countryId: effective.countryId,
      city: effective.city,
      address: effective.address,
    });

    const employeeId = await this.resolveOwnerUser(
      input.ownerUserId,
      resolved,
      agentId,
    );
    const idempotencyMarker = input.idempotencyKey?.trim()
      ? `agent-order:${agentId}:${input.idempotencyKey.trim()}`
      : null;
    const creationPayloadHash = payloadFingerprint(input);
    if (idempotencyMarker) {
      const existing = await this.findByIdempotency(
        idempotencyMarker,
        creationPayloadHash,
      );
      if (existing) return this.replayed(existing);
    }
    // Spec 1B — duplicate customer check inside the agent's scope.
    const duplicate = await this.duplicates.enforce(
      { phone: customer.mobile, name: customer.name },
      await this.duplicateScope(resolved, agentId),
      input.duplicateResolution,
    );

    const agentOrder = this.toPersistInput(prepared, employeeId, customer);
    const declarationActor = input.declaration
      ? await this.declarationActor(resolved)
      : null;
    const dto = {
      // Not used for agent orders: the customer is resolved from
      // `agentOrder.customer` among the agent's own customers (S1).
      partner: { name: customer.name },
      orderDate: input.orderDate,
      source: StoreOrderSource.MANUAL,
      currencyId: agentOrder.currencyId,
      paymentType: agentOrder.paymentType,
      fulfillmentMethod: agentOrder.fulfillmentMethod,
      notes: input.notes,
      items: agentOrder.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    } as CreateStoreOrderDto;

    try {
      return await this.storeOrders.create(
        dto,
        resolved.userId,
        async (tx, orderId) => {
          if (idempotencyMarker) {
            await this.claimIdempotency(
              tx,
              idempotencyMarker,
              orderId,
              resolved.userId,
            );
          }
          if (input.declaration && declarationActor) {
            await this.declarations.declareInTx(
              tx,
              orderId,
              this.declarationFields(input.declaration, agentOrder.currencyId),
              input.declaration.idempotencyKey,
              declarationActor,
            );
          }
        },
        agentOrder,
        {
          creationIdempotencyKey: idempotencyMarker,
          creationPayloadHash,
          duplicate,
        },
      );
    } catch (error) {
      if (error instanceof DuplicateAgentOrder) {
        return this.replayed(error.storeOrderId);
      }
      throw error;
    }
  }

  // ── Lead conversion ─────────────────────────────────────────────────────

  /**
   * Converts an agent lead through `WorkflowEngineService.convertLead` with
   * the agent pricing input, so the order gets the same breakdown,
   * attribution and snapshot as a direct order. Idempotent per lead (a lead
   * converts once; a retry returns the existing order).
   */
  async convertAgentLead(
    leadId: string,
    input: ConvertAgentLeadDto,
    actor: AgentOrderActor,
  ) {
    const resolved = await this.resolveActor(actor);
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null, agentId: { not: null } },
      select: {
        id: true,
        agentId: true,
        salesEmployeeId: true,
        customerName: true,
        mobileNumber: true,
        countryId: true,
        city: true,
        address: true,
        fulfillmentMethod: true,
        storeOrder: { select: { id: true } },
      },
    });
    if (!lead) throw agentNotFound('Lead');
    if (resolved.isAgentUser) {
      const visibility = await resolveAgentVisibility(
        resolved.agent!,
        this.resolver,
      );
      if (
        lead.agentId !== visibility.agentId ||
        (visibility.ownerUserId &&
          lead.salesEmployeeId !== visibility.ownerUserId)
      ) {
        throw agentNotFound('Lead');
      }
      await this.assertAgentPermission(resolved, 'agent.leads.convert');
      if (input.declaration && input.declaration.kind !== 'UNPAID') {
        await this.assertAgentPermission(resolved, 'agent.payments.declare');
      }
    } else {
      await this.assertInternalCreate(resolved.userId);
    }
    if (lead.storeOrder) return this.replayed(lead.storeOrder.id);

    // One effective destination (F-M5): conversion input, else the lead's.
    const effective: ConvertAgentLeadDto = {
      ...input,
      fulfillmentMethod:
        input.fulfillmentMethod ?? lead.fulfillmentMethod ?? undefined,
      countryId: input.countryId ?? lead.countryId,
      city: input.city ?? lead.city ?? undefined,
      address: input.address ?? lead.address ?? undefined,
    };
    const prepared = await this.prepare(
      { ...effective, agentId: lead.agentId! },
      resolved,
    );
    if (prepared.agent && prepared.agent.id !== lead.agentId) {
      prepared.issues.push(
        issue(
          'MIXED_OWNER_ORDER',
          'منتجات الطلب ليست ملك وكيل هذا العميل المحتمل — The products are not owned by this lead’s agent.',
        ),
      );
    }
    this.throwIfInvalid(prepared);
    const agentOrder = this.toPersistInput(
      prepared,
      // The lead's agent owner; never the internal converter (S4).
      lead.salesEmployeeId ?? (resolved.isAgentUser ? resolved.userId : null),
      {
        name: lead.customerName,
        mobile: lead.mobileNumber,
        countryId: effective.countryId ?? null,
        city: effective.city ?? null,
        address: effective.address ?? null,
      },
    );
    // Spec 1B — duplicate customer check inside the lead's agent scope.
    const duplicate = await this.duplicates.enforce(
      { phone: lead.mobileNumber, name: lead.customerName },
      await this.duplicateScope(resolved, lead.agentId!),
      input.duplicateResolution,
    );
    const declaration = input.declaration;
    await this.workflow.convertLead(leadId, resolved.userId, {
      creationIdempotencyKey: scopedCreationKey(
        'agent-lead-convert',
        lead.agentId!,
        input.idempotencyKey,
      ),
      creationPayloadHash: payloadFingerprint({ leadId, ...input }),
      duplicate,
      agentOrder,
      countryId: effective.countryId,
      city: effective.city,
      address: effective.address,
      notes: input.notes,
      declarationKind: declaration?.kind,
      amountPaid: declaration?.amount,
      paymentDate: declaration?.paymentDate,
      paymentReference: declaration?.reference,
      stagingAttachmentIds: declaration?.stagedAttachmentIds,
      agentPaymentDestinationId: declaration?.destinationId,
    });
    const converted = await this.prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { storeOrder: { select: { id: true } } },
    });
    return this.storeOrders.findOne(converted.storeOrder!.id);
  }

  // ── Payment declaration ─────────────────────────────────────────────────

  /**
   * Declaration on an agent order (spec §6.2) through the shared declaration
   * core: Unpaid / Paid in full (= payable total incl. shipping) / Partial,
   * method = one of the agent's active destinations. Idempotent per key;
   * never exceeds the payable total; a partial never satisfies the gate.
   */
  async declareAgentOrderPayment(
    orderId: string,
    input: DeclareAgentOrderPaymentDto,
    actor: AgentOrderActor,
  ) {
    const resolved = await this.resolveActor(actor);
    const order = await this.findAgentOrderForActor(orderId, resolved);
    let declarationActor: DeclarationActor;
    if (resolved.isAgentUser) {
      await this.assertAgentPermission(resolved, 'agent.payments.declare');
      declarationActor = await this.declarationActor(resolved);
    } else {
      declarationActor = await this.declarations.resolveActor(resolved.userId);
    }
    return this.declarations.declare(
      order.id,
      this.declarationFields(input, order.currencyId),
      input.idempotencyKey,
      declarationActor,
    );
  }

  // ── Shipping pricing (spec-2-agent-pricing.md 2B) ─────────────────────────

  /**
   * Pricing state of an agent order: customer shipping + contractual agent
   * shipping fee (provisional or final), customer-total confirmation and
   * paid vs payable. Internal callers (`agents.view`) also get the shipping
   * economics — actual carrier cost and company margin — which agent users
   * never receive.
   */
  async shippingPricing(orderId: string, actor: AgentOrderActor) {
    const resolved = await this.resolveActor(actor);
    if (!resolved.isAgentUser) {
      await this.assertInternalPermission(resolved.userId, 'agents.view');
    }
    const { id } = await this.findAgentOrderForActor(orderId, resolved);
    const order = await this.prisma.storeOrder.findUniqueOrThrow({
      where: { id },
      select: {
        shippingPricingStatus: true,
        customerTotalStatus: true,
        agentTermsSnapshot: true,
        pricingMode: true,
        merchandiseAmount: true,
        shippingCharge: true,
        payableTotal: true,
        declaredAmount: true,
        payments: {
          where: { deletedAt: null, status: 'VERIFIED' },
          select: { amount: true },
        },
      },
    });
    const verified = order.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const view = agentShippingPricingView(order, verified);
    if (resolved.isAgentUser) return view;
    // Internal only — carrier cost and margin never reach an agent response.
    const internal = await this.prisma.storeOrder.findUniqueOrThrow({
      where: { id },
      select: {
        agentTermsSnapshot: true,
        currency: { select: { code: true } },
        shipments: {
          where: { deletedAt: null },
          select: {
            baseShippingCost: true,
            additionalShippingCost: true,
            carrierCharges: {
              where: { deletedAt: null },
              select: {
                chargeAmount: true,
                chargeKind: true,
                reconciliationState: true,
                currency: { select: { code: true } },
              },
            },
          },
        },
      },
    });
    return {
      ...view,
      economics: agentShippingEconomics(
        internal,
        internal.currency.code,
        internal.shipments,
      ),
    };
  }

  /**
   * "Customer agreed to pay {new total}" (spec 2B shipping added): applies
   * the confirmed shipping and payable once the customer agreed. Internal
   * `agents.edit`, or an agent user with `agent.orders.create` who sees the
   * order (its owner, or an agent admin with `agent.records.view_all`).
   * Audited; retries the earning event the pending total held back.
   */
  async confirmCustomerTotal(
    orderId: string,
    input: { expectedPayableTotal: number },
    actor: AgentOrderActor,
  ) {
    const resolved = await this.resolveActor(actor);
    const { id } = await this.findAgentOrderForActor(orderId, resolved);
    if (resolved.isAgentUser) {
      await this.assertAgentPermission(resolved, 'agent.orders.create');
    } else {
      await this.assertInternalPermission(resolved.userId, 'agents.edit');
    }
    await this.prisma.$transaction(
      async (tx) => {
        await lockStoreOrderRow(tx, id);
        const order = await tx.storeOrder.findUniqueOrThrow({
          where: { id },
          select: {
            customerTotalStatus: true,
            agentTermsSnapshot: true,
            deletedAt: true,
            fulfillmentStatus: { select: { code: true } },
          },
        });
        if (order.deletedAt || order.fulfillmentStatus?.code === 'CANCELLED') {
          throw agentConflict(
            'AGENT_ORDER_CLOSED',
            'الطلب ملغى أو مؤرشف — لا يمكن تسجيل موافقة العميل عليه',
            'The order is cancelled or archived — the customer agreement cannot be recorded.',
          );
        }
        const snapshot =
          order.agentTermsSnapshot as unknown as AgentOrderSnapshot;
        const change = snapshot?.customerTotalChange;
        if (order.customerTotalStatus !== 'CONFIRMATION_REQUIRED' || !change) {
          throw agentConflict(
            'AGENT_CUSTOMER_TOTAL_NOT_PENDING',
            'لا يوجد إجمالي جديد بانتظار موافقة العميل على هذا الطلب',
            'This order has no new customer total awaiting confirmation.',
          );
        }
        if (
          !Number.isFinite(input.expectedPayableTotal) ||
          Math.round(input.expectedPayableTotal * 100) !==
            Math.round(change.proposedPayableTotal * 100)
        ) {
          throw agentConflict(
            'AGENT_CUSTOMER_TOTAL_CHANGED',
            `تغيّر الإجمالي المطلوب تأكيده إلى ${change.proposedPayableTotal.toFixed(2)} — راجع الطلب ثم أكّد`,
            `The total to confirm changed to ${change.proposedPayableTotal.toFixed(2)} — review the order and confirm again.`,
            { proposedPayableTotal: change.proposedPayableTotal },
          );
        }
        await tx.storeOrder.update({
          where: { id },
          data: {
            shippingCharge: change.proposedShippingCharge,
            payableTotal: change.proposedPayableTotal,
            customerTotalStatus: 'CONFIRMED',
            updatedBy: resolved.userId,
            agentTermsSnapshot: {
              ...snapshot,
              customerTotalChange: {
                ...change,
                confirmedAt: new Date().toISOString(),
                confirmedBy: resolved.userId,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.storeOrderActivity.create({
          data: {
            storeOrderId: id,
            action: 'AGENT_CUSTOMER_TOTAL_CONFIRMED',
            details: `Customer agreed to pay ${change.proposedPayableTotal.toFixed(2)} (was ${change.previousPayableTotal.toFixed(2)}; shipping ${change.previousShippingCharge.toFixed(2)} → ${change.proposedShippingCharge.toFixed(2)})`,
            performedById: resolved.userId,
          },
        });
        // The earning event the pending total held back.
        if (order.fulfillmentStatus?.code === 'DELIVERED') {
          await this.fulfillment.tryEarn(tx, id, 'DELIVERED', resolved.userId);
        }
        await this.fulfillment.tryEarn(
          tx,
          id,
          'PAYMENT_VERIFIED',
          resolved.userId,
        );
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return this.shippingPricing(id, actor);
  }

  /** An agent order visible to the actor (agent: own agent + visibility; internal: any agent order). */
  async findAgentOrderForActor(orderId: string, actor: ResolvedActor) {
    const where: Prisma.StoreOrderWhereInput = actor.isAgentUser
      ? {
          id: orderId,
          ...agentStoreOrderWhere(
            await resolveAgentVisibility(actor.agent!, this.resolver),
          ),
        }
      : { id: orderId, deletedAt: null, agentId: { not: null } };
    const order = await this.prisma.storeOrder.findFirst({
      where,
      select: { id: true, agentId: true, currencyId: true },
    });
    if (!order) throw agentNotFound('Order');
    return order;
  }

  // ── Core ────────────────────────────────────────────────────────────────

  async resolveActor(actor: AgentOrderActor): Promise<ResolvedActor> {
    if (actor.agent) {
      if (actor.agent.userId !== actor.userId) {
        throw agentForbidden(
          'AGENT_CONTEXT_MISMATCH',
          'سياق الوكيل لا يطابق المستخدم',
          'The agent context does not match the caller.',
        );
      }
      return {
        userId: actor.userId,
        agentId: actor.agent.agentId,
        isAgentUser: true,
        agent: actor.agent,
      };
    }
    // An agent user never acts without its server-verified context.
    if (await this.resolver.isAgentUser(actor.userId)) {
      throw agentForbidden(
        'AGENT_CONTEXT_REQUIRED',
        'هذا الإجراء يتطلب سياق الوكيل',
        'This action requires the verified agent context.',
      );
    }
    return { userId: actor.userId, agentId: null, isAgentUser: false };
  }

  private async prepare(
    input: AgentOrderPricingDto,
    actor: ResolvedActor,
  ): Promise<PreparedOrder> {
    const issues: AgentOrderIssue[] = [];
    const fulfillmentMethod =
      input.fulfillmentMethod === 'PICKUP'
        ? StoreOrderFulfillmentMethod.PICKUP
        : StoreOrderFulfillmentMethod.SHIPPING;
    const paymentType =
      input.paymentType === 'CASH_ON_DELIVERY'
        ? StoreOrderPaymentType.CASH_ON_DELIVERY
        : StoreOrderPaymentType.PREPAID;

    // Lines → products (one owner per order, spec §4 / D4).
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        displayName: true,
        status: true,
        isSellable: true,
        isInventoryItem: true,
        itemType: true,
        salesPrice: true,
        ownerAgentId: true,
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const owners = new Set<string | null>();
    const lines: PreparedOrder['lines'] = [];
    input.lines.forEach((line, index) => {
      const product = productById.get(line.productId);
      const key = String(index);
      // For agent users a product of another owner is simply unavailable
      // (no cross-agent existence leak).
      const hidden =
        actor.isAgentUser && product && product.ownerAgentId !== actor.agentId;
      if (
        !product ||
        hidden ||
        product.status !== 'ACTIVE' ||
        !product.isSellable
      ) {
        issues.push(
          issue(
            'PRODUCT_NOT_AVAILABLE',
            'المنتج غير متاح للبيع — The product is not available for sale.',
            key,
          ),
        );
        return;
      }
      owners.add(product.ownerAgentId);
      lines.push({
        productId: product.id,
        name: product.displayName || product.name,
        quantity: line.quantity,
        listUnitPrice:
          product.salesPrice == null ? null : Number(product.salesPrice),
        isInventoryItem: product.isInventoryItem,
        itemType: product.itemType,
      });
    });
    if (owners.has(null)) {
      issues.push(
        issue(
          'MIXED_OWNER_ORDER',
          'طلب الوكيل لا يحتوي على منتجات الشركة — An agent order cannot contain company-owned products.',
        ),
      );
    }
    const agentOwners = [...owners].filter((o): o is string => o != null);
    if (agentOwners.length > 1) {
      issues.push(
        issue(
          'MIXED_OWNER_ORDER',
          'كل طلب لوكيل واحد فقط؛ المنتجات مملوكة لأكثر من وكيل — One agent per order: the products belong to more than one agent.',
        ),
      );
    }
    const requestedAgentId = actor.isAgentUser
      ? actor.agentId
      : (input.agentId ?? null);
    if (
      requestedAgentId &&
      agentOwners.length === 1 &&
      agentOwners[0] !== requestedAgentId
    ) {
      issues.push(
        issue(
          'MIXED_OWNER_ORDER',
          'المنتجات ليست ملك هذا الوكيل — The products are not owned by this agent.',
        ),
      );
    }
    const agentId = requestedAgentId ?? agentOwners[0] ?? null;

    let agent: PreparedOrder['agent'] = null;
    let agreement: AgentAgreement | null = null;
    if (agentId) {
      agent = await this.prisma.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: { id: true, name: true, agentNumber: true, status: true },
      });
      if (!agent) {
        issues.push(
          issue('AGENT_NOT_FOUND', 'الوكيل غير موجود — Agent not found.'),
        );
      } else if (agent.status !== 'ACTIVE') {
        issues.push(
          issue(
            'AGENT_NOT_ACTIVE',
            'الوكيل غير نشط — The agent is not active.',
          ),
        );
      }
    } else {
      issues.push(
        issue(
          'AGENT_REQUIRED',
          'اختر منتجات مملوكة لوكيل — Choose products owned by an agent.',
        ),
      );
    }
    // Agent users always order "now"; internal staff may back-date.
    const orderDate =
      !actor.isAgentUser && input.orderDate
        ? new Date(input.orderDate)
        : new Date();
    if (agent) {
      agreement = await resolveActiveAgreement(
        agent.id,
        orderDate,
        this.prisma,
      );
      if (!agreement) {
        issues.push(
          issue(
            'NO_ACTIVE_AGREEMENT',
            'لا توجد اتفاقية سارية للوكيل في تاريخ الطلب — The agent has no agreement in force on the order date.',
          ),
        );
      }
    }
    let commissionRates: AgentLineCommissionRate[] | null = null;
    if (agreement && lines.length === input.lines.length) {
      try {
        commissionRates = await this.commissionRates.resolveLineRates(
          agreement,
          lines.map((line) => ({
            productId: line.productId,
            itemType: line.itemType,
          })),
          orderDate,
        );
      } catch (error) {
        if (error instanceof AgentItemTypeMissingError) {
          const index = lines.findIndex((l) => l.productId === error.productId);
          issues.push(
            issue(
              error.code,
              'نوع الصنف (منتج / خدمة) غير محدد لهذا الصنف — اطلب من الشركة تصنيفه — This item has no item type (product / service); ask the company to classify it.',
              index >= 0 ? String(index) : undefined,
            ),
          );
        } else {
          if (!(error instanceof AgentCommissionRateMissingError)) throw error;
          issues.push(
            issue(
              error.code,
              'لا توجد نسبة عمولة مُعدّة لهذا النوع من الأصناف في اتفاقية الوكيل — No commission rate is configured for this item type in the agent agreement.',
            ),
          );
        }
      }
    }
    const currencyId = agreement?.currencyId ?? null;
    if (agreement && input.currencyId && input.currencyId !== currencyId) {
      issues.push(
        issue(
          'CURRENCY_MISMATCH',
          'عملة الطلب يجب أن تساوي عملة الاتفاقية — The order currency must equal the agreement currency.',
        ),
      );
    }

    // Shipping (spec §5): configured rate, or a permitted + audited override.
    const digitalOnly =
      lines.length > 0 && lines.every((line) => !line.isInventoryItem);
    const overrideAllowed = await this.canOverrideShipping(actor);
    const shipping: PreparedOrder['shipping'] = {
      rate: null,
      charge: null,
      source: null,
      overrideAllowed,
    };
    let shippingOverrideReason: string | null = null;
    let submissionTariff: SubmissionTariff | null = null;
    const override = input.shippingChargeOverride;
    if (
      digitalOnly ||
      fulfillmentMethod === StoreOrderFulfillmentMethod.PICKUP
    ) {
      shipping.charge = 0;
      shipping.source = 'NONE';
      if (override != null && override > 0) {
        issues.push(
          issue(
            'SHIPPING_NOT_APPLICABLE',
            'لا تُضاف رسوم شحن لطلبات الاستلام أو المنتجات الرقمية — Pickup and digital-only orders carry no shipping charge.',
          ),
        );
      }
    } else if (!input.countryId) {
      issues.push(
        issue(
          'SHIPPING_COUNTRY_REQUIRED',
          'حدد دولة الشحن — Choose the shipping destination country.',
        ),
      );
    } else if (agreement) {
      // Spec 2: the delivery channel is unknown at submission — the fee is
      // final when every channel agrees, else a provisional estimate.
      submissionTariff = resolveSubmissionTariff(
        await loadAgreementTariffs(agreement.id, this.prisma),
        { countryId: input.countryId, city: input.city },
        paymentType,
      );
      shipping.rate = submissionTariff?.tariff ?? null;
      const rateAmount = shipping.rate?.amount ?? null;
      const isOverride =
        override != null &&
        (rateAmount == null || Math.abs(override - rateAmount) >= 0.005);
      if (isOverride) {
        if (!overrideAllowed) {
          issues.push(
            issue(
              'SHIPPING_OVERRIDE_NOT_ALLOWED',
              'تعديل رسوم الشحن يتطلب صلاحية — Changing the shipping charge requires permission.',
            ),
          );
        } else if (!input.shippingOverrideReason?.trim()) {
          issues.push(
            issue(
              'SHIPPING_OVERRIDE_REASON_REQUIRED',
              'اذكر سبب تعديل رسوم الشحن — Enter the reason for the shipping charge change.',
            ),
          );
        } else {
          shipping.charge = override;
          shipping.source = 'MANUAL';
          shippingOverrideReason = input.shippingOverrideReason.trim();
        }
      } else if (rateAmount != null) {
        shipping.charge = rateAmount;
        shipping.source = 'RATE';
      } else {
        issues.push(
          issue(
            'SHIPPING_RATE_REQUIRED',
            'لا يوجد سعر شحن معتمد لهذه الوجهة؛ لا يمكن تقدير الشحن — No configured shipping rate for this destination; the shipping charge cannot be guessed.',
          ),
        );
      }
    }

    // Price breakdown (pure library, same result as the portal preview).
    let breakdown: AgentPricingBreakdown | null = null;
    if (lines.length === input.lines.length && shipping.charge != null) {
      try {
        breakdown = computeAgentOrderPricing({
          mode: input.pricingMode,
          lines: input.lines.map((line, index) => ({
            key: String(index),
            quantity: line.quantity,
            lineAmount: line.lineAmount ?? null,
            listUnitPrice: lines[index].listUnitPrice,
          })),
          agreedTotal: input.agreedTotal ?? null,
          shippingCharge: shipping.charge,
          serviceCharge: input.serviceCharge ?? 0,
          // Spec §11 D2: no company output tax on agent merchandise.
          taxAmount: 0,
        });
      } catch (error) {
        if (!(error instanceof AgentPricingError)) throw error;
        issues.push(issue(error.code, error.message, error.lineKey));
      }
    }

    // A3/A6 — predetermined agent shipping charge, settled by the customer
    // shipping the company retains. A difference is never settled silently.
    let agentShippingCharge: AgentShippingChargeSnapshot | null = null;
    let shippingPricingStatus: PreparedOrder['shippingPricingStatus'] =
      'NOT_APPLICABLE';
    if (agreement?.shippingPolicy === 'PREDETERMINED_CHARGE' && breakdown) {
      const noShipment =
        digitalOnly || fulfillmentMethod === StoreOrderFulfillmentMethod.PICKUP;
      const rate = noShipment ? 0 : (shipping.rate?.amount ?? null);
      if (rate == null) {
        issues.push(
          issue(
            'AGENT_SHIPPING_CHARGE_NOT_CONFIGURED',
            'لا يوجد سعر شحن مُعدّ لهذه الوجهة في الاتفاقية لتحديد رسم شحن الوكيل — No agreement shipping rate for this destination to set the agent shipping charge.',
          ),
        );
      } else {
        const settlement = settleAgentShipping({
          customerShipping: breakdown.shippingCharge,
          predeterminedCharge: rate,
        });
        if (settlement.needsDecision) {
          issues.push(
            issue(
              'AGENT_SHIPPING_DIFFERENCE_PENDING_DECISION',
              `شحن العميل (${breakdown.shippingCharge.toFixed(2)}) يختلف عن رسم شحن الوكيل المحدد (${rate.toFixed(2)}) — معالجة الفرق بانتظار قرار الإدارة — The customer shipping (${breakdown.shippingCharge.toFixed(2)}) differs from the predetermined agent shipping charge (${rate.toFixed(2)}); settling the difference awaits the owner's decision.`,
            ),
          );
        }
        const pending =
          !noShipment && submissionTariff?.status === 'PENDING_METHOD';
        agentShippingCharge = {
          amount: rate,
          source: digitalOnly ? 'DIGITAL_ONLY' : noShipment ? 'PICKUP' : 'RATE',
          rateId: noShipment ? null : (shipping.rate?.id ?? null),
          provisional: pending,
          deliveryChannel: pending
            ? (submissionTariff?.estimateChannel ?? null)
            : null,
          paymentType,
          countryId: noShipment ? null : (input.countryId ?? null),
          city: noShipment ? null : input.city?.trim() || null,
          resolvedAt: new Date().toISOString(),
          resolvedBy: actor.userId,
          ...(noShipment || !submissionTariff
            ? {}
            : {
                byChannel: {
                  CARRIER: frozenTariff(submissionTariff.byChannel.CARRIER),
                  INTERNAL_COURIER: frozenTariff(
                    submissionTariff.byChannel.INTERNAL_COURIER,
                  ),
                },
              }),
        };
        shippingPricingStatus = pending ? 'PENDING_METHOD' : 'CONFIRMED';
      }
    }

    return {
      issues,
      agent,
      agreement,
      currencyId,
      fulfillmentMethod,
      paymentType,
      digitalOnly,
      shipping,
      shippingOverrideReason,
      lines,
      breakdown,
      commissionRates,
      agentShippingCharge,
      shippingPricingStatus,
    };
  }

  private present(prepared: PreparedOrder) {
    return {
      valid: prepared.issues.length === 0,
      issues: prepared.issues,
      agent: prepared.agent
        ? {
            id: prepared.agent.id,
            name: prepared.agent.name,
            agentNumber: prepared.agent.agentNumber,
          }
        : null,
      agreement: prepared.agreement
        ? {
            id: prepared.agreement.id,
            agreementNumber: prepared.agreement.agreementNumber,
            currencyId: prepared.agreement.currencyId,
            allowAgentDestinations: prepared.agreement.allowAgentDestinations,
          }
        : null,
      currencyId: prepared.currencyId,
      fulfillmentMethod: prepared.fulfillmentMethod,
      paymentType: prepared.paymentType,
      digitalOnly: prepared.digitalOnly,
      shipping: {
        rate: prepared.shipping.rate?.amount ?? null,
        rateScope: prepared.shipping.rate
          ? prepared.shipping.rate.city
            ? 'CITY'
            : 'COUNTRY'
          : null,
        charge: prepared.shipping.charge,
        source: prepared.shipping.source,
        overrideAllowed: prepared.shipping.overrideAllowed,
      },
      lines: prepared.lines.map((line, index) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        listUnitPrice: line.listUnitPrice,
        isInventoryItem: line.isInventoryItem,
        ...(prepared.breakdown?.lines[index]
          ? {
              lineAmount: prepared.breakdown.lines[index].lineAmount,
              unitPrice: prepared.breakdown.lines[index].unitPrice,
              discountAmount: prepared.breakdown.lines[index].discountAmount,
            }
          : {}),
      })),
      /** A3/A6 — predetermined agent shipping charge (settled by the retained customer shipping). */
      agentShippingCharge: prepared.agentShippingCharge,
      /**
       * Spec 2 — PENDING_METHOD: the fee (and, shipping added, the customer
       * total) is provisional until Shipping selects the delivery method.
       */
      shippingPricingStatus: prepared.shippingPricingStatus,
      breakdown: prepared.breakdown
        ? {
            mode: prepared.breakdown.mode,
            merchandiseAmount: prepared.breakdown.merchandiseAmount,
            discountAmount: prepared.breakdown.discountAmount,
            taxAmount: prepared.breakdown.taxAmount,
            shippingCharge: prepared.breakdown.shippingCharge,
            serviceCharge: prepared.breakdown.serviceCharge,
            payableTotal: prepared.breakdown.payableTotal,
          }
        : null,
    };
  }

  private throwIfInvalid(prepared: PreparedOrder) {
    if (
      prepared.issues.length === 0 &&
      prepared.breakdown &&
      prepared.commissionRates
    ) {
      return;
    }
    const first = prepared.issues[0] ?? {
      code: 'INVALID_ORDER',
      message: 'الطلب غير مكتمل — The order is incomplete.',
    };
    throw agentUnprocessable(
      first.code,
      first.message.split(' — ')[0] ?? first.message,
      first.message.split(' — ')[1] ?? first.message,
      { issues: prepared.issues },
    );
  }

  private toPersistInput(
    prepared: PreparedOrder,
    employeeId: string | null,
    customer: AgentCustomerSnapshot,
  ): AgentOrderPersistInput {
    const breakdown = prepared.breakdown!;
    const agreement = prepared.agreement!;
    return {
      agentId: prepared.agent!.id,
      agentAgreementId: agreement.id,
      agentTermsSnapshot: snapshotAgreementTerms(agreement),
      customer,
      currencyId: agreement.currencyId,
      employeeId,
      paymentType: prepared.paymentType,
      fulfillmentMethod: prepared.fulfillmentMethod,
      digitalOnly: prepared.digitalOnly,
      pricingMode: breakdown.mode,
      merchandiseAmount: breakdown.merchandiseAmount,
      discountAmount: breakdown.discountAmount,
      taxAmount: breakdown.taxAmount,
      shippingCharge: breakdown.shippingCharge,
      shippingChargeSource: prepared.shipping.source ?? 'NONE',
      shippingRateAmount: prepared.shipping.rate?.amount ?? null,
      shippingOverrideReason: prepared.shippingOverrideReason,
      serviceCharge: breakdown.serviceCharge,
      payableTotal: breakdown.payableTotal,
      lines: breakdown.lines.map((line, index) => ({
        productId: prepared.lines[index].productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        agreedAmount: line.lineAmount,
        inventoryLine: prepared.lines[index].isInventoryItem,
        commission: prepared.commissionRates![index],
        listAmount:
          prepared.lines[index].listUnitPrice == null
            ? null
            : Math.round(
                prepared.lines[index].listUnitPrice * 100 * line.quantity,
              ) / 100,
      })),
      agentShippingCharge: prepared.agentShippingCharge,
      shippingPricingStatus: prepared.shippingPricingStatus,
    };
  }

  /** The customer as typed, mobile normalized to E.164 against the destination country. */
  private async customerSnapshot(input: {
    name: string;
    mobile?: string | null;
    countryId?: string | null;
    city?: string | null;
    address?: string | null;
  }): Promise<AgentCustomerSnapshot> {
    let mobile: string | null = null;
    if (input.mobile?.trim()) {
      const country = input.countryId
        ? await this.prisma.country.findFirst({
            where: { id: input.countryId, deletedAt: null },
            select: { code: true },
          })
        : null;
      const parsed = this.phones.parse(input.mobile, country?.code);
      if (country && (!parsed.isValid || !parsed.e164)) {
        throw agentUnprocessable(
          'CUSTOMER_MOBILE_INVALID',
          'رقم جوال العميل غير صالح',
          phoneErrorMessage(parsed.errorReason),
        );
      }
      mobile = parsed.e164 ?? input.mobile.trim();
    }
    return {
      name: input.name.trim(),
      mobile,
      countryId: input.countryId ?? null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
    };
  }

  private async canOverrideShipping(actor: ResolvedActor) {
    return this.resolver.hasPermission(
      actor.userId,
      actor.isAgentUser ? 'agent.orders.override_shipping' : 'agents.edit',
    );
  }

  /**
   * Order owner (S4): agent users own their orders; internal staff may name
   * an active user of that agent, otherwise the order has no owner (visible
   * to the agent's `agent.records.view_all` users) — an agent order is never
   * owned by an internal user.
   */
  private async resolveOwnerUser(
    ownerUserId: string | undefined,
    actor: ResolvedActor,
    agentId: string,
  ): Promise<string | null> {
    if (actor.isAgentUser) return actor.userId;
    if (!ownerUserId) return null;
    const owner = await this.prisma.user.findFirst({
      where: {
        id: ownerUserId,
        agentId,
        userType: 'AGENT',
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!owner) {
      throw agentUnprocessable(
        'ORDER_OWNER_INVALID',
        'مالك الطلب يجب أن يكون مستخدمًا نشطًا لنفس الوكيل',
        'The order owner must be an active user of the same agent.',
      );
    }
    return owner.id;
  }

  private async assertAgentPermission(actor: ResolvedActor, name: string) {
    if (!(await this.resolver.hasPermission(actor.userId, name))) {
      throw agentForbidden(
        'AGENT_PERMISSION_REQUIRED',
        `الصلاحية ${name} مطلوبة`,
        `Missing permission "${name}".`,
      );
    }
  }

  private async assertInternalPermission(userId: string, name: string) {
    if (!(await this.resolver.hasPermission(userId, name))) {
      throw agentForbidden(
        'PERMISSION_REQUIRED',
        `الصلاحية ${name} مطلوبة`,
        `Missing permission "${name}".`,
      );
    }
  }

  /** `agents.edit`, or `store-orders.create` + `agents.view`. */
  async assertInternalCreate(userId: string) {
    const has = (name: string) => this.resolver.hasPermission(userId, name);
    if (await has(INTERNAL_AGENT_ORDER_PERMISSIONS.any)) return;
    const [a, b] = await Promise.all(
      INTERNAL_AGENT_ORDER_PERMISSIONS.pair.map(has),
    );
    if (a && b) return;
    throw agentForbidden(
      'PERMISSION_REQUIRED',
      'إنشاء طلب وكيل يتطلب صلاحية تعديل الوكلاء أو إنشاء الطلبات مع عرض الوكلاء',
      'Creating an agent order requires agents.edit, or store-orders.create together with agents.view.',
    );
  }

  private async declarationActor(
    actor: ResolvedActor,
  ): Promise<DeclarationActor> {
    if (actor.isAgentUser) {
      // External Sales: a declaration only, never a Finance correction.
      return {
        userId: actor.userId,
        origin: PaymentOrigin.SALES_DECLARATION,
        allowCorrection: false,
      };
    }
    return this.declarations.resolveActor(actor.userId);
  }

  private declarationFields(
    input: AgentDeclarationFieldsDto,
    currencyId: string,
  ) {
    return {
      kind: input.kind,
      amount: input.amount,
      currencyId,
      paymentDate: input.paymentDate,
      referenceNumber: input.reference,
      stagedAttachmentIds: input.stagedAttachmentIds,
      agentPaymentDestinationId: input.destinationId,
    };
  }

  /**
   * Submit idempotency without a new column: the client key is recorded as
   * an order timeline marker under a transaction-scoped advisory lock, so a
   * concurrent or retried submit with the same key finds the first order.
   */
  private async claimIdempotency(
    tx: Prisma.TransactionClient,
    marker: string,
    orderId: string,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${marker}))`;
    const existing = await tx.storeOrderActivity.findFirst({
      where: { action: 'AGENT_ORDER_IDEMPOTENCY', details: marker },
      select: { storeOrderId: true },
    });
    if (existing && existing.storeOrderId !== orderId) {
      throw new DuplicateAgentOrder(existing.storeOrderId);
    }
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId: orderId,
        action: 'AGENT_ORDER_IDEMPOTENCY',
        details: marker,
        performedById: userId,
      },
    });
  }

  /** Spec 1B — a replayed submit returns the first order, flagged. */
  private async replayed(storeOrderId: string) {
    return {
      ...(await this.storeOrders.findOne(storeOrderId)),
      idempotentReplay: true as const,
    };
  }

  /** Spec 1B — agent users: their agent + visibility; internal staff: all of that agent's orders. */
  private async duplicateScope(
    actor: ResolvedActor,
    agentId: string,
  ): Promise<DuplicateScope> {
    return actor.isAgentUser
      ? this.duplicates.agentScope(actor.agent!)
      : { kind: 'AGENT', agentId, userId: actor.userId, visibility: null };
  }

  private async findByIdempotency(
    marker: string,
    payloadHash?: string,
  ): Promise<string | null> {
    // Spec 1B: the marker is also the order's `creationIdempotencyKey`
    // (archived order / different payload → 409).
    const keyed = await this.prisma.storeOrder.findUnique({
      where: { creationIdempotencyKey: marker },
      select: { id: true, deletedAt: true, creationPayloadHash: true },
    });
    if (keyed) return assertReplayable(keyed, payloadHash);
    const row = await this.prisma.storeOrderActivity.findFirst({
      where: {
        action: 'AGENT_ORDER_IDEMPOTENCY',
        details: marker,
        storeOrder: { deletedAt: null },
      },
      select: { storeOrderId: true },
    });
    return row?.storeOrderId ?? null;
  }
}
