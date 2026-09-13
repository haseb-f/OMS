import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DistributionPaymentStatus,
  InvestorDistributionStatus,
  InvestorLedgerEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { InvestorLedgerService } from '../investor-ledger/investor-ledger.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../investment-opportunities/shared/opportunity-totals.util';
import {
  ProfitDistributionsService,
  deriveInvestorDistributionStatus,
} from './profit-distributions.service';
import { CreateDistributionPaymentDto } from './dto/create-distribution-payment.dto';
import { FindDistributionPaymentsQueryDto } from './dto/find-distribution-payments-query.dto';

const ENTITY_TYPE = 'DISTRIBUTION_PAYMENT';
const SOURCE_TYPE = 'INVESTOR_PROFIT_PAYMENT';

const PAYMENT_INCLUDE = {
  financialAccount: { select: { id: true, code: true, name: true } },
  paymentMethod: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  confirmedBy: { select: { id: true, fullName: true } },
  investorDistribution: {
    include: { investor: { include: { partner: { select: { name: true } } } } },
  },
} satisfies Prisma.DistributionPaymentInclude;

type PaymentWithRelations = Prisma.DistributionPaymentGetPayload<{
  include: typeof PAYMENT_INCLUDE;
}>;

function toPaymentView(row: PaymentWithRelations) {
  return {
    id: row.id,
    investorDistributionId: row.investorDistributionId,
    investorName: row.investorDistribution.investor.partner.name,
    amount: Number(row.amount),
    paymentDate: row.paymentDate,
    financialAccount: row.financialAccount,
    paymentMethod: row.paymentMethod,
    referenceNumber: row.referenceNumber,
    status: row.status,
    createdBy: row.createdBy?.fullName ?? null,
    confirmedBy: row.confirmedBy?.fullName ?? null,
    confirmedAt: row.confirmedAt,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

/**
 * Investor Engine Milestone 3, Phases 8-12/23/42/52/56/66 — records and
 * confirms actual Investor profit payouts. `InvestorDistribution.paidAmount`
 * only ever changes inside `confirm()`/`cancel()`, both row-locked
 * (`SELECT ... FOR UPDATE`, same pattern InvestmentSettlementService already
 * uses) so two concurrent confirmations of the same/overlapping payments can
 * never together exceed the entitlement (Phase 52).
 */
@Injectable()
export class DistributionPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly ledger: InvestorLedgerService,
    private readonly activityLog: MasterDataActivityLogService,
    private readonly distributions: ProfitDistributionsService,
  ) {}

  private async findRaw(
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const row = await client.distributionPayment.findFirst({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!row)
      throw new NotFoundException(`Distribution Payment ${id} not found`);
    return row;
  }

  async findOne(id: string) {
    return toPaymentView(await this.findRaw(id));
  }

  async findAll(query: FindDistributionPaymentsQueryDto) {
    const where: Prisma.DistributionPaymentWhereInput = {
      investorDistributionId: query.investorDistributionId,
      status: query.status?.length ? { in: query.status } : undefined,
    };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.distributionPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.distributionPayment.count({ where }),
    ]);
    return { items: items.map(toPaymentView), total, page, pageSize };
  }

  /** Phase 8/42 — PENDING draft; entitlement is only ever affected once confirmed. Early UX-level overpayment check; confirm() re-validates authoritatively under lock. */
  async create(dto: CreateDistributionPaymentDto, userId?: string) {
    const distribution = await this.prisma.investorDistribution.findFirst({
      where: { id: dto.investorDistributionId },
    });
    if (!distribution) {
      throw new NotFoundException(
        `Investor Distribution ${dto.investorDistributionId} not found`,
      );
    }
    if (
      distribution.status !== InvestorDistributionStatus.PAYABLE &&
      distribution.status !== InvestorDistributionStatus.PARTIALLY_PAID
    ) {
      throw new BadRequestException(
        `Cannot record a payment against an Investor Distribution in ${distribution.status} status.`,
      );
    }
    const outstanding = round2(
      Number(distribution.entitledAmount) - Number(distribution.paidAmount),
    );
    if (dto.amount > outstanding + 0.01) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds the outstanding entitlement (${outstanding}).`,
      );
    }

    const created = await this.prisma.distributionPayment.create({
      data: {
        investorDistributionId: dto.investorDistributionId,
        amount: dto.amount,
        paymentDate: new Date(dto.paymentDate),
        financialAccountId: dto.financialAccountId,
        paymentMethodId: dto.paymentMethodId,
        referenceNumber: dto.referenceNumber,
        notes: dto.notes,
        createdById: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      created.id,
      'CREATED',
      `Payment of ${dto.amount} recorded`,
      userId,
    );
    return this.findOne(created.id);
  }

  /**
   * Phase 10/11/12/23/52/66 — the authoritative confirmation. Row-locks the
   * payment and its parent Investor Distribution, re-derives outstanding
   * fresh under lock, blocks overpayment, posts accounting, records the
   * ledger entry, and recomputes both InvestorDistribution and
   * ProfitDistribution status — all inside one transaction.
   */
  async confirm(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM distribution_payments WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await this.findRaw(id, tx);
      if (payment.status !== DistributionPaymentStatus.PENDING) {
        throw new BadRequestException(
          `Only a Pending payment can be confirmed (currently ${payment.status}).`,
        );
      }

      await tx.$queryRaw`SELECT id FROM investor_distributions WHERE id = ${payment.investorDistributionId}::uuid FOR UPDATE`;
      const distribution = await tx.investorDistribution.findUniqueOrThrow({
        where: { id: payment.investorDistributionId },
      });
      const entitled = Number(distribution.entitledAmount);
      const currentPaid = Number(distribution.paidAmount);
      const newPaid = round2(currentPaid + Number(payment.amount));
      if (newPaid > entitled + 0.01) {
        throw new BadRequestException(
          `Confirming this payment would bring paid (${newPaid}) above the entitlement (${entitled}) — overpayment is blocked.`,
        );
      }

      await tx.distributionPayment.update({
        where: { id },
        data: {
          status: DistributionPaymentStatus.CONFIRMED,
          confirmedById: userId ?? null,
          confirmedAt: new Date(),
        },
      });
      await tx.investorDistribution.update({
        where: { id: distribution.id },
        data: {
          paidAmount: newPaid,
          status: deriveInvestorDistributionStatus(entitled, newPaid),
        },
      });

      await this.postingEngine.post(SOURCE_TYPE, id, userId, tx);
      await this.ledger.record(
        {
          investorId: payment.investorDistribution.investorId,
          entryDate: new Date(payment.paymentDate),
          type: InvestorLedgerEntryType.PROFIT_PAYMENT,
          description: `Distribution Payment confirmed${payment.referenceNumber ? ` (${payment.referenceNumber})` : ''}`,
          referenceType: 'DISTRIBUTION_PAYMENT',
          referenceId: id,
          debitAmount: Number(payment.amount),
          userId,
        },
        tx,
      );

      await this.distributions.recomputeStatus(
        distribution.profitDistributionId,
        tx,
      );

      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'CONFIRMED',
        `Payment of ${Number(payment.amount)} confirmed`,
        userId,
      );
      return toPaymentView(await this.findRaw(id, tx));
    });
  }

  async reject(id: string, reason: string | undefined, userId?: string) {
    const existing = await this.findRaw(id);
    if (existing.status !== DistributionPaymentStatus.PENDING) {
      throw new BadRequestException(
        `Only a Pending payment can be rejected (currently ${existing.status}).`,
      );
    }
    await this.prisma.distributionPayment.update({
      where: { id },
      data: {
        status: DistributionPaymentStatus.REJECTED,
        notes: reason
          ? `${existing.notes ?? ''}\nRejected: ${reason}`.trim()
          : existing.notes,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'REJECTED',
      reason ? `Payment rejected: ${reason}` : 'Payment rejected',
      userId,
    );
    return this.findOne(id);
  }

  /** Phase 26/60 — reverses a CONFIRMED payment's accounting + ledger + paidAmount; a PENDING payment simply cancels with no financial effect to undo. */
  async cancel(id: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM distribution_payments WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await this.findRaw(id, tx);
      if (
        payment.status !== DistributionPaymentStatus.PENDING &&
        payment.status !== DistributionPaymentStatus.CONFIRMED
      ) {
        throw new BadRequestException(
          `A ${payment.status} payment cannot be cancelled.`,
        );
      }

      if (payment.status === DistributionPaymentStatus.CONFIRMED) {
        await tx.$queryRaw`SELECT id FROM investor_distributions WHERE id = ${payment.investorDistributionId}::uuid FOR UPDATE`;
        const distribution = await tx.investorDistribution.findUniqueOrThrow({
          where: { id: payment.investorDistributionId },
        });
        const entitled = Number(distribution.entitledAmount);
        const newPaid = round2(
          Number(distribution.paidAmount) - Number(payment.amount),
        );
        await tx.investorDistribution.update({
          where: { id: distribution.id },
          data: {
            paidAmount: newPaid,
            status: deriveInvestorDistributionStatus(entitled, newPaid),
          },
        });
        await this.postingEngine.reverse(SOURCE_TYPE, id, userId, tx);
        await this.ledger.record(
          {
            investorId: payment.investorDistribution.investorId,
            entryDate: new Date(),
            type: InvestorLedgerEntryType.REVERSAL,
            description: 'Distribution Payment cancelled — payment reversed',
            referenceType: 'DISTRIBUTION_PAYMENT',
            referenceId: id,
            creditAmount: Number(payment.amount),
            userId,
          },
          tx,
        );
        await this.distributions.recomputeStatus(
          distribution.profitDistributionId,
          tx,
        );
      }

      await tx.distributionPayment.update({
        where: { id },
        data: { status: DistributionPaymentStatus.CANCELLED },
      });
      await this.activityLog.log(
        ENTITY_TYPE,
        id,
        'CANCELLED',
        'Payment cancelled',
        userId,
      );
      return toPaymentView(await this.findRaw(id, tx));
    });
  }

  async activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }
}
