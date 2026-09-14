import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvestorLedgerService } from '../investor-ledger/investor-ledger.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import { FindPortalPageQueryDto } from './dto/find-portal-page-query.dto';
import { FindPortalStatementQueryDto } from './dto/find-portal-statement-query.dto';

/**
 * Investor Engine Milestone 4, Part C-M — every method here takes
 * `investorId` as its FIRST parameter, always resolved server-side from the
 * authenticated `InvestorPortalAuthGuard` (see `@CurrentPortalInvestor()`).
 * No method in this service ever trusts an `investorId` supplied by the
 * caller for authorization; where a resource id (subscription/attachment)
 * is also supplied, it is always combined with `investorId` in the same
 * `where` clause so a mismatched id 404s instead of ever returning another
 * Investor's row (mission Part 23/24/53 — the core security property of
 * this whole module).
 */
@Injectable()
export class InvestorPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: InvestorLedgerService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async assertInvestor(investorId: string) {
    const investor = await this.prisma.investorProfile.findFirst({
      where: { id: investorId, deletedAt: null },
    });
    if (!investor) {
      throw new NotFoundException('Investor not found.');
    }
    return investor;
  }

  async getMe(investorId: string) {
    const row = await this.prisma.investorProfile.findFirst({
      where: { id: investorId, deletedAt: null },
      include: {
        partner: {
          select: { name: true, phone: true, mobile: true, email: true },
        },
        investorType: { select: { id: true, name: true, nameEn: true } },
        portalAccount: {
          select: { email: true, status: true, lastLoginAt: true },
        },
      },
    });
    if (!row) throw new NotFoundException('Investor not found.');
    return {
      id: row.id,
      name: row.partner.name,
      phone: row.partner.mobile ?? row.partner.phone,
      email: row.partner.email,
      investorType: row.investorType
        ? { name: row.investorType.name, nameEn: row.investorType.nameEn }
        : null,
      nationalId: row.nationalId,
      residencyId: row.residencyId,
      iban: row.iban,
      portalAccount: row.portalAccount
        ? {
            email: row.portalAccount.email,
            status: row.portalAccount.status,
            lastLoginAt: row.portalAccount.lastLoginAt,
          }
        : null,
    };
  }

  /** Mission Part 28/71/72 — the capital/profit-separated dashboard, sourced verbatim from `InvestorLedgerService.summary()` (Milestone 3's authoritative aggregate). */
  async getDashboard(investorId: string) {
    await this.assertInvestor(investorId);
    const summary = await this.ledger.summary(investorId);

    const recentSubscriptions = await this.prisma.investorSubscription.findMany(
      {
        where: { investorId, deletedAt: null },
        include: {
          opportunity: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
              status: true,
              startDate: true,
              endDate: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    );
    const profitByInvestment = await this.profitTotalsBySubscription(
      investorId,
      recentSubscriptions.map((s) => s.id),
    );

    return {
      ...summary,
      recentInvestments: recentSubscriptions.map((s) => ({
        subscriptionId: s.id,
        opportunityId: s.opportunity.id,
        opportunityCode: s.opportunity.code,
        opportunityName: s.opportunity.nameAr,
        opportunityNameEn: s.opportunity.nameEn,
        status: s.opportunity.status,
        startDate: s.opportunity.startDate,
        endDate: s.opportunity.endDate,
        confirmedFunding: Number(s.fundedAmount),
        participationPercent: Number(s.participationPercent),
        ...this.emptyProfitTotals(),
        ...profitByInvestment.get(s.id),
      })),
    };
  }

  private emptyProfitTotals() {
    return { approvedProfit: 0, paidProfit: 0, outstandingProfit: 0 };
  }

  /** SUM(entitled)/SUM(paid) per subscriptionId, scoped to this investor only — never another Investor's InvestorDistribution rows. */
  private async profitTotalsBySubscription(
    investorId: string,
    subscriptionIds: string[],
  ) {
    const map = new Map<
      string,
      { approvedProfit: number; paidProfit: number; outstandingProfit: number }
    >();
    if (subscriptionIds.length === 0) return map;
    const rows = await this.prisma.investorDistribution.findMany({
      where: {
        investorId,
        subscriptionId: { in: subscriptionIds },
        status: { not: 'CANCELLED' },
      },
      select: { subscriptionId: true, entitledAmount: true, paidAmount: true },
    });
    for (const row of rows) {
      const prev = map.get(row.subscriptionId) ?? {
        approvedProfit: 0,
        paidProfit: 0,
        outstandingProfit: 0,
      };
      const entitled = prev.approvedProfit + Number(row.entitledAmount);
      const paid = prev.paidProfit + Number(row.paidAmount);
      map.set(row.subscriptionId, {
        approvedProfit: round2(entitled),
        paidProfit: round2(paid),
        outstandingProfit: round2(entitled - paid),
      });
    }
    return map;
  }

  /** Mission Part 32/56 — paginated "My Investments", default 20/page. */
  async getInvestments(investorId: string, query: FindPortalPageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InvestorSubscriptionWhereInput = {
      investorId,
      deletedAt: null,
      opportunityId: query.opportunityId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.investorSubscription.findMany({
        where,
        include: {
          opportunity: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
              status: true,
              startDate: true,
              endDate: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investorSubscription.count({ where }),
    ]);
    const profitByInvestment = await this.profitTotalsBySubscription(
      investorId,
      rows.map((s) => s.id),
    );
    return {
      items: rows.map((s) => ({
        subscriptionId: s.id,
        opportunityId: s.opportunity.id,
        opportunityCode: s.opportunity.code,
        opportunityName: s.opportunity.nameAr,
        opportunityNameEn: s.opportunity.nameEn,
        status: s.opportunity.status,
        startDate: s.opportunity.startDate,
        endDate: s.opportunity.endDate,
        committedAmount: Number(s.committedAmount),
        confirmedFunding: Number(s.fundedAmount),
        participationPercent: Number(s.participationPercent),
        ...this.emptyProfitTotals(),
        ...profitByInvestment.get(s.id),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Mission Part 33/34/35 — `:id` is the InvestorSubscription id, scoped
   * `where: { id, investorId }` so requesting another Investor's
   * subscription id 404s (never confirms it exists). Performance metrics
   * are opportunity-wide aggregates (safe — no other Investor's identity or
   * amount is exposed), everything else (Funding/Profit/Payments) is this
   * Investor's own rows only.
   */
  async getInvestmentDetail(investorId: string, subscriptionId: string) {
    const subscription = await this.prisma.investorSubscription.findFirst({
      where: { id: subscriptionId, investorId, deletedAt: null },
      include: {
        opportunity: {
          include: {
            products: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!subscription) {
      throw new NotFoundException('Investment not found.');
    }

    const [contributions, distributions, saleAgg] = await Promise.all([
      this.prisma.capitalContribution.findMany({
        where: { subscriptionId: subscription.id, deletedAt: null },
        orderBy: { contributionDate: 'desc' },
        select: {
          id: true,
          amount: true,
          contributionDate: true,
          referenceNumber: true,
          status: true,
        },
      }),
      this.prisma.investorDistribution.findMany({
        where: { investorId, subscriptionId: subscription.id },
        include: {
          profitDistribution: { select: { code: true, status: true } },
          payments: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              id: true,
              amount: true,
              paymentDate: true,
              referenceNumber: true,
              status: true,
            },
            orderBy: { paymentDate: 'desc' },
          },
        },
      }),
      this.prisma.opportunitySaleAllocation.aggregate({
        where: { opportunityId: subscription.opportunityId, status: 'ACTIVE' },
        _sum: { allocatedQuantity: true },
      }),
    ]);

    const fundedUnits = subscription.opportunity.products.reduce(
      (sum, p) => sum + p.fundedUnits,
      0,
    );
    const soldUnits = saleAgg._sum.allocatedQuantity ?? 0;
    const remainingUnits = Math.max(fundedUnits - soldUnits, 0);
    const sellThroughPercent =
      fundedUnits > 0 ? round2((soldUnits / fundedUnits) * 100) : 0;

    const payments = distributions.flatMap((d) =>
      d.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentDate: p.paymentDate,
        referenceNumber: p.referenceNumber,
        status: p.status,
      })),
    );

    return {
      subscriptionId: subscription.id,
      opportunity: {
        id: subscription.opportunity.id,
        code: subscription.opportunity.code,
        nameAr: subscription.opportunity.nameAr,
        nameEn: subscription.opportunity.nameEn,
        status: subscription.opportunity.status,
        startDate: subscription.opportunity.startDate,
        endDate: subscription.opportunity.endDate,
      },
      myFunding: {
        committedAmount: Number(subscription.committedAmount),
        confirmedFunding: Number(subscription.fundedAmount),
        participationPercent: Number(subscription.participationPercent),
        contributions: contributions.map((c) => ({
          id: c.id,
          amount: Number(c.amount),
          contributionDate: c.contributionDate,
          referenceNumber: c.referenceNumber,
          status: c.status,
        })),
      },
      performance: {
        fundedUnits,
        soldUnits,
        remainingUnits,
        sellThroughPercent,
      },
      myProfit: distributions.map((d) => ({
        id: d.id,
        distributionCode: d.profitDistribution.code,
        entitledAmount: Number(d.entitledAmount),
        paidAmount: Number(d.paidAmount),
        outstandingAmount: round2(
          Number(d.entitledAmount) - Number(d.paidAmount),
        ),
        status: d.status,
      })),
      payments,
    };
  }

  /** Mission Part 36/56 — paginated Profits: one row per InvestorDistribution this Investor holds. */
  async getProfits(investorId: string, query: FindPortalPageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InvestorDistributionWhereInput = {
      investorId,
      subscription: query.opportunityId
        ? { opportunityId: query.opportunityId }
        : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.investorDistribution.findMany({
        where,
        include: {
          profitDistribution: {
            select: {
              code: true,
              opportunity: { select: { id: true, code: true, nameAr: true } },
            },
          },
          payments: {
            where: { status: 'CONFIRMED' },
            select: { paymentDate: true },
            orderBy: { paymentDate: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.investorDistribution.count({ where }),
    ]);
    return {
      items: rows.map((d) => ({
        id: d.id,
        opportunityId: d.profitDistribution.opportunity.id,
        opportunityCode: d.profitDistribution.opportunity.code,
        opportunityName: d.profitDistribution.opportunity.nameAr,
        distributionCode: d.profitDistribution.code,
        entitledAmount: Number(d.entitledAmount),
        paidAmount: Number(d.paidAmount),
        outstandingAmount: round2(
          Number(d.entitledAmount) - Number(d.paidAmount),
        ),
        status: d.status,
        lastPaymentDate: d.payments[0]?.paymentDate ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Mission Part 39/40/56 — Statement: a thin, investor-scoped wrapper around `InvestorLedgerService`. */
  async getStatement(investorId: string, query: FindPortalStatementQueryDto) {
    await this.assertInvestor(investorId);
    const [statement, summary] = await Promise.all([
      this.ledger.statement(investorId, query),
      this.ledger.summary(investorId),
    ]);
    return { ...statement, summary };
  }

  /** Mission Part 43/44/56 — merged list of the two real, schema-backed document types this Investor owns. */
  async getDocuments(investorId: string, query: FindPortalPageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [contributionDocs, paymentDocs] = await Promise.all([
      this.prisma.capitalContributionAttachment.findMany({
        where: {
          deletedAt: null,
          contribution: { subscription: { investorId } },
        },
        include: {
          attachment: {
            select: { id: true, originalName: true, mimeType: true },
          },
          contribution: {
            select: {
              subscription: {
                select: {
                  opportunity: {
                    select: { id: true, code: true, nameAr: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.distributionPaymentAttachment.findMany({
        where: {
          deletedAt: null,
          payment: { investorDistribution: { investorId } },
        },
        include: {
          attachment: {
            select: { id: true, originalName: true, mimeType: true },
          },
          payment: {
            select: {
              investorDistribution: {
                select: {
                  subscription: {
                    select: {
                      opportunity: {
                        select: { id: true, code: true, nameAr: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const merged = [
      ...contributionDocs
        .filter((d) => d.attachment)
        .map((d) => ({
          id: d.id,
          attachmentId: d.attachment!.id,
          fileName: d.attachment!.originalName,
          mimeType: d.attachment!.mimeType,
          documentType: 'FUNDING_RECEIPT' as const,
          opportunityId: d.contribution.subscription.opportunity.id,
          opportunityCode: d.contribution.subscription.opportunity.code,
          opportunityName: d.contribution.subscription.opportunity.nameAr,
          date: d.createdAt,
        })),
      ...paymentDocs
        .filter((d) => d.attachment)
        .map((d) => ({
          id: d.id,
          attachmentId: d.attachment!.id,
          fileName: d.attachment!.originalName,
          mimeType: d.attachment!.mimeType,
          documentType: 'DISTRIBUTION_RECEIPT' as const,
          opportunityId:
            d.payment.investorDistribution.subscription.opportunity.id,
          opportunityCode:
            d.payment.investorDistribution.subscription.opportunity.code,
          opportunityName:
            d.payment.investorDistribution.subscription.opportunity.nameAr,
          date: d.createdAt,
        })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const total = merged.length;
    const items = merged.slice((page - 1) * pageSize, page * pageSize);
    return { items, total, page, pageSize };
  }

  /**
   * Mission Part 44/62 — ownership MUST be verified before ever touching
   * object storage. `attachmentId` here is the `Attachment.id` (what the
   * documents list exposes as `attachmentId`); we independently re-derive
   * ownership from the join tables rather than trusting the caller.
   */
  async getDocumentFile(investorId: string, attachmentId: string) {
    const [contributionLink, paymentLink] = await Promise.all([
      this.prisma.capitalContributionAttachment.findFirst({
        where: {
          attachmentId,
          deletedAt: null,
          contribution: { subscription: { investorId } },
        },
        include: { attachment: true },
      }),
      this.prisma.distributionPaymentAttachment.findFirst({
        where: {
          attachmentId,
          deletedAt: null,
          payment: { investorDistribution: { investorId } },
        },
        include: { attachment: true },
      }),
    ]);
    const attachment = contributionLink?.attachment ?? paymentLink?.attachment;
    if (!attachment) {
      // Deliberately 404, not 403 — never confirms whether the attachment
      // id exists for another Investor.
      throw new NotFoundException('Document not found.');
    }
    const body = await this.objectStorage.get(attachment.storageKey);
    return {
      body,
      mimeType: attachment.mimeType,
      fileName: attachment.originalName,
    };
  }
}
