import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProductCategoryDto) {
    return this.prisma.productCategory.create({ data: dto });
  }

  findAll() {
    return this.prisma.productCategory.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const productCategory = await this.prisma.productCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!productCategory) {
      throw new NotFoundException(`Product category ${id} not found`);
    }
    return productCategory;
  }

  async update(id: string, dto: UpdateProductCategoryDto) {
    await this.findOne(id);
    return this.prisma.productCategory.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.productCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
