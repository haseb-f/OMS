import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { businessDateOf } from '../common/time/business-date';
import {
  PARTNER_PROFIT_PAYMENT,
  assertAccountKind,
  resolvePartnerProfitAccounts,
} from './company-partner-accounts';
import {
  CreatePartnerPaymentDto,
  ReversePartnerPaymentDto,
} from './dto/company-partners.dto';
import {
  CompanyPartnersService,
  parseBusinessDate,
} from './company-partners.service';
import { PartnerBalancesService } from './partner-balances.service';
import { dateValue, isoDate } from './partner-profit-calculator';

const PAYMENT_ENTITY = 'PARTNER_PAYMENT';
const DOCUMENT_TYPE = 'COMPANY_PARTNER_PAYMENT';

const INCLUDE = {
  partner: { select: { name: true } },
  financialAccount: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PartnerPaymentInclude;

type PaymentRow = Prisma.PartnerPaymentGetPayload<{ include: typeof INCLUDE }>;

function paymentView(row: PaymentRow) {
  return {
    id: row.id,
    paymentNumber: row.paymentNumber,
    partnerId: row.partnerId,
    partnerName: row.partner.name,
    amount: Number(row.amount),
    date: isoDate(row.date),
    financialAccount: row.financialAccount,
    reference: row.reference,
    notes: row.notes,
    journalEntryId: row.journalEntryId,
    reversedAt: row.reversedAt,
    reversalReason: row.reversalReason,
    reversalJournalEntryId: row.reversalJournalEntryId,
    createdAt: row.createdAt,
  };
}

/**
 * R14 W5 (spec-5 §5) — partner profit payments / withdrawals. Posted at once:
 * Dr partner profit payable (Partner) / Cr the chosen cash or bank account.
 * A payment larger than the payable is allowed and shows as an advance
 * (debit balance). Corrections are reversals, never edits.
 */
@Injectable()
export class PartnerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
    private readonly numbering: NumberingEngineService,
    private readonly activityLog: MasterDataActivityLogService,
    private readonly partners: CompanyPartnersService,
    private readonly balances: PartnerBalancesService,
  ) {}

  async list(partnerId?: string) {
    const rows = await this.prisma.partnerPayment.findMany({
      where: { partnerId },
      include: INCLUDE,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(paymentView);
  }

  private async requirePayment(id: string) {
    const row = await this.prisma.partnerPayment.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundException(`Partner payment ${id} not found`);
    return row;
  }

  async create(dto: CreatePartnerPaymentDto, userId?: string) {
    await this.partners.requireProfile(dto.partnerId);
    const date = parseBusinessDate(dto.date, 'date');
    await resolvePartnerProfitAccounts(this.accountMapping, this.prisma);
    await assertAccountKind(
      this.prisma,
      dto.financialAccountId,
      AccountType.ASSET,
      'Payment account',
      'Choose the cash or bank account the money is paid from.',
    );
    const id = await this.prisma.$transaction(async (tx) => {
      const paymentNumber = await this.numbering.generateNumber(
        DOCUMENT_TYPE,
        undefined,
        tx,
      );
      const payment = await tx.partnerPayment.create({
        data: {
          paymentNumber,
          partnerId: dto.partnerId,
          amount: dto.amount,
          date: dateValue(date),
          financialAccountId: dto.financialAccountId,
          reference: dto.reference || null,
          notes: dto.notes || null,
          createdBy: userId ?? null,
        },
      });
      const entry = await this.postingEngine.post(
        PARTNER_PROFIT_PAYMENT,
        payment.id,
        userId,
        tx,
      );
      if (entry) {
        await tx.partnerPayment.update({
          where: { id: payment.id },
          data: { journalEntryId: entry.id },
        });
      }
      return payment.id;
    });
    await this.activityLog.log(
      PAYMENT_ENTITY,
      id,
      'CREATED',
      `Partner payment of ${dto.amount} recorded`,
      userId,
    );
    return this.withBalance(await this.requirePayment(id));
  }

  /** Reversal posts the mirror entry today; the payment stays on record as reversed. */
  async reverse(id: string, dto: ReversePartnerPaymentDto, userId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partner_payments WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await tx.partnerPayment.findUnique({ where: { id } });
      if (!payment)
        throw new NotFoundException(`Partner payment ${id} not found`);
      if (payment.reversedAt) {
        throw new ConflictException({
          code: 'PARTNER_PAYMENT_REVERSED',
          message: `Payment ${payment.paymentNumber} is already reversed.`,
        });
      }
      const reversal = await this.postingEngine.reverse(
        PARTNER_PROFIT_PAYMENT,
        id,
        userId,
        tx,
        { entryDate: dateValue(businessDateOf(new Date())) },
      );
      await tx.partnerPayment.update({
        where: { id },
        data: {
          reversedAt: new Date(),
          reversedBy: userId ?? null,
          reversalReason: dto.reason,
          reversalJournalEntryId: reversal?.id ?? null,
        },
      });
    });
    await this.activityLog.log(
      PAYMENT_ENTITY,
      id,
      'REVERSED',
      `Partner payment reversed: ${dto.reason}`,
      userId,
    );
    return this.withBalance(await this.requirePayment(id));
  }

  private async withBalance(row: PaymentRow) {
    const balance = (await this.balances.forPartners([row.partnerId])).get(
      row.partnerId,
    )!;
    return { ...paymentView(row), balance };
  }
}
