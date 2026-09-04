import { BadRequestException, Injectable } from '@nestjs/common';
import { CustomerClassification } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateCustomerClassificationDto } from './dto/create-customer-classification.dto';

const DOCUMENT_TYPE = 'CUSTOMER_CLASSIFICATION';

@Injectable()
export class CustomerClassificationsService extends MasterDataCrudService<CustomerClassification> {
  protected readonly entityType = 'CUSTOMER_CLASSIFICATION';
  protected readonly entityLabel = 'Customer Classification';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<CustomerClassification> {
    return this.prisma
      .customerClassification as unknown as MasterDataDelegate<CustomerClassification>;
  }

  async create(dto: CreateCustomerClassificationDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create(
      { ...dto, color: dto.color ?? 'neutral', code },
      userId,
    );
  }

  async findByIdIncludingArchived(id: string): Promise<CustomerClassification> {
    const row = await this.prisma.customerClassification.findFirst({
      where: { id },
    });
    if (!row) {
      throw new BadRequestException(`Customer classification ${id} not found.`);
    }
    return row;
  }

  async assertAssignable(id: string): Promise<CustomerClassification> {
    const row = await this.findByIdIncludingArchived(id);
    if (row.deletedAt || row.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive Customer Classifications cannot be assigned to new records.',
      );
    }
    return row;
  }
}
