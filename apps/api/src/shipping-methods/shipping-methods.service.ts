import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';

@Injectable()
export class ShippingMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateShippingMethodDto) {
    return this.prisma.shippingMethod.create({ data: dto });
  }

  findAll() {
    return this.prisma.shippingMethod.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const shippingMethod = await this.prisma.shippingMethod.findFirst({
      where: { id, deletedAt: null },
    });
    if (!shippingMethod) {
      throw new NotFoundException(`Shipping method ${id} not found`);
    }
    return shippingMethod;
  }

  async update(id: string, dto: UpdateShippingMethodDto) {
    await this.findOne(id);
    return this.prisma.shippingMethod.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.shippingMethod.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
