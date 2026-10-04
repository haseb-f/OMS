import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GlobalLookupAction,
  GlobalLookupMethod,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LookupThrottleService } from './lookup-throttle.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../sales-scope/sales-scope.service';
import {
  classifyQuery,
  leadStatusBucket,
  maskName,
  maskPhone,
  MAX_RESULTS,
  orderStatusBucket,
  type LeadStatusBucket,
  type OrderStatusBucket,
} from './customer-lookup.util';

/** Phone regions tried for a bare local number — same primary markets as the partner phone keys. */
const PHONE_REGIONS = [null, 'SA', 'EG', 'AE'] as const;
/** Candidate rows read before the visibility filter and the response cap. */
const CANDIDATE_LIMIT = 25;

export interface AdvancedLookupMatch {
  kind: 'CUSTOMER' | 'LEAD';
  /** Masked, never the full number. */
  maskedPhone: string | null;
  /** First two letters of each word only. */
  partialName: string;
  /** The most relevant record of this customer, reference + coarse status only. */
  reference: {
    type: 'ORDER' | 'LEAD';
    number: string;
    status: OrderStatusBucket | LeadStatusBucket;
  } | null;
  /** AR "غير مسند إليك" — nothing of this customer is assigned to the caller. */
  notAssignedToYou: boolean;
  /**
   * Set ONLY when the caller already has scope over the referenced record (it
   * is then the same record their own lists show). Discovery is never a link.
   */
  openable: { type: 'ORDER' | 'LEAD'; id: string } | null;
}

export interface AdvancedLookupResult {
  exists: boolean;
  matches: AdvancedLookupMatch[];
  /** More candidates existed than the response cap — refine the query. */
  capped: boolean;
  /** Lookups left in the current rate window. */
  remainingInWindow: number;
}

/**
 * `customers.lookup_advanced` — minimal-disclosure customer discovery (R7).
 * Fixed response shape, deliberately NOT built from the order/lead read
 * models: no address, balances, payments, evidence, owner or agent identity,
 * no full order. Internal data only (agent customers/orders never surface).
 * Every call — hit, miss, rejected or throttled — is written to
 * `GlobalLookupAudit`, which is also the per-user rate-limit ledger (durable
 * and shared across API instances).
 */
