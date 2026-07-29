import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCostCenterDto) {
    return this.prisma.costCenter.create({ data: dto });
  }

  findAll() {
    return this.prisma.costCenter.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({
      where: { id, deletedAt: null },
    });
    if (!costCenter) {
      throw new NotFoundException(`Cost center ${id} not found`);
    }
    return costCenter;
  }

  async update(id: string, dto: UpdateCostCenterDto) {
    await this.findOne(id);
    return this.prisma.costCenter.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.costCenter.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
