import { Injectable } from '@nestjs/common';
import { PaymentTerm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreatePaymentTermDto } from './dto/create-payment-term.dto';

const DOCUMENT_TYPE = 'PAYMENT_TERM';

@Injectable()
export class PaymentTermsService extends MasterDataCrudService<PaymentTerm> {
  protected readonly entityType = 'PAYMENT_TERM';
  protected readonly entityLabel = 'Payment Term';
  protected readonly searchFields = ['code', 'name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<PaymentTerm> {
    return this.prisma
      .paymentTerm as unknown as MasterDataDelegate<PaymentTerm>;
  }

  /** Code is never typed by hand — minted the same way Warehouse.code is. */
  async create(dto: CreatePaymentTermDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }
}
