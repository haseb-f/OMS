import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveMappingTemplateDto } from './dto/save-mapping-template.dto';

/** "Save Mapping Template" (Part 4) — a reusable column mapping per Import Type, so a recurring import never needs re-mapping. */
@Injectable()
export class ImportMappingTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(importType: string) {
    return this.prisma.importMappingTemplate.findMany({
      where: { importType },
      orderBy: { name: 'asc' },
    });
  }

  async save(dto: SaveMappingTemplateDto, userId?: string) {
    try {
      return await this.prisma.importMappingTemplate.upsert({
        where: {
          importType_name: { importType: dto.importType, name: dto.name },
        },
        update: { columnMapping: dto.columnMapping },
        create: {
          importType: dto.importType,
          name: dto.name,
          columnMapping: dto.columnMapping,
          createdBy: userId ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `A mapping template named "${dto.name}" already exists for this Import Type.`,
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.prisma.importMappingTemplate.delete({ where: { id } });
  }
}
