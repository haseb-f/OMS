import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateChartOfAccountDto) {
    return this.prisma.chartOfAccount.create({ data: dto });
  }

  findAll() {
    return this.prisma.chartOfAccount.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const chartOfAccount = await this.prisma.chartOfAccount.findFirst({
      where: { id, deletedAt: null },
    });
    if (!chartOfAccount) {
      throw new NotFoundException(`Chart of account ${id} not found`);
    }
    return chartOfAccount;
  }

  async update(id: string, dto: UpdateChartOfAccountDto) {
    await this.findOne(id);
    return this.prisma.chartOfAccount.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.chartOfAccount.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
