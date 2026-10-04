import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  GlobalLookupAction,
  GlobalLookupMethod,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from '../../partners/partners.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { personNameKey, personNameKeySql } from '../../common/text/person-name';
import { storeOrderPayableTotal } from '../store-order-line-amount';
import { maskName } from '../../customer-lookup/customer-lookup.util';
import { agentCustomerScopeWhere } from '../../agents/orders/agent-customer';
import { readAgentCustomerSnapshot } from '../../agents/common/agent-terms';
import {
  agentNotFound,
  agentStoreOrderWhere,
  resolveAgentVisibility,
  type AgentVisibility,
} from '../../agents/common/agent-visibility';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  CROSS_SCOPE_REUSE_OUTCOME,
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
 *  - COMPANY — an internal user creating a company order: customers with at
 *    least one company order (an agent-owned customer is cross-scope: the
 *    order is attached to it — O3, one phone = one customer — and flagged
 *    for review); orders narrowed by the caller's sales scope.
 *  - AGENT — an agent order (agent user, or internal staff entering one for
 *    the agent): customers this agent has orders or leads with (the record
 *    may be shared — O3); only that agent's orders, narrowed by the agent
 *    visibility (`null` = internal staff: all of that agent's orders), and
 *    the customer name as the agent typed it. Anything else is cross-scope.
 */
export type DuplicateScope =
  | { kind: 'COMPANY'; userId: string }
  | {
      kind: 'AGENT';
      agentId: string;
      userId: string;
      visibility: AgentVisibility | null;
    };

export interface DuplicateCheckInput {
  phone?: string | null;
  /** Several numbers of one customer (phone and mobile) — the first match wins. */
  phones?: Array<string | null | undefined>;
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
  /** Other customer records holding the number (server-side) — the allowed answers besides the shown customer. */
  alternatives?: { id: string; partnerNumber: string; name: string }[];
  /** Phone match inside the scope. */
  partnerNumber?: string;
  /** Latest order numbers of that customer inside the customer scope — for the audit row only, never returned. */
  orderNumbers?: string[];
  /** A phone match reaching outside the caller's scope — audited on a check. */
  audit?: { phone: string; partnerId: string };
  /** O3 — the customer a cross-scope order is attached to (server-side only). */
  crossScopePartnerId?: string;
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
      return { kind: 'AGENT', agentId, userId, visibility: null };
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
      userId: agent.userId,
      visibility: await resolveAgentVisibility(agent, this.permissions),
    };
  }

  // ── Check ───────────────────────────────────────────────────────────────

  /**
   * A phone check that reaches a customer outside the caller's scope (a
   * cross-scope match, or orders of other owners) is written to
   * `GlobalLookupAudit`, like the global customer lookup.
   */
  async check(
    input: DuplicateCheckInput,
    scope: DuplicateScope,
  ): Promise<DuplicateCheckResult> {
    const { result, audit } = await this.evaluate(input, scope);
    if (audit) {
      await this.prisma.globalLookupAudit.create({
        data: {
          userId: scope.userId,
          action: GlobalLookupAction.GLOBAL_CUSTOMER_LOOKUP,
          method: GlobalLookupMethod.PHONE,
          queryValue: audit.phone,
          matchedPartnerId: audit.partnerId,
        },
      });
    }
    return result;
  }

  /**
   * The server-side gate. A phone match needs a decision (409
   * `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` with the same scoped payload) and
   * always reuses the existing customer — O3: also across scopes, where the
   * order stays in the caller's scope, is attached to the one customer of
   * that number and is flagged for review; a name-only match links the
   * existing customer only on an explicit "same customer".
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
      crossScopePartnerId,
      alternatives = [],
    } = await this.evaluate(input, scope);
    // KNOWN is informational: the order is attached to the number's one
    // customer by the create path itself (one phone = one customer).
    if (result.kind === 'NONE' || result.kind === 'KNOWN') return NO_DUPLICATE;

    if (result.kind === 'PHONE' && result.crossScope) {
      if (!resolution) throw duplicateAcknowledgementRequired(result);
      if (resolution.decision === 'USE_EXISTING_CUSTOMER') {
        throw duplicateAcknowledgementRequired(result, 'STALE');
      }
      return CROSS_SCOPE_REUSE_OUTCOME(crossScopePartnerId!);
    }

    if (result.kind === 'PHONE') {
      if (!resolution) throw duplicateAcknowledgementRequired(result);
      if (resolution.decision === 'DIFFERENT_CUSTOMER') {
        throw duplicateAcknowledgementRequired(result, 'INVALID');
      }
      // Several records hold this number: the caller must name the right one —
      // never chosen silently, never merged.
      if (alternatives.length > 0 && !resolution.customerId) {
        throw duplicateAcknowledgementRequired(result, 'AMBIGUOUS');
      }
      const alternative = alternatives.find(
        (candidate) => candidate.id === resolution.customerId,
      );
      if (
        resolution.customerId &&
        resolution.customerId !== result.customer.id &&
        !alternative
      ) {
        throw duplicateAcknowledgementRequired(result, 'STALE');
      }
      if (alternative) {
        const chosenIntentional =
          resolution.decision === 'INTENTIONAL_NEW_ORDER';
        return {
          partnerId: alternative.id,
          reviewPending: false,
          activity: {
            action: chosenIntentional
              ? DUPLICATE_ACTIVITY.INTENTIONAL_NEW_ORDER
              : DUPLICATE_ACTIVITY.USE_EXISTING_CUSTOMER,
            details: `${chosenIntentional ? 'Intentional new order' : 'Existing customer used'} — phone matches several customer records; the creator chose ${alternative.partnerNumber} (${alternative.name}).`,
          },
        };
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
    const raw = [input.phone, ...(input.phones ?? [])].filter(
      (value): value is string => !!value?.trim(),
    );
    const region = await this.regionOf(input.countryId);
    const checked = new Set<string>();
    for (const value of raw) {
      // Every E.164 the typed number can validly mean (the form's phone
      // country first, then the number on its own, then the primary markets):
      // a local number typed under the wrong default country still finds its
      // customer. Always a full valid number — never a suffix match.
      const candidates = this.phones
        .lookupCandidates(value, region)
        .filter((candidate) => !checked.has(candidate));
      if (candidates.length === 0) continue;
      candidates.forEach((candidate) => checked.add(candidate));
      const matched = await this.phoneEvaluation(candidates, scope);
      if (matched) return matched;
    }
    const candidates = await this.nameCandidates(input.name, scope);
    if (candidates.length) {
      return { result: { kind: 'NAME', candidates } };
    }
    return { result: { kind: 'NONE' } };
  }

  private async regionOf(
    countryId: string | null | undefined,
  ): Promise<string | null> {
    if (!countryId) return null;
    const country = await this.prisma.country.findFirst({
      where: { id: countryId, deletedAt: null },
      select: { code: true },
    });
    return country?.code ?? null;
  }

  /**
   * Partners holding this phone that have at least one order (a real
   * customer history). `lookupAllByPhone` lists the key owner (the one
   * customer of the number — O3) first, then the oldest record.
   */
  private async phoneEvaluation(
    candidates: string[],
    scope: DuplicateScope,
  ): Promise<Evaluation | null> {
    const phone = candidates[0];
    const matches = await this.partners.lookupAllByPhones(candidates);
    if (!matches.length) return null;
    const owner = matches[0];
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
    if (!customers.length) {
      // O3 — a partner with no order yet. Company: the existing customer is
      // recognised (informational, masked) and reused by the create path.
      // Agent: outside its own customers → cross-scope.
      if (scope.kind === 'COMPANY') {
        const known = await this.prisma.partner.findFirst({
          where: {
            id: { in: matches.map((m) => m.id) },
            deletedAt: null,
            roles: { some: { role: PartnerRoleType.CUSTOMER } },
          },
          select: { name: true, phone: true, mobile: true },
          orderBy: { createdAt: 'asc' },
        });
        return known
          ? {
              result: {
                kind: 'KNOWN',
                customer: {
                  nameMasked: maskName(known.name),
                  phoneMasked: maskPhone(known.mobile ?? known.phone),
                },
              },
            }
          : null;
      }
      const own = await this.prisma.partner.count({
        where: { id: owner.id, ...this.customerScopeWhere(scope) },
      });
      return own
        ? null
        : {
            result: { kind: 'PHONE', crossScope: true },
            audit: { phone, partnerId: owner.id },
            crossScopePartnerId: owner.id,
          };
    }

    const inScopeIds = (
      await this.prisma.partner.findMany({
        where: {
          id: { in: customers.map((c) => c.id) },
          ...this.customerScopeWhere(scope),
        },
        select: { id: true },
      })
    ).map((row) => row.id);
    const inScopeCustomers = customers.filter((c) => inScopeIds.includes(c.id));
    const customer = inScopeCustomers[0];
    if (!customer) {
      // The one customer of the number: the key owner, else the oldest.
      return {
        result: { kind: 'PHONE', crossScope: true },
        audit: { phone, partnerId: owner.id },
        crossScopePartnerId: owner.id,
      };
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
    const otherOrdersCount = Math.max(totalCount - visibleCount, 0);
    const name =
      scope.kind === 'AGENT'
        ? await this.agentTypedName(customer.id, scope.agentId, customer.name)
        : customer.name;
    const others = inScopeCustomers.slice(1);
    return {
      partnerNumber: customer.partnerNumber,
      orderNumbers: latest.map((row) => row.internalOrderId),
      ...(others.length > 0
        ? {
            alternatives: others.map((other) => ({
              id: other.id,
              partnerNumber: other.partnerNumber,
              name: other.name,
            })),
          }
        : {}),
      ...(otherOrdersCount > 0
        ? { audit: { phone, partnerId: customer.id } }
        : {}),
      result: {
        kind: 'PHONE',
        crossScope: false,
        customer: {
          id: customer.id,
          name,
          phoneMasked: maskPhone(customer.mobile ?? customer.phone),
        },
        orders,
        otherOrdersCount,
        ...(others.length > 0
          ? {
              alternatives: others.map((other) => ({
                id: other.id,
                name: other.name,
                phoneMasked: maskPhone(other.mobile ?? other.phone),
              })),
            }
          : {}),
      },
    };
  }

  /**
   * O3 — the customer record may be shared: an agent sees the name it typed
   * on its latest order (snapshot), never the master record's; a customer
   * known only from the agent's leads shows the master name (the agent's
   * own lead entry created it).
   */
  private async agentTypedName(
    partnerId: string,
    agentId: string,
    fallback: string,
  ) {
    const latest = await this.prisma.storeOrder.findFirst({
      where: { partnerId, agentId, deletedAt: null },
      orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
      select: { agentTermsSnapshot: true },
    });
    if (!latest) {
      const lead = await this.prisma.lead.findFirst({
        where: { partnerId, agentId },
        orderBy: { createdAt: 'desc' },
        select: { customerName: true },
      });
      return lead?.customerName ?? fallback;
    }
    return (
      readAgentCustomerSnapshot(latest.agentTermsSnapshot)?.name ?? fallback
    );
  }

  /** Customers inside the caller's customer scope (see `DuplicateScope`). */
  private customerScopeWhere(scope: DuplicateScope): Prisma.PartnerWhereInput {
    return scope.kind === 'AGENT'
      ? agentCustomerScopeWhere(scope.agentId)
      : {
          deletedAt: null,
          storeOrders: { some: { agentId: null, deletedAt: null } },
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
    // The scope narrows the SQL itself, so LIMIT never drops in-scope rows.
    const scopeSql =
      scope.kind === 'AGENT'
        ? Prisma.sql`EXISTS (SELECT 1 FROM "store_orders" o WHERE o."partner_id" = p."id" AND o."deleted_at" IS NULL AND o."agent_id" = ${scope.agentId}::uuid)
            AND NOT EXISTS (SELECT 1 FROM "store_orders" o WHERE o."partner_id" = p."id" AND o."agent_id" IS DISTINCT FROM ${scope.agentId}::uuid)`
        : Prisma.sql`EXISTS (SELECT 1 FROM "store_orders" o WHERE o."partner_id" = p."id" AND o."deleted_at" IS NULL AND o."agent_id" IS NULL)`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p."id"::text AS id FROM "partners" p
        WHERE p."deleted_at" IS NULL
          AND ${personNameKeySql('p."name"')} = ${key}
          AND ${scopeSql}
        LIMIT 50`,
    );
    if (!rows.length) return [];
    const partners = await this.prisma.partner.findMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        ...this.customerScopeWhere(scope),
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
    const detailed = await this.showsCandidateHistory(scope);
    return partners
      .map((partner) => ({
        partner,
        orderCount: statsById.get(partner.id)?._count._all ?? 0,
        lastOrderDate: statsById.get(partner.id)?._max.orderDate ?? null,
      }))
      .filter((row) => row.orderCount > 0)
      .sort(
        (a, b) =>
          (b.lastOrderDate?.getTime() ?? 0) - (a.lastOrderDate?.getTime() ?? 0),
      )
      .slice(0, MAX_NAME_CANDIDATES)
      .map(({ partner, orderCount, lastOrderDate }) => ({
        id: partner.id,
        name: partner.name,
        phoneMasked: maskPhone(partner.mobile ?? partner.phone),
        hasOrders: true,
        orderCount: detailed ? orderCount : null,
        lastOrderDate: detailed ? lastOrderDate : null,
      }));
  }

  /**
   * Order counts / dates of a same-name company customer are shown only to
   * users who see beyond their own orders (team / all scope) or hold
   * `customers.lookup_global`; an own-scope user sees name + masked phone.
   */
  private async showsCandidateHistory(scope: DuplicateScope) {
    if (scope.kind === 'AGENT') return true;
    const sales = await this.salesScope.resolve(scope.userId);
    if (sales.kind === 'ALL' || sales.kind === 'TEAM') return true;
    return this.permissions.hasPermission(
      scope.userId,
      'customers.lookup_global',
    );
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
