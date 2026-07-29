import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DuplicateCheckInput {
  mobileNumber: string;
  customerName: string;
  productId?: string | null;
}

export interface DuplicateCheckResult {
  /** Mobile + Customer Name + Product all match an existing lead — creation must be rejected. */
  isExactDuplicate: boolean;
  /** Mobile + Customer Name match an existing lead, but the product differs — creation is
   *  allowed, the new lead is flagged `possibleDuplicate`. */
  isPossibleDuplicate: boolean;
}

/**
 * CRM Phase 2 duplicate-detection rule:
 * - Mobile + Customer Name + Product identical  -> reject (exact duplicate).
 * - Mobile + Customer Name match, Product differs -> allow, flag as possible duplicate.
 */
@Injectable()
export class LeadDuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  async check(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    const matches = await this.prisma.lead.findMany({
      where: {
        mobileNumber: input.mobileNumber,
        customerName: input.customerName,
        deletedAt: null,
      },
      select: { productId: true },
    });

    if (matches.length === 0) {
      return { isExactDuplicate: false, isPossibleDuplicate: false };
    }

    const productId = input.productId ?? null;
    const isExactDuplicate = matches.some(
      (match) => (match.productId ?? null) === productId,
    );

    return { isExactDuplicate, isPossibleDuplicate: !isExactDuplicate };
  }
}
