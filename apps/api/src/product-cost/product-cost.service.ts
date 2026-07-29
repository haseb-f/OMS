import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import {
  ProductActivityService,
  ProductActivityType,
} from '../products/activities/product-activity.service';
import { RecordProductCostDto } from './dto/record-product-cost.dto';

@Injectable()
export class ProductCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productsService: ProductsService,
    private readonly productActivityService: ProductActivityService,
  ) {}

  /**
   * Records a caller-supplied cost value: creates the append-only history
   * entry, maintains the single active snapshot, mirrors it onto
   * Product.currentCost/lastCostUpdate, and logs the timeline. No FIFO/LIFO/
   * Average/allocation calculation happens here — "Future purchasing will
   * update it" via this same method once that module exists.
   */
  async recordCost(productId: string, dto: RecordProductCostDto) {
    const product = await this.assertActiveProduct(productId);

    return this.prisma.$transaction(async (tx) => {
      const existingSnapshot = await tx.productCostSnapshot.findUnique({
        where: { productId },
      });

      await tx.productCostHistory.create({
        data: {
          productId,
          previousCost: existingSnapshot?.cost ?? null,
          newCost: dto.cost,
          reason: dto.reason,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
        },
      });

      const snapshot = existingSnapshot
        ? await tx.productCostSnapshot.update({
            where: { productId },
            data: { cost: dto.cost },
          })
        : await tx.productCostSnapshot.create({
            data: { productId, cost: dto.cost },
          });

      await tx.product.update({
        where: { id: productId },
        data: { currentCost: dto.cost, lastCostUpdate: new Date() },
      });

      await this.productActivityService.log(
        productId,
        ProductActivityType.PRODUCT_COST_UPDATED,
        `Cost of ${product.sku} updated to ${dto.cost}`,
        undefined,
        tx,
      );

      if (!existingSnapshot) {
        await this.productActivityService.log(
          productId,
          ProductActivityType.SNAPSHOT_CREATED,
          `Cost snapshot created for ${product.sku}`,
          undefined,
          tx,
        );
      }

      return snapshot;
    });
  }

  async getCurrentCost(productId: string) {
    await this.productsService.findOne(productId);
    const snapshot = await this.prisma.productCostSnapshot.findUnique({
      where: { productId },
    });
    if (!snapshot) {
      throw new NotFoundException(`No cost recorded for product ${productId}`);
    }
    return snapshot;
  }

  async getCostHistory(productId: string) {
    await this.productsService.findOne(productId);
    return this.prisma.productCostHistory.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** "Reject: ... Inactive products. Deleted products." */
  private async assertActiveProduct(productId: string) {
    const product = await this.productsService.findOne(productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is inactive.');
    }
    return product;
  }
}
