import { Injectable } from '@nestjs/common';

/**
 * Architecture placeholder only — "architecture must support future
 * automatic matching. Current implementation: Manual Matching only." No
 * logic exists here and it is not called by PaymentsService; matching is
 * done exclusively via the "Match Payment" business operation, performed by
 * a human (Accounting) reviewing the bank statement.
 */
@Injectable()
export class PaymentAutoMatchingService {
  findCandidateMatches(): Promise<void> {
    return Promise.resolve();
  }
}
