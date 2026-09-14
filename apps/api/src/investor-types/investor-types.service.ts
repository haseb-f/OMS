import { BadRequestException, Injectable } from '@nestjs/common';
import { InvestorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateInvestorTypeDto } from './dto/create-investor-type.dto';

const DOCUMENT_TYPE = 'INVESTOR_TYPE';

/**
 * Investor Engine Milestone 4, Part A — Investor Type as real, configurable
 * Master Data (never a hardcoded enum). Same shape/convention as
 * CustomerClassificationsService: `assertAssignable` is the one backend gate
 * every write path that assigns a type to an Investor must call, so
 * archived/inactive types can never be newly assigned even if a caller
 * bypasses the frontend (mission Part P #70).
 */
@Injectable()
export class InvestorTypesService extends MasterDataCrudService<InvestorType> {
  protected readonly entityType = 'INVESTOR_TYPE';
  protected readonly entityLabel = 'Investor Type';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'description'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<InvestorType> {
    return this.prisma
      .investorType as unknown as MasterDataDelegate<InvestorType>;
  }

  async create(dto: CreateInvestorTypeDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  async findByIdIncludingArchived(id: string): Promise<InvestorType> {
    const row = await this.prisma.investorType.findFirst({ where: { id } });
    if (!row) {
      throw new BadRequestException(`Investor type ${id} not found.`);
    }
    return row;
  }

  /** Called by InvestorsService on create/update whenever `investorTypeId` is set. */
  async assertAssignable(id: string): Promise<InvestorType> {
    const row = await this.findByIdIncludingArchived(id);
    if (row.deletedAt || row.isActive === false) {
      throw new BadRequestException(
        'Archived or inactive Investor Types cannot be assigned to new records.',
      );
    }
    return row;
  }
}
