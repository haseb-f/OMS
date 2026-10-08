import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveMappingTemplateDto } from './dto/save-mapping-template.dto';
import type { ImportActor } from './import-type.interface';

/**
 * The stored type of a template: company templates are shared by the
 * company's importers of that type; an agent's templates are private to that
 * agent (R15) — no agent ever sees a company or another agent's template.
 */
function templateScope(importType: string, actor?: ImportActor): string {
  return actor?.agent
    ? `${importType}@agent:${actor.agent.agentId}`
    : importType;
}

/** "Save Mapping Template" (Part 4) — a reusable column mapping per Import Type, so a recurring import never needs re-mapping. */
@Injectable()
export class ImportMappingTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(importType: string, actor?: ImportActor) {
    return this.prisma.importMappingTemplate.findMany({
      where: { importType: templateScope(importType, actor) },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Saves (or replaces by name) a template. An importer replaces only a
   * template they created; `manage` (company administrator) replaces any
   * company template (R15 review L2). System callers (no actor) keep the
   * plain upsert.
   */
  async save(
    dto: SaveMappingTemplateDto,
    userId?: string,
    actor?: ImportActor,
    manage = false,
  ) {
    const importType = templateScope(dto.importType, actor);
    if (actor && !manage) {
      const existing = await this.prisma.importMappingTemplate.findUnique({
        where: { importType_name: { importType, name: dto.name } },
        select: { createdBy: true },
      });
      if (existing && existing.createdBy !== actor.userId) {
        throw new ForbiddenException({
          code: 'IMPORT_TEMPLATE_NOT_YOURS',
          message: `«${dto.name}» محفوظ باسم مستخدم آخر — اختر اسمًا آخر — The template "${dto.name}" belongs to another user; save it under another name.`,
        });
      }
    }
    try {
      return await this.prisma.importMappingTemplate.upsert({
        where: { importType_name: { importType, name: dto.name } },
        update: { columnMapping: dto.columnMapping },
        create: {
          importType,
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

  /** The stored template (for the caller's access check before `remove`). */
  async findOne(id: string) {
    const template = await this.prisma.importMappingTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException(`Mapping template ${id} not found`);
    }
    return template;
  }

  /**
   * R15 — a one-time importer removes only their own templates of their own
   * scope; `manage` (company administrator) removes any company template.
   */
  async remove(id: string, actor?: ImportActor, manage = false) {
    const template = await this.findOne(id);
    if (actor) {
      const [baseType] = template.importType.split('@');
      const inScope = template.importType === templateScope(baseType, actor);
      if (!inScope || (!manage && template.createdBy !== actor.userId)) {
        throw new NotFoundException(`Mapping template ${id} not found`);
      }
    }
    await this.prisma.importMappingTemplate.delete({ where: { id } });
  }
}
