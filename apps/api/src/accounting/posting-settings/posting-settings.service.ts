import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePostingSettingsDto } from './dto/update-posting-settings.dto';

const INCLUDE = {
  salesRevenueAccount: true,
  costOfGoodsSoldAccount: true,
  inventoryAccount: true,
  accountsReceivableAccount: true,
  accountsPayableAccount: true,
  defaultExpenseAccount: true,
  salesDiscountAccount: true,
  salesReturnAccount: true,
  inventoryAdjustmentAccount: true,
  purchaseAccount: true,
  purchaseReturnAccount: true,
  cashAccount: true,
  bankAccount: true,
  vatOutputAccount: true,
  vatInputAccount: true,
  roundDifferenceAccount: true,
  purchaseDiscountAccount: true,
  exchangeDifferenceAccount: true,
  suspenseAccount: true,
  retainedEarningsAccount: true,
} as const;

/**
 * Accounting Settings (TASK-046/047) — the singleton row of global
 * fallback GL accounts every Posting Provider falls back to once
 * Product Category / Customer Group / Supplier Group / Tax overrides
 * (resolved by `AccountMappingService`) have none of their own.
 */
@Injectable()
export class PostingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the singleton row on first read if it doesn't exist yet — no seed dependency required. */
  async get() {
    const existing = await this.prisma.postingSettings.findFirst({
      include: INCLUDE,
    });
    if (existing) return existing;
    return this.prisma.postingSettings.create({ data: {}, include: INCLUDE });
  }

  async update(dto: UpdatePostingSettingsDto, userId?: string) {
    const existing = await this.get();
    return this.prisma.postingSettings.update({
      where: { id: existing.id },
      data: { ...dto, updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }
}
