import { Injectable } from '@nestjs/common';
import { Warehouse } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';

const DOCUMENT_TYPE = 'WAREHOUSE';

@Injectable()
export class WarehousesService extends MasterDataCrudService<Warehouse> {
  protected readonly entityType = 'WAREHOUSE';
  protected readonly entityLabel = 'Warehouse';
  protected readonly searchFields = ['code', 'name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<Warehouse> {
    return this.prisma.warehouse as unknown as MasterDataDelegate<Warehouse>;
  }

  /** Code is never typed by hand (TASK-030) — minted the same way Product.sku is. */
  async create(dto: CreateWarehouseDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  /** List needs the manager's name and default analytic account's name, not just their ids. */
  findAll(query: MasterDataQueryDto) {
    return super.findAll(
      query,
      {},
      { include: { manager: true, defaultAnalyticAccount: true } },
    );
  }
}
