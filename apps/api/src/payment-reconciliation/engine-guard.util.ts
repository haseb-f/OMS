import { ConflictException } from '@nestjs/common';
import { PaymentMatchStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

/**
 * One claim, one reconciliation engine (R13 D2). A `Payment` allocated on a provider statement
 * (an ACTIVE `PaymentMatch`) reaches the bank through its provider settlement, never through a
 * bank-transaction match — and a claim already matched by a bank transaction
 * (`BankTransaction.matchedPaymentId`) is never allocated on a provider statement.
 */

/** Payment ids among `paymentIds` holding an ACTIVE provider-statement allocation. */
export async function providerMatchedPaymentIds(
  client: Client,
  paymentIds: string[],
): Promise<Set<string>> {
  if (paymentIds.length === 0) return new Set();
  const rows = await client.paymentMatch.findMany({
    where: {
      paymentId: { in: paymentIds },
      status: PaymentMatchStatus.ACTIVE,
    },
    select: { paymentId: true },
    distinct: ['paymentId'],
  });
  return new Set(rows.map((row) => row.paymentId));
}

/** Bank side: refuses a claim that a provider statement already allocated. */
export async function assertNotProviderMatched(
  client: Client,
  payment: { id: string; paymentNumber?: string | null },
): Promise<void> {
  const matched = await providerMatchedPaymentIds(client, [payment.id]);
  if (matched.size === 0) return;
  throw new ConflictException(
    `Payment ${payment.paymentNumber ?? payment.id} is already matched on its provider statement (Finance → Payment reconciliation). Its money reaches the bank through the provider settlement — reconcile this bank line to that settlement, or reverse the statement match first.`,
  );
}

/** Provider side: refuses claims that a bank transaction already matched. */
export async function assertNotBankMatched(
  client: Client,
  claims: { id: string; paymentNumber?: string | null }[],
): Promise<void> {
  if (claims.length === 0) return;
  const linked = await client.bankTransaction.findFirst({
    where: {
      matchedPaymentId: { in: claims.map((claim) => claim.id) },
      deletedAt: null,
    },
    select: { matchedPaymentId: true, transactionId: true, reference: true },
  });
  if (!linked) return;
  const claim = claims.find((row) => row.id === linked.matchedPaymentId);
  throw new ConflictException(
    `Claim ${claim?.paymentNumber ?? linked.matchedPaymentId} is already reconciled to bank transaction ${linked.transactionId ?? linked.reference ?? ''} (Finance → Bank transactions) — unreconcile it there before allocating it on a provider statement.`,
  );
}

/** Prisma filter: claims no live bank transaction has matched. */
export const NOT_BANK_MATCHED_CLAIM: Prisma.PaymentWhereInput = {
  reconciledBankTransactions: { none: { deletedAt: null } },
};
