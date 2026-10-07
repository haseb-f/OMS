import { Injectable } from '@nestjs/common';
import { PartnerProfitPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { businessDateOf } from '../common/time/business-date';
import {
  CompanyPartnersService,
  parseBusinessDate,
} from './company-partners.service';
import { PartnerProfitService } from './partner-profit.service';
import { PartnerPaymentsService } from './partner-payments.service';
import { PartnerBalancesService } from './partner-balances.service';
import { dateValue, isoDate, round2HalfUp } from './partner-profit-calculator';

/**
 * R14 W5 (spec-5 §6) — one partner's statement for a range: terms in force,
 * the live estimate (تقديري — recomputed from the ledger, never stored),
 * the approved amounts of closed periods inside the range, payments, and
 * the all-time payable / advance position.
 */
@Injectable()
export class PartnerStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: CompanyPartnersService,
    private readonly profit: PartnerProfitService,
    private readonly payments: PartnerPaymentsService,
    private readonly balances: PartnerBalancesService,
  ) {}

  async statement(partnerId: string, fromInput?: string, toInput?: string) {
    const today = businessDateOf(new Date());
    const to = toInput ? parseBusinessDate(toInput, 'to') : today;
    const from = fromInput
      ? parseBusinessDate(fromInput, 'from')
      : `${to.slice(0, 4)}-01-01`;
    const profile = await this.partners.findOne(partnerId);

    const [calculation, periods, payments, rangeBalance] = await Promise.all([
      this.profit.calculate(from, to),
      this.prisma.partnerProfitPeriod.findMany({
        where: {
          status: PartnerProfitPeriodStatus.CLOSED,
          periodFrom: { gte: dateValue(from) },
          periodTo: { lte: dateValue(to) },
          entitlements: { some: { partnerId } },
        },
        include: {
          entitlements: { where: { partnerId } },
          adjustments: { select: { id: true, journalEntryId: true } },
        },
        orderBy: { periodFrom: 'asc' },
      }),
      this.payments.list(partnerId),
      this.balances.forPartners([partnerId], { from, to }),
    ]);

    const own = calculation.partners.find((p) => p.partnerId === partnerId);
    const sum = (rows: Array<{ amount: Prisma.Decimal }>) =>
      round2HalfUp(
        rows.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0)),
      );

    return {
      partner: {
        partnerId: profile.partnerId,
        name: profile.name,
        partnerNumber: profile.partnerNumber,
        ownershipPercent: profile.ownershipPercent,
        status: profile.status,
      },
      range: { from, to },
      currency: calculation.currency,
      agreements: profile.agreements.filter(
        (a) =>
          a.status !== 'DRAFT' &&
          a.effectiveFrom <= to &&
          (a.effectiveTo === null || a.effectiveTo >= from),
      ),
      /** Live estimate — clearly an estimate, recomputed from the ledger each time. */
      estimate: {
        figures: calculation.figures,
        segments: own?.segments ?? [],
        amount: own?.amount ?? 0,
        computedAt: calculation.computedAt,
        warnings: calculation.warnings,
      },
      approved: {
        periods: periods.map((period) => ({
          periodId: period.id,
          periodFrom: isoDate(period.periodFrom),
          periodTo: isoDate(period.periodTo),
          original: sum(
            period.entitlements.filter((e) => e.kind === 'ORIGINAL'),
          ),
          adjustments: sum(
            period.entitlements.filter((e) => e.kind === 'ADJUSTMENT'),
          ),
          total: sum(period.entitlements),
          journalEntryId: period.journalEntryId,
          adjustmentIds: period.adjustments.map((a) => a.id),
        })),
        total: rangeBalance.get(partnerId)!.approved,
      },
      payments: payments.filter((p) => p.date >= from && p.date <= to),
      paidInRange: rangeBalance.get(partnerId)!.paid,
      /** All-time position: what is still owed (payable) or paid ahead (advance). */
      balance: {
        approved: profile.approved,
        paid: profile.paid,
        payable: profile.payable,
        advance: profile.advance,
      },
      currentAgreements: profile.agreements.filter(
        (a) => a.status === 'ACTIVE',
      ),
    };
  }
}
