import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const SupplierActivityType = {
  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER_UPDATED',
  SUPPLIER_ARCHIVED: 'SUPPLIER_ARCHIVED',
  SUPPLIER_RESTORED: 'SUPPLIER_RESTORED',
} as const;

@Injectable()
export class SupplierActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    supplierId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.supplierActivity.create({
      data: {
        supplierId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForSupplier(supplierId: string) {
    return this.prisma.supplierActivity.findMany({
      where: { supplierId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
