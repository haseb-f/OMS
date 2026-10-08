import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';

export interface DuplicateCheckInput {
  /** Must already be normalized E.164 — `LeadsService.create()`/`update()` always pass the `PhoneNumberService`-normalized value, never the raw user input. */
  mobileNumber: string;
  customerName: string;
  productId?: string | null;
  /**
   * Agents milestone (S8): the lead's owner agent (null = company lead).
   * Candidates are only leads of the same owner, so an agent never learns
   * whether the company or another agent already has this contact.
   * Omitted = company scope.
   */
  agentId?: string | null;
}

export interface DuplicateCheckResult {
  /** Mobile + Customer Name + Product all match an existing lead — creation must be rejected. */
  isExactDuplicate: boolean;
  /** Mobile + Customer Name match an existing lead, but the product differs — creation is
   *  allowed, the new lead is flagged `possibleDuplicate`. */
  isPossibleDuplicate: boolean;
  /** R15 — the existing lead an exact duplicate matches (named in the refusal). */
  matchedLeadNumber?: string;
}

/**
 * CRM Phase 2 duplicate-detection rule:
 * - Mobile + Customer Name + Product identical  -> reject (exact duplicate).
 * - Mobile + Customer Name match, Product differs -> allow, flag as possible duplicate.
 *
 * Compares canonical E.164 values, never raw strings — "+966501234567",
 * "0501234567", and "00966501234567" for the same person must match. New
 * writes are already normalized before reaching here (see
 * `LeadsService.create()`), but existing rows predating this weren't
 * necessarily stored as E.164, so each candidate is re-normalized against
 * its own Country at comparison time rather than trusting an exact DB
 * string match.
 */
@Injectable()
export class LeadDuplicateDetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneNumberService: PhoneNumberService,
  ) {}

  async check(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    const candidates = await this.prisma.lead.findMany({
      where: {
        customerName: input.customerName,
        deletedAt: null,
        agentId: input.agentId ?? null,
      },
      select: {
        leadNumber: true,
        productId: true,
        mobileNumber: true,
        country: { select: { code: true } },
      },
    });

    const matches = candidates.filter((candidate) => {
      const normalized = this.phoneNumberService.normalizeToE164(
        candidate.mobileNumber,
        candidate.country?.code,
      );
      return (normalized ?? candidate.mobileNumber) === input.mobileNumber;
    });

    if (matches.length === 0) {
      return { isExactDuplicate: false, isPossibleDuplicate: false };
    }

    const productId = input.productId ?? null;
    const exact = matches.find(
      (match) => (match.productId ?? null) === productId,
    );

    return exact
      ? {
          isExactDuplicate: true,
          isPossibleDuplicate: false,
          matchedLeadNumber: exact.leadNumber,
        }
      : { isExactDuplicate: false, isPossibleDuplicate: true };
  }
}
