import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const CostComponentActivityType = {
  COST_COMPONENT_CREATED: 'COST_COMPONENT_CREATED',
  COST_COMPONENT_UPDATED: 'COST_COMPONENT_UPDATED',
} as const;

@Injectable()
export class CostComponentActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    costComponentId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.costComponentActivity.create({
      data: {
        costComponentId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForComponent(costComponentId: string) {
    return this.prisma.costComponentActivity.findMany({
      where: { costComponentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
