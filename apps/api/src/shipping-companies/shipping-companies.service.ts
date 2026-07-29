import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingCompanyDto } from './dto/create-shipping-company.dto';
import { UpdateShippingCompanyDto } from './dto/update-shipping-company.dto';

@Injectable()
export class ShippingCompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateShippingCompanyDto) {
    return this.prisma.shippingCompany.create({ data: dto });
  }

  findAll() {
    return this.prisma.shippingCompany.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const shippingCompany = await this.prisma.shippingCompany.findFirst({
      where: { id, deletedAt: null },
    });
    if (!shippingCompany) {
      throw new NotFoundException(`Shipping company ${id} not found`);
    }
    return shippingCompany;
  }

  async update(id: string, dto: UpdateShippingCompanyDto) {
    await this.findOne(id);
    return this.prisma.shippingCompany.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.shippingCompany.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
