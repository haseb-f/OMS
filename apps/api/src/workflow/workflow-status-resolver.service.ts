import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  BankTransactionMatchStatus,
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
  WorkflowType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FULFILLMENT_STAGE_CODE,
  MATCHING_STATUS_CODE,
  ORDER_PAYMENT_STATUS_CODE,
  WORKFLOW_FOR_FULFILLMENT,
  WORKFLOW_FOR_MATCHING,
  WORKFLOW_FOR_ORDER_PAYMENT,
} from './workflow-status-map';

/**
 * Resolves StatusDefinition ids by workflow + code with a process-local
 * cache. Used by dual-write paths so Payment/Fulfillment/Matching runtime
 * stays StatusDefinition-backed without per-row catalog queries.
 */
@Injectable()
export class WorkflowStatusResolverService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh() {
    const rows = await this.prisma.statusDefinition.findMany({
      where: {
        deletedAt: null,
        workflowType: {
          in: [
            WorkflowType.PAYMENT,
            WorkflowType.FULFILLMENT,
            WorkflowType.MATCHING,
            WorkflowType.LEAD,
            WorkflowType.ORDER,
          ],
        },
      },
      select: { id: true, workflowType: true, code: true },
    });
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(`${row.workflowType}:${row.code}`, row.id);
    }
  }

  id(workflowType: WorkflowType, code: string): string | null {
    return this.cache.get(`${workflowType}:${code}`) ?? null;
  }

  requireId(workflowType: WorkflowType, code: string): string {
    const id = this.id(workflowType, code);
    if (!id) {
      throw new Error(
        `Missing StatusDefinition ${workflowType}/${code} — run migrations/seed.`,
      );
    }
    return id;
  }

  paymentStatusId(status: StoreOrderPaymentStatus): string {
    return this.requireId(
      WORKFLOW_FOR_ORDER_PAYMENT,
      ORDER_PAYMENT_STATUS_CODE[status],
    );
  }

  fulfillmentStatusId(stage: StoreOrderShippingStage): string {
    return this.requireId(
      WORKFLOW_FOR_FULFILLMENT,
      FULFILLMENT_STAGE_CODE[stage],
    );
  }

  matchingStatusId(status: BankTransactionMatchStatus): string {
    return this.requireId(WORKFLOW_FOR_MATCHING, MATCHING_STATUS_CODE[status]);
  }
}
