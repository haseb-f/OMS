import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductCategory } from '@prisma/client';
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

  /** A default unit / tax / account id that matches no row is a clear 400, not an unhandled FK error. */
  protected mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      return new BadRequestException(
        'Invalid default unit, default tax, or account reference.',
      );
    }
    return super.mapError(error);
  }

  protected get delegate(): MasterDataDelegate<ProductCategory> {
    return this.prisma
      .productCategory as unknown as MasterDataDelegate<ProductCategory>;
  }
}
