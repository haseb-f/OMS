import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCurrencyDto } from './dto/create-currency.dto';
import { UpdateCurrencyDto } from './dto/update-currency.dto';

@Injectable()
export class CurrenciesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCurrencyDto) {
    return this.prisma.currency.create({ data: dto });
  }

  findAll() {
    return this.prisma.currency.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const currency = await this.prisma.currency.findFirst({
      where: { id, deletedAt: null },
    });
    if (!currency) {
      throw new NotFoundException(`Currency ${id} not found`);
    }
    return currency;
  }

  async update(id: string, dto: UpdateCurrencyDto) {
    await this.findOne(id);
    return this.prisma.currency.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.currency.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
