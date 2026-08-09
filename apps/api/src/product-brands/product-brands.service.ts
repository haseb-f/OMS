import { Injectable } from '@nestjs/common';
import { ProductBrand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class ProductBrandsService extends MasterDataCrudService<ProductBrand> {
  protected readonly entityType = 'PRODUCT_BRAND';
  protected readonly entityLabel = 'Brand';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ProductBrand> {
    return this.prisma
      .productBrand as unknown as MasterDataDelegate<ProductBrand>;
  }
}
