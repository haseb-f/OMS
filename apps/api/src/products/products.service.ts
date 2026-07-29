import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProductActivityService,
  ProductActivityType,
} from './activities/product-activity.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';

/** Product Flags (ADR-0012) — type-based defaults, overridable per product. */
const DEFAULT_FLAGS_BY_TYPE: Record<
  ProductType,
  { isPurchasable: boolean; isSellable: boolean; isInventoryItem: boolean }
> = {
  PHYSICAL: { isPurchasable: true, isSellable: true, isInventoryItem: true },
  SERVICE: { isPurchasable: false, isSellable: true, isInventoryItem: false },
  DIGITAL: { isPurchasable: false, isSellable: true, isInventoryItem: false },
  BUNDLE: { isPurchasable: false, isSellable: true, isInventoryItem: false },
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ProductActivityService,
  ) {}

  async create(dto: CreateProductDto) {
    const defaults = DEFAULT_FLAGS_BY_TYPE[dto.type];
    const isPurchasable = dto.isPurchasable ?? defaults.isPurchasable;
    const isSellable = dto.isSellable ?? defaults.isSellable;
    const isInventoryItem = dto.isInventoryItem ?? defaults.isInventoryItem;

    if (isInventoryItem) {
      this.assertDimensionsPresent(
        dto.weight,
        dto.width,
        dto.height,
        dto.length,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: { ...dto, isPurchasable, isSellable, isInventoryItem },
        });
        await this.activityService.log(
          product.id,
          ProductActivityType.PRODUCT_CREATED,
          `Product ${product.sku} created`,
          undefined,
          tx,
        );
        return product;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException('SKU must be unique.');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Invalid category, brand, or unit reference.',
          );
        }
      }
      throw error;
    }
  }

  /**
   * Filtering by Category/Brand/Status/Type; search by SKU/Name/Barcode/
   * InternalName/DisplayName/SearchKeywords.
   */
  findAll(query: FindProductsQueryDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      categoryId: query.categoryId,
      brandId: query.brandId,
      status: query.status,
      type: query.type,
    };

    if (query.search) {
      where.OR = [
        { sku: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
        { internalName: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { searchKeywords: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.product.findMany({ where });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.findOne(id);

    const resolvedIsInventoryItem =
      dto.isInventoryItem ?? existing.isInventoryItem;
    if (resolvedIsInventoryItem) {
      this.assertDimensionsPresent(
        dto.weight !== undefined ? dto.weight : existing.weight,
        dto.width !== undefined ? dto.width : existing.width,
        dto.height !== undefined ? dto.height : existing.height,
        dto.length !== undefined ? dto.length : existing.length,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.update({ where: { id }, data: dto });
        await this.activityService.log(
          id,
          ProductActivityType.PRODUCT_UPDATED,
          `Product ${product.sku} updated`,
          undefined,
          tx,
        );
        return product;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException('SKU must be unique.');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Invalid category, brand, or unit reference.',
          );
        }
      }
      throw error;
    }
  }

  /** Soft delete only. */
  async remove(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await this.activityService.log(
        id,
        ProductActivityType.PRODUCT_ARCHIVED,
        `Product ${existing.sku} archived`,
        undefined,
        tx,
      );
      return product;
    });
  }

  /** "If isInventoryItem=true, all four values become mandatory." */
  private assertDimensionsPresent(
    weight: unknown,
    width: unknown,
    height: unknown,
    length: unknown,
  ) {
    if (
      weight === null ||
      weight === undefined ||
      width === null ||
      width === undefined ||
      height === null ||
      height === undefined ||
      length === null ||
      length === undefined
    ) {
      throw new BadRequestException(
        'weight, width, height, and length are required when isInventoryItem is true.',
      );
    }
  }
}
