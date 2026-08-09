import { Injectable } from '@nestjs/common';
import { ProductCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
} from '../master-data/master-data-crud.service';

@Injectable()
export class ProductCategoriesService extends MasterDataCrudService<ProductCategory> {
  protected readonly entityType = 'PRODUCT_CATEGORY';
  protected readonly entityLabel = 'Category';
  protected readonly searchFields = ['name', 'description'];

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<ProductCategory> {
    return this.prisma
      .productCategory as unknown as MasterDataDelegate<ProductCategory>;
  }
}