@Injectable()
export class CustomerLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phones: PhoneNumberService,
    private readonly salesScope: SalesScopeService,
    private readonly throttle: LookupThrottleService,
  ) {}

  async lookup(
    userId: string,
    rawQuery: string,
  ): Promise<AdvancedLookupResult> {
    const query = classifyQuery(rawQuery);
    const queryValue = (rawQuery ?? '').trim().slice(0, 60) || '(empty)';

    if (query.kind === 'INVALID') {
      await this.throttle.record(
        userId,
        GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
        GlobalLookupMethod.PHONE,
        queryValue,
        'REJECTED',
        0,
      );
      throw new BadRequestException({
        code: 'LOOKUP_QUERY_TOO_SHORT',
        message:
          query.reason === 'TOO_LONG'
            ? 'Search text is too long.'
            : 'Enter a phone number (7 digits or more) or the first and last name of the customer.',
      });
    }

    const { remaining: remainingBefore, reservationId } =
      await this.throttle.reserve(
        userId,
        GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
        query.kind === 'PHONE'
          ? GlobalLookupMethod.PHONE
          : GlobalLookupMethod.NAME,
        queryValue,
      );

    const scope = await this.salesScope.resolve(userId);
    const { matches, capped } =
      query.kind === 'PHONE'
        ? await this.searchByPhone(userId, scope, query.value)
        : await this.searchByName(userId, scope, query.words);

    await this.throttle.finalise(reservationId, {
      outcome: matches.length > 0 ? 'MATCH' : 'NO_MATCH',
      resultCount: matches.length,
      queryValue:
        query.kind === 'PHONE'
          ? (this.phoneCandidates(query.value)[0] ?? query.digits)
          : query.value,
    });

    return {
      exists: matches.length > 0,
      matches,
      capped,
      remainingInWindow: Math.max(remainingBefore - 1, 0),
    };
  }

  // ── search ───────────────────────────────────────────────────────────────

  private phoneCandidates(raw: string): string[] {
    const out = new Set<string>();
    for (const region of PHONE_REGIONS) {
      const e164 = this.phones.normalizeToE164(raw, region);
      if (e164) out.add(e164);
    }
    return [...out];
  }

  private async searchByPhone(userId: string, scope: SalesScope, raw: string) {
    const e164s = this.phoneCandidates(raw);
    if (e164s.length === 0) return { matches: [], capped: false };
    const [keys, leads] = await Promise.all([
      this.prisma.partnerPhoneKey.findMany({
        where: { phoneE164: { in: e164s } },
        select: { partnerId: true, phoneE164: true },
        take: CANDIDATE_LIMIT,
      }),
      this.prisma.lead.findMany({
        where: { mobileNumber: { in: e164s }, agentId: null, deletedAt: null },
        select: { partnerId: true },
        take: CANDIDATE_LIMIT,
      }),
    ]);
    const candidateIds = [...new Set(keys.map((k) => k.partnerId))];
    // A phone key can belong to a supplier or other non-customer partner —
    // discovery is about customers only (same rule as the name search).
    const customerIds =
      candidateIds.length === 0
        ? []
        : (
            await this.prisma.partner.findMany({
              where: {
                id: { in: candidateIds },
                deletedAt: null,
                roles: { some: { role: PartnerRoleType.CUSTOMER } },
              },
              select: { id: true },
            })
          ).map((p) => p.id);
    const partnerIds = [
      ...new Set([
        ...customerIds,
        ...leads.flatMap((l) => (l.partnerId ? [l.partnerId] : [])),
      ]),
    ];
    return this.buildMatches(userId, scope, {
      partnerIds,
      leadWhere: { mobileNumber: { in: e164s } },
    });
  }

  /**
   * Name discovery is deliberately narrow so it cannot be used to harvest
   * customers by sweeping short prefixes: every word of the query must match
   * (at least two words, see `classifyQuery`), and a query that is still too
   * broad — more than `MAX_RESULTS` customers — returns NO rows at all and
   * asks the user to refine. A specific full name finds its customer; a
   * trigram sweep finds nothing.
   */
  private async searchByName(
    userId: string,
    scope: SalesScope,
    words: string[],
  ) {
    const partners = await this.prisma.partner.findMany({
      where: {
        deletedAt: null,
        roles: { some: { role: PartnerRoleType.CUSTOMER } },
        AND: words.map((w) => ({
          name: { contains: w, mode: 'insensitive' as const },
        })),
      },
      select: { id: true },
      take: CANDIDATE_LIMIT,
    });
    const result = await this.buildMatches(userId, scope, {
      partnerIds: partners.map((p) => p.id),
      leadWhere: {
        AND: words.map((w) => ({
          customerName: { contains: w, mode: 'insensitive' as const },
        })),
      },
    });
    if (result.matches.length > MAX_RESULTS || result.capped) {
      return { matches: [], capped: true };
    }
    return result;
  }

  /**
   * Shared assembly. INTERNAL data only: orders/leads with an `agentId` are
   * never read into the result, and a customer whose only footprint is an
   * agent's is not shown at all.
   */
  private async buildMatches(
    userId: string,
    scope: SalesScope,
    input: { partnerIds: string[]; leadWhere: Prisma.LeadWhereInput },
  ): Promise<{ matches: AdvancedLookupMatch[]; capped: boolean }> {
    const { partnerIds } = input;
    const [
      partners,
      orders,
      partnerLeads,
      agentOrders,
      agentLeads,
      looseLeads,
    ] = await Promise.all([
      this.prisma.partner.findMany({
        where: { id: { in: partnerIds }, deletedAt: null },
        select: {
          id: true,
          name: true,
          phone: true,
          mobile: true,
          createdAt: true,
        },
      }),
      this.prisma.storeOrder.findMany({
        where: {
          partnerId: { in: partnerIds },
          agentId: null,
          deletedAt: null,
        },
        orderBy: { orderDate: 'desc' },
        select: {
          id: true,
          partnerId: true,
          internalOrderId: true,
          employeeId: true,
          fulfillmentStatus: { select: { code: true } },
        },
      }),
      this.prisma.lead.findMany({
        where: {
          partnerId: { in: partnerIds },
          agentId: null,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          partnerId: true,
          leadNumber: true,
          salesEmployeeId: true,
          agentId: true,
          status: { select: { code: true } },
        },
      }),
      this.prisma.storeOrder.findMany({
        where: {
          partnerId: { in: partnerIds },
          agentId: { not: null },
          deletedAt: null,
        },
        select: { partnerId: true },
        distinct: ['partnerId'],
      }),
      this.prisma.lead.findMany({
        where: {
          partnerId: { in: partnerIds },
          agentId: { not: null },
          deletedAt: null,
        },
        select: { partnerId: true },
        distinct: ['partnerId'],
      }),
      this.prisma.lead.findMany({
        where: {
          AND: [
            input.leadWhere,
            { agentId: null, deletedAt: null },
            partnerIds.length
              ? {
                  OR: [
                    { partnerId: null },
                    { partnerId: { notIn: partnerIds } },
                  ],
                }
              : {},
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATE_LIMIT,
        select: {
          id: true,
          leadNumber: true,
          customerName: true,
          mobileNumber: true,
          salesEmployeeId: true,
          agentId: true,
          status: { select: { code: true } },
        },
      }),
    ]);

    const agentFootprint = new Set(
      [...agentOrders, ...agentLeads].map((row) => row.partnerId),
    );
    const matches: AdvancedLookupMatch[] = [];

    for (const partner of partners) {
      const partnerOrders = orders.filter((o) => o.partnerId === partner.id);
      const leadsOfPartner = partnerLeads.filter(
        (l) => l.partnerId === partner.id,
      );
      const hasInternal = partnerOrders.length + leadsOfPartner.length > 0;
      // A customer that belongs only to an agent is invisible here.
      if (!hasInternal && agentFootprint.has(partner.id)) continue;

      const latestOrder = partnerOrders[0] ?? null;
      const latestLead = leadsOfPartner[0] ?? null;
      const assignedToYou =
        partnerOrders.some((o) => o.employeeId === userId) ||
        leadsOfPartner.some((l) => l.salesEmployeeId === userId);

      let reference: AdvancedLookupMatch['reference'] = null;
      let openable: AdvancedLookupMatch['openable'] = null;
      if (latestOrder) {
        reference = {
          type: 'ORDER',
          number: latestOrder.internalOrderId,
          status: orderStatusBucket(latestOrder.fulfillmentStatus?.code),
        };
        if (await this.canOpenOrder(scope, latestOrder.id)) {
          openable = { type: 'ORDER', id: latestOrder.id };
        }
      } else if (latestLead) {
        reference = {
          type: 'LEAD',
          number: latestLead.leadNumber,
          status: leadStatusBucket(latestLead.status.code),
        };
        if (this.salesScope.canAccessLead(scope, latestLead)) {
          openable = { type: 'LEAD', id: latestLead.id };
        }
      }
      matches.push({
        kind: 'CUSTOMER',
        maskedPhone: maskPhone(partner.mobile ?? partner.phone),
        partialName: maskName(partner.name),
        reference,
        notAssignedToYou: !assignedToYou,
        openable,
      });
    }

    // Leads whose customer is not (yet) a partner — one entry per number.
    const seenNumbers = new Set<string>();
    for (const lead of looseLeads) {
      if (seenNumbers.has(lead.mobileNumber)) continue;
      seenNumbers.add(lead.mobileNumber);
      const sameNumber = looseLeads.filter(
        (l) => l.mobileNumber === lead.mobileNumber,
      );
      matches.push({
        kind: 'LEAD',
        maskedPhone: maskPhone(lead.mobileNumber),
        partialName: maskName(lead.customerName),
        reference: {
          type: 'LEAD',
          number: lead.leadNumber,
          status: leadStatusBucket(lead.status.code),
        },
        notAssignedToYou: !sameNumber.some((l) => l.salesEmployeeId === userId),
        openable: this.salesScope.canAccessLead(scope, lead)
          ? { type: 'LEAD', id: lead.id }
          : null,
      });
    }

    return {
      matches: matches.slice(0, MAX_RESULTS),
      capped: matches.length > MAX_RESULTS,
    };
  }

  /** The caller's own by-id rule — discovery never widens it. */
  private async canOpenOrder(
    scope: SalesScope,
    orderId: string,
  ): Promise<boolean> {
    const found = await this.prisma.storeOrder.findFirst({
      where: {
        AND: [
          { id: orderId, deletedAt: null },
          this.salesScope.storeOrderAccessWhere(scope),
        ],
      },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * True when the caller may already open at least one internal order or lead
   * of this customer under their own scope. The legacy lookups use it to
   * decide between full details (their own customer) and the minimal masked
   * shape (somebody else's customer).
   */
  async callerCanOpenPartner(
    userId: string,
    partnerId: string,
  ): Promise<boolean> {
    const scope = await this.salesScope.resolve(userId);
    const [order, leads] = await Promise.all([
      this.prisma.storeOrder.findFirst({
        where: {
          AND: [
            { partnerId, agentId: null, deletedAt: null },
            this.salesScope.storeOrderAccessWhere(scope),
          ],
        },
        select: { id: true },
      }),
      this.prisma.lead.findMany({
        where: { partnerId, agentId: null, deletedAt: null },
        select: { id: true, salesEmployeeId: true, agentId: true },
        take: 50,
      }),
    ]);
    return (
      order !== null ||
      leads.some((lead) => this.salesScope.canAccessLead(scope, lead))
    );
  }

  /** Same idea for a single order (the legacy order-number lookup). */
  async callerCanOpenOrder(userId: string, orderId: string): Promise<boolean> {
    return this.canOpenOrder(await this.salesScope.resolve(userId), orderId);
  }
}
