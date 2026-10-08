import { ConflictException, Injectable } from '@nestjs/common';
import { Warehouse, WarehouseRole } from '@prisma/client';
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

  /**
   * R15 (D15-4) — the system warehouses (goods in transit, damaged goods) carry
   * the store-order stock lifecycle: they stay active, are never archived and
   * never become the default warehouse. Their name / description may change.
   */
  async update(id: string, dto: object, userId?: string) {
    const changes = dto as { isActive?: boolean; isDefault?: boolean };
    if (changes.isActive === false || changes.isDefault === true) {
      await this.assertStockRole(id);
    }
    return super.update(id, dto, userId);
  }

  async archive(id: string, userId?: string) {
    await this.assertStockRole(id);
    return super.archive(id, userId);
  }

  private async assertStockRole(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
      select: { role: true, code: true },
    });
    if (warehouse && warehouse.role !== WarehouseRole.STOCK) {
      throw new ConflictException({
        code: 'SYSTEM_WAREHOUSE',
        message: `${warehouse.code} مستودع نظام (بضاعة في الطريق / تالفة) — لا يُعطَّل ولا يُؤرشف ولا يصبح افتراضيًا — ${warehouse.code} is a system warehouse (goods in transit / damaged): it cannot be deactivated, archived or made the default.`,
      });
    }
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
