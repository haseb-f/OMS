import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticDistributionLineDto } from './dto/set-analytic-distributions.dto';

const INCLUDE_RELATIONS = {
  analyticPlan: true,
  analyticAccount: true,
} as const;

/**
 * Generic Analytic Distribution engine (TASK-025 Part 2) — attaches
 * Analytic Dimensions (one account per plan, unlimited plans) to any
 * transactional document via `documentType` + `documentId`, the same
 * reference-pair idiom `InventoryMovement.referenceType/referenceId`
 * already uses. One service, reused by every document type: no per-module
 * distribution logic anywhere.
 */
@Injectable()
export class AnalyticDistributionsService {
  constructor(private readonly prisma: PrismaService) {}

  getForDocument(documentType: string, documentId: string) {
    return this.prisma.analyticDistributionLine.findMany({
      where: { documentType, documentId },
      include: INCLUDE_RELATIONS,
      orderBy: { analyticPlan: { displayOrder: 'asc' } },
    });
  }

  async setForDocument(
    documentType: string,
    documentId: string,
    lines: AnalyticDistributionLineDto[],
    userId: string,
  ) {
    const planIds = lines.map((line) => line.analyticPlanId);

    await this.prisma.$transaction(async (tx) => {
      await tx.analyticDistributionLine.deleteMany({
        where: {
          documentType,
          documentId,
          analyticPlanId: planIds.length ? { notIn: planIds } : undefined,
        },
      });

      for (const line of lines) {
        await tx.analyticDistributionLine.upsert({
          where: {
            documentType_documentId_analyticPlanId: {
              documentType,
              documentId,
              analyticPlanId: line.analyticPlanId,
            },
          },
          create: {
            documentType,
            documentId,
            analyticPlanId: line.analyticPlanId,
            analyticAccountId: line.analyticAccountId,
            createdBy: userId,
          },
          update: {
            analyticAccountId: line.analyticAccountId,
          },
        });
      }
    });

    return this.getForDocument(documentType, documentId);
  }
}
