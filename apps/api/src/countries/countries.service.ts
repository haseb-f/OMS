import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCountryDto } from './dto/create-country.dto';
import { UpdateCountryDto } from './dto/update-country.dto';

@Injectable()
export class CountriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCountryDto) {
    return this.prisma.country.create({ data: dto });
  }

  findAll() {
    return this.prisma.country.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const country = await this.prisma.country.findFirst({
      where: { id, deletedAt: null },
    });
    if (!country) {
      throw new NotFoundException(`Country ${id} not found`);
    }
    return country;
  }

  async update(id: string, dto: UpdateCountryDto) {
    await this.findOne(id);
    return this.prisma.country.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.country.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
