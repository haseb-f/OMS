import { BadRequestException } from '@nestjs/common';

/**
 * R22 F2 (same rule family as D3) — a POSTED sales / purchase return is a
 * credit / debit note on the ledger and (D2) part of its invoice's
 * settlement: archiving it would hide the credit from the invoice (which
 * would re-open and accept a second collection) while the journal entry
 * stays. A posted note is never hidden — only its own reversal workflow may
 * remove its effect.
 */
export function assertReturnNotPosted(posted: boolean, label: string): void {
  if (!posted) return;
  throw new BadRequestException({
    code: 'RETURN_ARCHIVE_POSTED',
    message: `لا يمكن أرشفة مرتجع مُرحّل — ${label} is posted (its credit / debit note is on the ledger and settles its invoice); a posted return cannot be archived.`,
  });
}
