import type { Prisma } from '@prisma/client';
import { agentConflict } from '../common/agent-errors';

/**
 * Agents milestone (spec §7): money an agent received directly is not
 * company cash. Provider statement matching, settlement queues and company
 * cash reports only ever see claims whose destination is ours (legacy
 * claims have no destination and stay in scope). Combine with `AND`.
 */
export const COMPANY_CASH_CLAIM: Prisma.PaymentWhereInput = {
  OR: [{ destinationOwnership: null }, { destinationOwnership: 'COMPANY' }],
};

/**
 * The same rule for one claim a Finance action is about to decide (match,
 * reject, dispute, bank match): an AGENT-destination claim is reviewed only
 * in Finance → Agent collections (`agents.finance.verify`), never through
 * the company cash flow.
 */
export function assertCompanyCashClaim(payment: {
  paymentNumber: string;
  destinationOwnership: string | null;
}) {
  if (payment.destinationOwnership === 'AGENT') {
    throw agentConflict(
      'AGENT_DESTINATION_USE_AGENT_COLLECTIONS',
      `الدفعة ${payment.paymentNumber} استلمها الوكيل مباشرة — راجعها من طابور تحصيلات الوكلاء`,
      `Payment ${payment.paymentNumber} was received by the agent — review it in Finance → Agent collections (it is not company cash).`,
    );
  }
}
