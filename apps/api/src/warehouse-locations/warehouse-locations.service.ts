import { Injectable } from '@nestjs/common';
import { WarehouseLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';

const DOCUMENT_TYPE = 'WAREHOUSE_LOCATION';

@Injectable()
export class WarehouseLocationsService extends MasterDataCrudService<WarehouseLocation> {
  protected readonly entityType = 'WAREHOUSE_LOCATION';
  protected readonly entityLabel = 'Warehouse Location';
  protected readonly searchFields = ['code', 'name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
    private readonly numberingEngine: NumberingEngineService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<WarehouseLocation> {
    return this.prisma
      .warehouseLocation as unknown as MasterDataDelegate<WarehouseLocation>;
  }

  /** Code is never typed by hand — minted the same way Warehouse.code is. */
  async create(dto: CreateWarehouseLocationDto, userId?: string) {
    const code = await this.numberingEngine.generateNumber(DOCUMENT_TYPE);
    return super.create({ ...dto, code }, userId);
  }

  /**
   * Every location for one warehouse, unpaginated — the tree view needs the
   * whole set client-side to assemble parent/child, unlike the generic
   * paginated `findAll` every other Master Data list uses.
   */
  findByWarehouse(warehouseId: string, includeArchived = false) {
    return this.prisma.warehouseLocation.findMany({
      where: {
        warehouseId,
        deletedAt: includeArchived ? undefined : null,
      },
      orderBy: { name: 'asc' },
    });
  }
}
