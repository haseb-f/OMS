import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
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
    const created = await super.create(dto, userId);
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdatePaymentMethodDto, userId?: string) {
    if (dto.accountId) await this.assertPostingAccount(dto.accountId);
    const updated = await super.update(id, dto, userId);
    return this.findOne(updated.id);
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
}
