import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const JournalEntryActivityType = {
  ENTRY_CREATED: 'ENTRY_CREATED',
  ENTRY_UPDATED: 'ENTRY_UPDATED',
  ENTRY_POSTED: 'ENTRY_POSTED',
  ENTRY_REVERSED: 'ENTRY_REVERSED',
  ENTRY_ARCHIVED: 'ENTRY_ARCHIVED',
} as const;

@Injectable()
export class JournalEntryActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    journalEntryId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.journalEntryActivity.create({
      data: {
        journalEntryId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForEntry(journalEntryId: string) {
    return this.prisma.journalEntryActivity.findMany({
      where: { journalEntryId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
