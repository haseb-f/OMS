import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { CreateProductVariantDto } from '../dto/create-product-variant.dto';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto';

/**
 * Product Variants (TASK-027) — generic attribute bag, one Numbering Engine
 * series (`PRODUCT`) shared with the parent product for the variant's own
 * SKU, since a variant is still a distinct sellable/purchasable unit.
 */
@Injectable()
export class ProductVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  findAllForProduct(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    productId: string,
    dto: CreateProductVariantDto,
    userId?: string,
  ) {
    const sku = await this.numberingEngine.generateNumber('PRODUCT');
    try {
      return await this.prisma.productVariant.create({
        data: {
          productId,
          sku,
          attributes: dto.attributes,
          priceAdjustment: dto.priceAdjustment,
          active: dto.active ?? true,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: UpdateProductVariantDto, userId?: string) {
    await this.findOne(id);
    try {
      return await this.prisma.productVariant.update({
        where: { id },
        data: {
          attributes: dto.attributes,
          priceAdjustment: dto.priceAdjustment,
          active: dto.active,
          updatedBy: userId ?? null,
        },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.productVariant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async findOne(id: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, deletedAt: null },
    });
    if (!variant) {
      throw new NotFoundException(`Product variant ${id} not found`);
    }
    return variant;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new BadRequestException('Variant SKU must be unique.');
    }
    return error as Error;
  }
}
