import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNumberSeriesDto } from './dto/create-number-series.dto';
import { UpdateNumberSeriesDto } from './dto/update-number-series.dto';

/**
 * Admin configuration for the Numbering Engine (TASK-025 Part 5) — every
 * document type's series lives here as a plain data row, never a code
 * change. Not built on `MasterDataCrudService`: series rows are system
 * configuration (toggled `active`, never archived/restored) rather than
 * reference data with an activity timeline.
 */
@Injectable()
export class NumberSeriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.numberSeries.findMany({ orderBy: { label: 'asc' } });
  }

  async findOne(id: string) {
    const series = await this.prisma.numberSeries.findUnique({ where: { id } });
    if (!series) {
      throw new NotFoundException(`Number series ${id} not found`);
    }
    return series;
  }

  async create(dto: CreateNumberSeriesDto, userId?: string) {
    try {
      return await this.prisma.numberSeries.create({
        data: { ...dto, createdBy: userId ?? null, updatedBy: userId ?? null },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: UpdateNumberSeriesDto, userId?: string) {
    await this.findOne(id);
    try {
      return await this.prisma.numberSeries.update({
        where: { id },
        data: { ...dto, updatedBy: userId ?? null },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new BadRequestException(
        'A number series for this document type already exists.',
      );
    }
    return error as Error;
  }
}
