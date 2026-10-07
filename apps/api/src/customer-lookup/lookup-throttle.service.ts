import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { GlobalLookupAction, GlobalLookupMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RATE_LIMIT_DAY_MS,
  RATE_LIMIT_MAX_PER_DAY,
  RATE_LIMIT_MAX_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
} from './customer-lookup.util';

export type LookupOutcome = 'MATCH' | 'NO_MATCH' | 'RATE_LIMITED' | 'REJECTED';

/**
 * One per-user anti-enumeration budget for EVERY customer/order discovery
 * route (advanced lookup, legacy phone lookup, legacy order-number lookup), so
 * switching endpoint cannot multiply the allowance. The ledger is
 * `GlobalLookupAudit`: durable and shared across API instances (an in-memory
 * limiter would be per serverless instance and nearly useless).
 *
 * `reserve` counts and inserts a `PENDING` row under a per-user advisory lock,
 * so N parallel requests cannot all read the same count and slip past the
 * limit; `finalise` completes that row once the result is known.
 */
@Injectable()
export class LookupThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(
    userId: string,
    action: GlobalLookupAction,
    method: GlobalLookupMethod,
    queryValue: string,
  ): Promise<{ remaining: number; reservationId: string }> {
    const now = Date.now();
    const decision = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-lookup:${userId}`}))`;
      const counted: Prisma.GlobalLookupAuditWhereInput = {
        userId,
        // Pre-R7 rows carry no outcome (NULL); they still count as lookups.
        OR: [{ outcome: null }, { outcome: { not: 'RATE_LIMITED' } }],
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
          action,
          method,
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
          outcome: 'RATE_LIMITED',
          createdAt: { gte: new Date(now - 60_000) },
        },
      });
      if (recentThrottle === 0) {
        await this.record(
          userId,
          action,
          method,
          queryValue,
          'RATE_LIMITED',
          0,
        );
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

  /** Completes a reservation with the final outcome. */
  async finalise(
    reservationId: string,
    result: {
      outcome: LookupOutcome;
      /** R14 — e.g. `FULL_DISCLOSURE` when full customer details were shown. */
      outcomeDetail?: string | null;
      resultCount: number;
      queryValue?: string;
      matchedPartnerId?: string | null;
      matchedStoreOrderId?: string | null;
    },
  ): Promise<void> {
    await this.prisma.globalLookupAudit.update({
      where: { id: reservationId },
      data: {
        outcome: result.outcome,
        outcomeDetail: result.outcomeDetail ?? null,
        resultCount: result.resultCount,
        ...(result.queryValue !== undefined
          ? { queryValue: result.queryValue }
          : {}),
        matchedPartnerId: result.matchedPartnerId ?? null,
        matchedStoreOrderId: result.matchedStoreOrderId ?? null,
      },
    });
  }

  /** One-shot audit row (rejected / throttled queries that never reserve). */
  async record(
    userId: string,
    action: GlobalLookupAction,
    method: GlobalLookupMethod,
    queryValue: string,
    outcome: LookupOutcome,
    resultCount: number,
  ): Promise<void> {
    await this.prisma.globalLookupAudit.create({
      data: { userId, action, method, queryValue, outcome, resultCount },
    });
  }
}
