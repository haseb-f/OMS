import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductBrandDto } from './dto/create-product-brand.dto';
import { UpdateProductBrandDto } from './dto/update-product-brand.dto';

@Injectable()
export class ProductBrandsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProductBrandDto) {
    return this.prisma.productBrand.create({ data: dto });
  }

  findAll() {
    return this.prisma.productBrand.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const productBrand = await this.prisma.productBrand.findFirst({
      where: { id, deletedAt: null },
    });
    if (!productBrand) {
      throw new NotFoundException(`Product brand ${id} not found`);
    }
    return productBrand;
  }

  async update(id: string, dto: UpdateProductBrandDto) {
    await this.findOne(id);
    return this.prisma.productBrand.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.productBrand.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
