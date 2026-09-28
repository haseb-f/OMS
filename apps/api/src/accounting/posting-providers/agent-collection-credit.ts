import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AccountMappingService } from '../account-mapping/account-mapping.service';

/**
 * Agents milestone (spec §7): a Customer Receipt that posts a COMPANY-
 * destination payment of an agent order credits Agent funds payable
 * (partner = the agent) instead of the customer's AR — the money is the
 * agent's, not a settlement of a company sale. Returns null for every other
 * receipt (unchanged behavior). Never falls back to AR: unconfigured agent
 * accounts throw (the confirm path refuses earlier with a clearer message).
 */
export async function resolveAgentCollectionCredit(
  tx: Prisma.TransactionClient,
  accountMapping: AccountMappingService,
  financialTransactionId: string,
): Promise<{ accountId: string; partnerId: string } | null> {
  const link = await tx.paymentReceiptLink.findUnique({
    where: { financialTransactionId },
    select: {
      payment: {
        select: {
          agentId: true,
          destinationOwnership: true,
          agent: { select: { partnerId: true } },
        },
      },
    },
  });
  const payment = link?.payment;
  if (!payment?.agentId || !payment.agent) return null;
  if (payment.destinationOwnership === 'AGENT') {
    throw new BadRequestException({
      code: 'AGENT_DESTINATION_NOT_COMPANY_CASH',
      message:
        'This payment was received by the agent — it is not company cash and has no receipt.',
    });
  }
  const accounts = await accountMapping.resolveAgentAccounts(tx);
  if (!accounts) {
    throw new BadRequestException({
      code: 'AGENT_ACCOUNTS_NOT_CONFIGURED',
      message:
        'Agent posting accounts are not configured (Accounting Settings → Agent funds payable).',
    });
  }
  return {
    accountId: accounts.fundsPayableAccountId,
    partnerId: payment.agent.partnerId,
  };
}
