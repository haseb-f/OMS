import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  GlobalLookupAction,
  GlobalLookupMethod,
  PartnerRoleType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  RATE_LIMIT_DAY_MS,
  RATE_LIMIT_MAX_PER_DAY,
  RATE_LIMIT_MAX_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
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
  ) {}

  async lookup(
    userId: string,
    rawQuery: string,
  ): Promise<AdvancedLookupResult> {
    const query = classifyQuery(rawQuery);
    const queryValue = (rawQuery ?? '').trim().slice(0, 60) || '(empty)';

    if (query.kind === 'INVALID') {
      await this.audit(userId, 'PHONE', queryValue, 'REJECTED', 0);
      throw new BadRequestException({
        code: 'LOOKUP_QUERY_TOO_SHORT',
        message:
          query.reason === 'TOO_LONG'
            ? 'Search text is too long.'
            : 'Enter a phone number (7 digits or more) or at least 3 letters of the name.',
      });
    }

    const { remaining: remainingBefore, reservationId } =
      await this.assertWithinRateLimit(userId, query.kind, queryValue);

    const scope = await this.salesScope.resolve(userId);
    const { matches, capped } =
      query.kind === 'PHONE'
        ? await this.searchByPhone(userId, scope, query.value)
        : await this.searchByName(userId, scope, query.value);

    const outcome = matches.length > 0 ? 'MATCH' : 'NO_MATCH';
    await this.audit(
      userId,
      query.kind,
      query.kind === 'PHONE'
        ? (this.phoneCandidates(query.value)[0] ?? query.digits)
        : query.value,
      outcome,
      matches.length,
      undefined,
      reservationId,
    );

    return {
      exists: matches.length > 0,
      matches,
      capped,
      remainingInWindow: Math.max(remainingBefore - 1, 0),
    };
  }

  // ── rate limit + audit ───────────────────────────────────────────────────

  private async assertWithinRateLimit(
    userId: string,
    method: 'PHONE' | 'NAME',
    queryValue: string,
  ): Promise<{ remaining: number; reservationId: string }> {
    const now = Date.now();
    // Count and reserve under a per-user advisory lock so N parallel requests
    // cannot all read the same count and slip past the limit. The reservation
    // row ('PENDING') counts immediately and is finalised by `audit`.
    const decision = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-lookup:${userId}`}))`;
      const counted: Prisma.GlobalLookupAuditWhereInput = {
        userId,
        action: GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
        outcome: { not: 'RATE_LIMITED' },
      };
      const [inWindow, inDay] = await Promise.all([
        tx.globalLookupAudit.count({
          where: {
            ...counted,
            createdAt: { gte: new Date(now - RATE_LIMIT_WINDOW_MS) },
          },
        }),
        tx.globalLookupAudit.count({
          where: {
            ...counted,
            createdAt: { gte: new Date(now - RATE_LIMIT_DAY_MS) },
          },
        }),
      ]);
      if (
        inWindow >= RATE_LIMIT_MAX_PER_WINDOW ||
        inDay >= RATE_LIMIT_MAX_PER_DAY
      ) {
        return { limited: true as const, inDay };
      }
      const reservation = await tx.globalLookupAudit.create({
        data: {
          userId,
          action: GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
          method:
            method === 'PHONE'
              ? GlobalLookupMethod.PHONE
              : GlobalLookupMethod.NAME,
          queryValue,
          outcome: 'PENDING',
          resultCount: 0,
        },
        select: { id: true },
      });
      return {
        limited: false as const,
        reservationId: reservation.id,
        remaining: Math.min(
          RATE_LIMIT_MAX_PER_WINDOW - inWindow,
          RATE_LIMIT_MAX_PER_DAY - inDay,
        ),
      };
    });

    if (decision.limited) {
      // One throttle row per minute is enough evidence; a flood must not
      // become an unbounded write.
      const recentThrottle = await this.prisma.globalLookupAudit.count({
        where: {
          userId,
          action: GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
          outcome: 'RATE_LIMITED',
          createdAt: { gte: new Date(now - 60_000) },
        },
      });
      if (recentThrottle === 0) {
        await this.audit(userId, method, queryValue, 'RATE_LIMITED', 0);
      }
      const retryAfterSeconds = Math.ceil(
        (decision.inDay >= RATE_LIMIT_MAX_PER_DAY
          ? RATE_LIMIT_DAY_MS
          : RATE_LIMIT_WINDOW_MS) / 1000,
      );
      throw new HttpException(
        {
          code: 'LOOKUP_RATE_LIMITED',
          message:
            'Too many customer lookups. Please wait a few minutes before searching again.',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return {
      remaining: decision.remaining,
      reservationId: decision.reservationId,
    };
  }

  private async audit(
    userId: string,
    method: 'PHONE' | 'NAME',
    queryValue: string,
    outcome: 'MATCH' | 'NO_MATCH' | 'RATE_LIMITED' | 'REJECTED',
    resultCount: number,
    matchedPartnerId?: string,
    reservationId?: string,
  ) {
    if (reservationId) {
      await this.prisma.globalLookupAudit.update({
        where: { id: reservationId },
        data: { queryValue, outcome, resultCount, matchedPartnerId },
      });
      return;
    }
    await this.prisma.globalLookupAudit.create({
      data: {
        userId,
        action: GlobalLookupAction.ADVANCED_CUSTOMER_LOOKUP,
        method:
          method === 'PHONE'
            ? GlobalLookupMethod.PHONE
            : GlobalLookupMethod.NAME,
        queryValue,
        outcome,
        resultCount,
        matchedPartnerId,
      },
    });
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

  private async searchByName(userId: string, scope: SalesScope, name: string) {
    const [partners] = await Promise.all([
      this.prisma.partner.findMany({
        where: {
          deletedAt: null,
          name: { contains: name, mode: 'insensitive' },
          roles: { some: { role: PartnerRoleType.CUSTOMER } },
        },
        select: { id: true },
        take: CANDIDATE_LIMIT,
      }),
    ]);
    return this.buildMatches(userId, scope, {
      partnerIds: partners.map((p) => p.id),
      leadWhere: { customerName: { contains: name, mode: 'insensitive' } },
    });
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
}
