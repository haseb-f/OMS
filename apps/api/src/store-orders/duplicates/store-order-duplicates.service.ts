import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from '../../partners/partners.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { personNameKey, personNameKeySql } from '../../common/text/person-name';
import { storeOrderPayableTotal } from '../store-order-line-amount';
import { agentOwnedCustomerWhere } from '../../agents/orders/agent-customer';
import {
  agentNotFound,
  agentStoreOrderWhere,
  resolveAgentVisibility,
  type AgentVisibility,
} from '../../agents/common/agent-visibility';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  DUPLICATE_ACTIVITY,
  NO_DUPLICATE,
  duplicateAcknowledgementRequired,
  maskPhone,
  type DuplicateCheckResult,
  type DuplicateNameCandidate,
  type DuplicateOrderSummary,
  type DuplicateOutcome,
  type DuplicateResolution,
} from './duplicate-outcome';

/**
 * Whose customers and orders the caller may see:
 *  - COMPANY — an internal user creating a company order: the shared
 *    Partner master; orders narrowed by the caller's sales scope.
 *  - AGENT — an agent order (agent user, or internal staff entering one for
 *    the agent): only that agent's own customers (the S1 rule); orders
 *    narrowed by the agent visibility (`null` = internal staff: all of that
 *    agent's orders). Anything else is cross-scope.
 */
export type DuplicateScope =
  | { kind: 'COMPANY'; userId: string }
  | { kind: 'AGENT'; agentId: string; visibility: AgentVisibility | null };

export interface DuplicateCheckInput {
  phone?: string | null;
  name?: string | null;
  /** Phone country — resolves a local number to E.164. */
  countryId?: string | null;
}

/** Fulfillment codes after which an order is no longer "active". */
const CLOSED_FULFILLMENT_CODES = new Set([
  'DELIVERED',
  'COLLECTED',
  'RETURNED',
  'CANCELLED',
]);
const MAX_LISTED_ORDERS = 10;
const MAX_NAME_CANDIDATES = 5;
const MIN_NAME_KEY_LENGTH = 3;

const ORDER_SUMMARY_SELECT = {
  id: true,
  internalOrderId: true,
  orderDate: true,
  paymentStatus: true,
  declaredPaymentStatus: true,
  payableTotal: true,
  currency: { select: { code: true } },
  fulfillmentStatus: { select: { code: true, name: true, nameEn: true } },
  items: {
    where: { deletedAt: null },
    select: { quantity: true, unitPrice: true, agreedAmount: true },
  },
} satisfies Prisma.StoreOrderSelect;

interface Evaluation {
  result: DuplicateCheckResult;
  /** Phone match inside the scope. */
  partnerNumber?: string;
  /** Latest order numbers of that customer inside the customer scope — for the audit row only, never returned. */
  orderNumbers?: string[];
}

/**
 * Round 5 Spec 1B — the duplicate check behind the create dialogs and the
 * server-side gate every create path (manual, lead conversion, agent order)
 * runs before persisting. Phone identity reuses the Partner dedup's own E.164
 * matching (`PartnersService.lookupAllByPhone`), independent of which
 * employee created the earlier order; a name match is only ever a soft
 * warning and never merges customers.
 */
