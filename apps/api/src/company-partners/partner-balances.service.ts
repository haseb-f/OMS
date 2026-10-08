import { Injectable } from '@nestjs/common';
import { PartnerProfitPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2HalfUp } from './partner-profit-calculator';

export interface PartnerBalance {
  /** Approved entitlements (closed periods incl. adjustments). */
  approved: number;
  /** Payments not reversed. */
  paid: number;
  /** approved − paid when positive: still owed to the partner. */
  payable: number;
  /** paid − approved when positive: paid ahead of approved profit. */
  advance: number;
}

/**
 * Approved / paid / payable / advance of company partners, from the posted
 * documents themselves (closed-period entitlements and non-reversed
 * payments). Each of them posted exactly one partner-dimensioned line on the
 * payable account, so these figures equal that account's partner balance.
 */
@Injectable()
export class PartnerBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async forPartners(
    partnerIds: string[],
  ): Promise<Map<string, PartnerBalance>> {
    const result = new Map<string, PartnerBalance>();
    if (partnerIds.length === 0) return result;
    const [entitlements, payments] = await Promise.all([
      this.prisma.partnerEntitlement.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { in: partnerIds },
          period: { status: PartnerProfitPeriodStatus.CLOSED },
        },
        _sum: { amount: true },
      }),
      this.prisma.partnerPayment.groupBy({
        by: ['partnerId'],
        where: { partnerId: { in: partnerIds }, reversedAt: null },
        _sum: { amount: true },
      }),
    ]);
    const approvedOf = new Map(
      entitlements.map((row) => [row.partnerId, row._sum.amount ?? 0]),
    );
    const paidOf = new Map(
      payments.map((row) => [row.partnerId, row._sum.amount ?? 0]),
    );
    for (const partnerId of partnerIds) {
      const approved = round2HalfUp(String(approvedOf.get(partnerId) ?? 0));
      const paid = round2HalfUp(String(paidOf.get(partnerId) ?? 0));
      const balance = round2HalfUp(new Prisma.Decimal(approved).sub(paid));
      result.set(partnerId, {
        approved,
        paid,
        payable: balance > 0 ? balance : 0,
        advance: balance < 0 ? -balance : 0,
      });
    }
    return result;
  }
}
