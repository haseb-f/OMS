import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One shared append-only timeline for every Master Data entity (Companies,
 * Branches, Warehouses, Taxes, ...) — same append-only shape as
 * InventoryMovement/SalesOrderStatusHistory, just keyed by entityType +
 * entityId instead of a dedicated table per entity. Reference-data rows are
 * flat and short-lived enough in their activity vocabulary (Created/Updated/
 * Archived/Restored) that a dedicated table per entity would be pure
 * duplication.
 */
@Injectable()
export class MasterDataActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    entityType: string,
    entityId: string,
    type: string,
    description: string,
    userId?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.masterDataActivityLog.create({
      data: {
        entityType,
        entityId,
        type,
        description,
        createdBy: userId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findForEntity(entityType: string, entityId: string) {
    return this.prisma.masterDataActivityLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
