import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentSettlementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

const ACCOUNT_INCLUDE = {
  account: { select: { id: true, code: true, name: true } },
  paymentSource: {
    select: {
      id: true,
      name: true,
      code: true,
      feePercentage: true,
      feeFixedAmount: true,
    },
  },
};

@Injectable()
export class PaymentMethodsService extends MasterDataCrudService<PaymentMethod> {
  protected readonly entityType = 'PAYMENT_METHOD';
  protected readonly entityLabel = 'Payment Method';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<PaymentMethod> {
    return this.prisma
      .paymentMethod as unknown as MasterDataDelegate<PaymentMethod>;
  }

  findAll(query: MasterDataQueryDto) {
    return super.findAll(query, {}, { include: ACCOUNT_INCLUDE });
  }

  async findOne(id: string) {
    const entity = await this.prisma.paymentMethod.findFirst({
      where: { id, deletedAt: null },
      include: ACCOUNT_INCLUDE,
    });
    if (!entity) {
      throw new NotFoundException(`Payment Method ${id} not found`);
    }
    return entity;
  }

  async create(dto: CreatePaymentMethodDto, userId?: string) {
    await this.assertPostingAccount(dto.accountId);
    if (dto.paymentSourceId) await this.assertChannel(dto.paymentSourceId);
    const created = await super.create(dto, userId);
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdatePaymentMethodDto, userId?: string) {
    if (dto.accountId) {
      await this.assertPostingAccount(dto.accountId);
      await this.assertAccountChangeAllowed(id, dto.accountId);
    }
    if (dto.paymentSourceId) await this.assertChannel(dto.paymentSourceId);
    const updated = await super.update(id, dto, userId);
    return this.findOne(updated.id);
  }

  /**
   * Claims posted to this method's clearing account and still awaiting
   * provider settlement are settled against the method's CURRENT account;
   * re-pointing it would make them unsettleable (the settlement would
   * credit an account that never received the debit). 409 until they are
   * settled.
   */
  private async assertAccountChangeAllowed(id: string, accountId: string) {
    const current = await this.findOne(id);
    if (current.accountId === accountId) return;
    const open = await this.prisma.payment.count({
      where: {
        paymentMethodId: id,
        deletedAt: null,
        settlementStatus: {
          in: [
            PaymentSettlementStatus.AWAITING_SETTLEMENT,
            PaymentSettlementStatus.PARTIALLY_SETTLED,
          ],
        },
      },
    });
    if (open > 0) {
      throw new ConflictException(
        `"${current.name}" has ${open} posted payment${open === 1 ? '' : 's'} awaiting provider settlement on its current account — settle them (Finance → Payment reconciliation → Awaiting settlement) before changing the linked account.`,
      );
    }
  }

  /**
   * The linked account must be a real, active, leaf/posting Chart of
   * Accounts row (spec section 6) — never a header account (those stop
   * accepting direct postings the moment they get a child, same rule the
   * Posting Engine itself enforces on `JournalEntryLine`), and never
   * auto-created here — the user must create it in Chart of Accounts first.
   */
  private async assertPostingAccount(accountId: string) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!account) {
      throw new BadRequestException(
        'Selected account was not found in the Chart of Accounts.',
      );
    }
    if (!account.allowsPosting) {
      throw new BadRequestException(
        `"${account.name}" is a header account and cannot receive postings — choose a leaf account instead.`,
      );
    }
  }

  /** The channel must be an existing, active Payment Source. */
  private async assertChannel(paymentSourceId: string) {
    const source = await this.prisma.paymentSource.findFirst({
      where: { id: paymentSourceId, deletedAt: null },
      select: { name: true, isActive: true },
    });
    if (!source) {
      throw new BadRequestException(
        'Selected channel was not found — choose an existing payment channel.',
      );
    }
    if (!source.isActive) {
      throw new BadRequestException(
        `Channel "${source.name}" is inactive — activate it or choose another channel.`,
      );
    }
  }
}
