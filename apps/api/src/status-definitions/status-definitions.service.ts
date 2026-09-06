import { BadRequestException, Injectable } from '@nestjs/common';
import { StatusDefinition, WorkflowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  MasterDataCrudService,
  MasterDataDelegate,
  MasterDataListResult,
} from '../master-data/master-data-crud.service';
import { uniqueFieldFromPrismaError } from '../common/errors/prisma-unique-field';
import {
  isProtectedStatusCode,
  isWorkflowStatusColor,
} from '../workflow/workflow.catalog';
import { CreateStatusDefinitionDto } from './dto/create-status-definition.dto';
import { UpdateStatusDefinitionDto } from './dto/update-status-definition.dto';
import { FindStatusDefinitionsQueryDto } from './dto/find-status-definitions-query.dto';

@Injectable()
export class StatusDefinitionsService extends MasterDataCrudService<StatusDefinition> {
  protected readonly entityType = 'STATUS_DEFINITION';
  protected readonly entityLabel = 'Workflow Status';
  protected readonly searchFields = ['name', 'nameEn', 'code'];
  protected readonly defaultSortField = 'sortOrder';

  constructor(
    prisma: PrismaService,
    activityLog: MasterDataActivityLogService,
  ) {
    super(prisma, activityLog);
  }

  protected get delegate(): MasterDataDelegate<StatusDefinition> {
    return this.prisma
      .statusDefinition as unknown as MasterDataDelegate<StatusDefinition>;
  }

  findAll(
    query: FindStatusDefinitionsQueryDto,
  ): Promise<MasterDataListResult<StatusDefinition>> {
    const extraWhere = query.workflowType
      ? { workflowType: query.workflowType }
      : {};
    return super.findAll(query, extraWhere);
  }

  async findByWorkflow(workflowType: WorkflowType, includeArchived = false) {
    return this.prisma.statusDefinition.findMany({
      where: {
        workflowType,
        deletedAt: includeArchived ? undefined : null,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findDefault(workflowType: WorkflowType) {
    return this.prisma.statusDefinition.findFirst({
      where: { workflowType, isDefault: true, deletedAt: null },
    });
  }

  async findByCode(workflowType: WorkflowType, code: string) {
    return this.prisma.statusDefinition.findFirst({
      where: { workflowType, code, deletedAt: null },
    });
  }

  private validateColor(color: string | undefined): string {
    const resolved = color ?? 'neutral';
    if (!isWorkflowStatusColor(resolved)) {
      throw new BadRequestException({
        code: 'INVALID_COLOR',
        message: 'Status color is not a valid token.',
      });
    }
    return resolved;
  }

  async create(dto: CreateStatusDefinitionDto, userId?: string) {
    const color = this.validateColor(dto.color);
    try {
      const created = await this.delegate.create({
        data: {
          workflowType: dto.workflowType,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          nameEn: dto.nameEn?.trim() ?? null,
          color,
          sortOrder: dto.sortOrder ?? 0,
          isSystem: false,
          isFinal: dto.isFinal ?? false,
          isDefault: dto.isDefault ?? false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.activityLog.log(
        this.entityType,
        created.id,
        'CREATED',
        `${this.entityLabel} created`,
        userId,
      );
      return created;
    } catch (error) {
      const field = uniqueFieldFromPrismaError(error);
      if (field) {
        throw new BadRequestException({
          code: 'DUPLICATE_FIELD',
          message: `Duplicate ${field}.`,
          fields: [{ field, constraints: ['unique'] }],
        });
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateStatusDefinitionDto, userId?: string) {
    const existing = await this.findOne(id);
    const color =
      dto.color !== undefined ? this.validateColor(dto.color) : undefined;
    if (existing.isSystem && dto.isFinal === false) {
      throw new BadRequestException(
        'Cannot remove final flag from system status.',
      );
    }
    const updated = await super.update(
      id,
      {
        ...dto,
        ...(color !== undefined ? { color } : {}),
      },
      userId,
    );
    return updated;
  }

  /**
   * Archive is data-driven, not a blanket `isSystem` block: a seeded status
   * that nothing currently uses (e.g. a superseded duplicate) is safe to
   * retire, while a status a live business flow still resolves by code never
   * is — see PROTECTED_STATUS_CODES. Either way this is a soft delete
   * (deletedAt), reversible via restore(); it never touches history.
   */
  async archive(id: string, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.isDefault) {
      throw new BadRequestException(
        'Cannot archive the default status for this workflow — set another status as default first.',
      );
    }
    if (isProtectedStatusCode(existing.workflowType, existing.code)) {
      throw new BadRequestException(
        `"${existing.name}" is required by core business logic for the ${existing.workflowType} workflow and cannot be archived.`,
      );
    }
    const activeReferences = await this.countActiveReferences(
      existing.workflowType,
      id,
    );
    if (activeReferences > 0) {
      throw new BadRequestException(
        `${activeReferences} active record(s) currently use "${existing.name}" — move them to another status before archiving.`,
      );
    }

    const archived = await super.archive(id, userId);
    await this.prisma.workflowTransition.updateMany({
      where: {
        OR: [{ fromStatusId: id }, { toStatusId: id }],
        isActive: true,
        deletedAt: null,
      },
      data: { isActive: false, updatedBy: userId },
    });
    return archived;
  }

  /** How many live rows currently sit on this status, across every entity that references it. */
  private async countActiveReferences(
    workflowType: WorkflowType,
    statusId: string,
  ): Promise<number> {
    switch (workflowType) {
      case WorkflowType.LEAD:
        return this.prisma.lead.count({
          where: { statusId, deletedAt: null },
        });
      case WorkflowType.PAYMENT:
        return this.prisma.storeOrder.count({
          where: { paymentStatusId: statusId, deletedAt: null },
        });
      case WorkflowType.FULFILLMENT:
        return this.prisma.storeOrder.count({
          where: { fulfillmentStatusId: statusId, deletedAt: null },
        });
      case WorkflowType.MATCHING:
        return this.prisma.bankTransaction.count({
          where: { matchStatusId: statusId, deletedAt: null },
        });
      default:
        return 0;
    }
  }
}
