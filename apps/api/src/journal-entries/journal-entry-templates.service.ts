import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveJournalEntryTemplateDto } from './dto/save-journal-entry-template.dto';

/**
 * "Recurring Journal Templates" (TASK-058) — a saved starting point for a
 * new Manual Journal Entry, applied via "New from Template". Mirrors
 * `ImportMappingTemplatesService`'s exact shape (upsert-by-unique-name,
 * findAll, remove). Deliberately NOT a scheduler — creating an entry from a
 * template is always a manual action, same "prepare architecture, don't
 * implement scheduler" boundary the Import Center's Google Sheets source
 * already drew for itself.
 */
@Injectable()
export class JournalEntryTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.journalEntryTemplate.findMany({
      include: { journal: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async save(dto: SaveJournalEntryTemplateDto, userId?: string) {
    try {
      return await this.prisma.journalEntryTemplate.upsert({
        where: { name: dto.name },
        update: {
          description: dto.description,
          journalId: dto.journalId,
          lines: dto.lines as unknown as Prisma.InputJsonValue,
        },
        create: {
          name: dto.name,
          description: dto.description,
          journalId: dto.journalId,
          lines: dto.lines as unknown as Prisma.InputJsonValue,
          createdBy: userId ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `A journal entry template named "${dto.name}" already exists.`,
        );
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.prisma.journalEntryTemplate.delete({ where: { id } });
  }
}