@Injectable()
export class StoreOrderDuplicatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
    private readonly phones: PhoneNumberService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  // ── Scopes ──────────────────────────────────────────────────────────────

  /**
   * Internal caller of `POST store-orders/duplicate-check`: anyone who can
   * create an order (manual, lead conversion or agent order). With
   * `agentId`, the check runs inside that agent's customers — the same rule
   * the internal agent-order create applies (`agents.edit`, or
   * `store-orders.create` + `agents.view`).
   */
  async internalScope(
    userId: string,
    agentId?: string | null,
  ): Promise<DuplicateScope> {
    const has = (name: string) => this.permissions.hasPermission(userId, name);
    if (agentId) {
      const [edit, create, view] = await Promise.all([
        has('agents.edit'),
        has('store-orders.create'),
        has('agents.view'),
      ]);
      if (!edit && !(create && view)) {
        throw new ForbiddenException(
          'Checking an agent order customer requires agents.edit, or store-orders.create together with agents.view.',
        );
      }
      const agent = await this.prisma.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: { id: true },
      });
      if (!agent) throw agentNotFound('Agent');
      return { kind: 'AGENT', agentId, visibility: null };
    }
    const allowed = await Promise.all(
      ['store-orders.create', 'crm.leads.convert'].map(has),
    );
    if (!allowed.some(Boolean)) {
      throw new ForbiddenException(
        'Missing permission "store-orders.create" or "crm.leads.convert".',
      );
    }
    return { kind: 'COMPANY', userId };
  }

  /** Agent user (portal) — the agent always comes from the verified context. */
  async agentScope(agent: AgentRequestContext): Promise<DuplicateScope> {
    return {
      kind: 'AGENT',
      agentId: agent.agentId,
      visibility: await resolveAgentVisibility(agent, this.permissions),
    };
  }

  // ── Check ───────────────────────────────────────────────────────────────

  async check(
    input: DuplicateCheckInput,
    scope: DuplicateScope,
  ): Promise<DuplicateCheckResult> {
    return (await this.evaluate(input, scope)).result;
  }

  /**
   * The server-side gate. A phone match needs a decision (409
   * `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` with the same scoped payload) and
   * always reuses the existing customer; a cross-scope match proceeds in the
   * caller's own scope but is flagged for review; a name-only match links
   * the existing customer only on an explicit "same customer".
   */
  async enforce(
    input: DuplicateCheckInput,
    scope: DuplicateScope,
    resolution?: DuplicateResolution | null,
  ): Promise<DuplicateOutcome> {
    const {
      result,
      partnerNumber,
      orderNumbers = [],
    } = await this.evaluate(input, scope);
    if (result.kind === 'NONE') return NO_DUPLICATE;

    if (result.kind === 'PHONE' && result.crossScope) {
      if (!resolution) throw duplicateAcknowledgementRequired(result);
      if (resolution.decision === 'USE_EXISTING_CUSTOMER') {
        throw duplicateAcknowledgementRequired(result, 'STALE');
      }
      return {
        partnerId: null,
        reviewPending: true,
        activity: {
          action: DUPLICATE_ACTIVITY.REVIEW_REQUESTED,
          details:
            'Customer phone matches a customer outside the creator’s scope — the order was created in the creator’s scope and flagged for duplicate review.',
        },
      };
    }

    if (result.kind === 'PHONE') {
      if (!resolution) throw duplicateAcknowledgementRequired(result);
      if (resolution.decision === 'DIFFERENT_CUSTOMER') {
        throw duplicateAcknowledgementRequired(result, 'INVALID');
      }
      if (
        resolution.customerId &&
        resolution.customerId !== result.customer.id
      ) {
        throw duplicateAcknowledgementRequired(result, 'STALE');
      }
      const orders = orderNumbers.length
        ? `; existing orders: ${orderNumbers.join(', ')}`
        : '';
      const intentional = resolution.decision === 'INTENTIONAL_NEW_ORDER';
      return {
        partnerId: result.customer.id,
        reviewPending: false,
        activity: {
          action: intentional
            ? DUPLICATE_ACTIVITY.INTENTIONAL_NEW_ORDER
            : DUPLICATE_ACTIVITY.USE_EXISTING_CUSTOMER,
          details: `${intentional ? 'Intentional new order' : 'Existing customer used'} — phone matches customer ${partnerNumber} (${result.customer.name})${orders}.`,
        },
      };
    }

    // Name-only: a soft warning — never merged without an explicit choice.
    if (!resolution) return NO_DUPLICATE;
    const chosen = resolution.customerId
      ? result.candidates.find((c) => c.id === resolution.customerId)
      : undefined;
    if (resolution.customerId && !chosen) {
      throw duplicateAcknowledgementRequired(result, 'STALE');
    }
    if (chosen && resolution.decision !== 'DIFFERENT_CUSTOMER') {
      return {
        partnerId: chosen.id,
        reviewPending: false,
        activity: {
          action: DUPLICATE_ACTIVITY.USE_EXISTING_CUSTOMER,
          details: `Same customer confirmed by the creator — name matches existing customer (${chosen.name}).`,
        },
      };
    }
    if (resolution.decision === 'USE_EXISTING_CUSTOMER') {
      throw duplicateAcknowledgementRequired(result, 'STALE');
    }
    return {
      partnerId: null,
      reviewPending: false,
      activity: {
        action: DUPLICATE_ACTIVITY.DIFFERENT_CUSTOMER,
        details: `Different customer confirmed by the creator — the name matches ${result.candidates.length} existing customer(s); not merged.`,
      },
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async evaluate(
    input: DuplicateCheckInput,
    scope: DuplicateScope,
  ): Promise<Evaluation> {
    const phone = await this.normalizePhone(input.phone, input.countryId);
    if (phone) {
      const matched = await this.phoneEvaluation(phone, scope);
      if (matched) return matched;
    }
    const candidates = await this.nameCandidates(input.name, scope);
    if (candidates.length) {
      return { result: { kind: 'NAME', candidates } };
    }
    return { result: { kind: 'NONE' } };
  }

  private async normalizePhone(
    raw: string | null | undefined,
    countryId: string | null | undefined,
  ): Promise<string | null> {
    if (!raw?.trim()) return null;
    const country = countryId
      ? await this.prisma.country.findFirst({
          where: { id: countryId, deletedAt: null },
          select: { code: true },
        })
      : null;
    return (
      this.phones.normalizeToE164(raw, country?.code) ??
      this.phones.normalizeToE164(raw)
    );
  }

  /** Partners holding this phone that have at least one order (a real customer history). */
  private async phoneEvaluation(
    phone: string,
    scope: DuplicateScope,
  ): Promise<Evaluation | null> {
    const matches = await this.partners.lookupAllByPhone(phone);
    if (!matches.length) return null;
    const withOrders = await this.prisma.storeOrder.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { in: matches.map((m) => m.id) },
        deletedAt: null,
      },
    });
    const ids = new Set(withOrders.map((row) => row.partnerId));
    const customers = matches
      .filter((m) => ids.has(m.id))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!customers.length) return null;

    const inScopeIds =
      scope.kind === 'COMPANY'
        ? customers.map((c) => c.id)
        : (
            await this.prisma.partner.findMany({
              where: {
                id: { in: customers.map((c) => c.id) },
                ...agentOwnedCustomerWhere(scope.agentId),
              },
              select: { id: true },
            })
          ).map((row) => row.id);
    const customer = customers.find((c) => inScopeIds.includes(c.id));
    if (!customer) {
      return { result: { kind: 'PHONE', crossScope: true } };
    }

    const customerOrders: Prisma.StoreOrderWhereInput = {
      partnerId: customer.id,
      deletedAt: null,
      ...(scope.kind === 'AGENT' ? { agentId: scope.agentId } : {}),
    };
    const visibleWhere: Prisma.StoreOrderWhereInput = {
      AND: [customerOrders, await this.visibleOrdersWhere(scope)],
    };
    const [visible, visibleCount, totalCount, latest] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where: visibleWhere,
        select: ORDER_SUMMARY_SELECT,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.storeOrder.count({ where: visibleWhere }),
      this.prisma.storeOrder.count({ where: customerOrders }),
      this.prisma.storeOrder.findMany({
        where: customerOrders,
        select: { internalOrderId: true },
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);
    const orders = visible
      .map((order) => this.summarize(order))
      .sort((a, b) => Number(b.active) - Number(a.active))
      .slice(0, MAX_LISTED_ORDERS);
    return {
      partnerNumber: customer.partnerNumber,
      orderNumbers: latest.map((row) => row.internalOrderId),
      result: {
        kind: 'PHONE',
        crossScope: false,
        customer: {
          id: customer.id,
          name: customer.name,
          phoneMasked: maskPhone(customer.mobile ?? customer.phone),
        },
        orders,
        otherOrdersCount: Math.max(totalCount - visibleCount, 0),
      },
    };
  }

  private async visibleOrdersWhere(
    scope: DuplicateScope,
  ): Promise<Prisma.StoreOrderWhereInput> {
    if (scope.kind === 'AGENT') {
      return scope.visibility
        ? agentStoreOrderWhere(scope.visibility)
        : { agentId: scope.agentId, deletedAt: null };
    }
    const sales = await this.salesScope.resolve(scope.userId);
    return this.salesScope.storeOrderWhere(sales);
  }

  /**
   * Same Arabic-normalized name (alef/hamza, ya/alef maqsura, ta marbuta,
   * diacritics, whitespace, case) among customers with orders, inside the
   * caller's customer scope only — never another agent's or, for an agent,
   * a company customer.
   */
  private async nameCandidates(
    name: string | null | undefined,
    scope: DuplicateScope,
  ): Promise<DuplicateNameCandidate[]> {
    const key = personNameKey(name);
    if (key.length < MIN_NAME_KEY_LENGTH) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p."id"::text AS id FROM "partners" p
        WHERE p."deleted_at" IS NULL
          AND ${personNameKeySql('p."name"')} = ${key}
          AND EXISTS (SELECT 1 FROM "store_orders" o WHERE o."partner_id" = p."id" AND o."deleted_at" IS NULL)
        LIMIT 50`,
    );
    if (!rows.length) return [];
    const partners = await this.prisma.partner.findMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        ...(scope.kind === 'AGENT'
          ? agentOwnedCustomerWhere(scope.agentId)
          : { deletedAt: null }),
      },
      select: { id: true, name: true, phone: true, mobile: true },
    });
    if (!partners.length) return [];
    const stats = await this.prisma.storeOrder.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { in: partners.map((p) => p.id) },
        deletedAt: null,
        ...(scope.kind === 'AGENT' ? { agentId: scope.agentId } : {}),
      },
      _count: { _all: true },
      _max: { orderDate: true },
    });
    const statsById = new Map(stats.map((row) => [row.partnerId, row]));
    return partners
      .map((partner) => ({
        id: partner.id,
        name: partner.name,
        phoneMasked: maskPhone(partner.mobile ?? partner.phone),
        orderCount: statsById.get(partner.id)?._count._all ?? 0,
        lastOrderDate: statsById.get(partner.id)?._max.orderDate ?? null,
      }))
      .filter((candidate) => candidate.orderCount > 0)
      .sort(
        (a, b) =>
          (b.lastOrderDate?.getTime() ?? 0) - (a.lastOrderDate?.getTime() ?? 0),
      )
      .slice(0, MAX_NAME_CANDIDATES);
  }

  private summarize(
    order: Prisma.StoreOrderGetPayload<{ select: typeof ORDER_SUMMARY_SELECT }>,
  ): DuplicateOrderSummary {
    return {
      id: order.id,
      orderNumber: order.internalOrderId,
      orderDate: order.orderDate,
      active: !CLOSED_FULFILLMENT_CODES.has(
        order.fulfillmentStatus?.code ?? '',
      ),
      paymentStatus: order.paymentStatus,
      declaredPaymentStatus: order.declaredPaymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      total: storeOrderPayableTotal(order),
      currencyCode: order.currency?.code ?? null,
    };
  }
}
