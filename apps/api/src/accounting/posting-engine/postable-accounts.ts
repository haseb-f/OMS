import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type AccountReader = Pick<Prisma.TransactionClient, 'chartOfAccount'>;

/**
 * The one "can this account receive a journal line?" rule (R13 B1, invariant
 * 6), shared by the Posting Engine and the manual journal `post()` so both
 * re-check at post time — a draft saved against a leaf that later became a
 * Group, or was archived, can never reach the ledger.
 *
 * Only Posting accounts (`allowsPosting=true`) that still exist (not
 * archived) qualify. Year closing is exempt from both checks because it
 * zeroes historical balances wherever they sit.
 */
export async function assertPostableAccounts(
  client: AccountReader,
  accountIds: readonly string[],
  options: { closingEntry?: boolean } = {},
): Promise<void> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return;
  const closingEntry = options.closingEntry ?? false;
  const accounts = await client.chartOfAccount.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      code: true,
      name: true,
      allowsPosting: true,
      deletedAt: true,
    },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  for (const accountId of ids) {
    const account = byId.get(accountId);
    if (!account) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_POSTABLE',
        message: `Account ${accountId} does not exist — review the account mapping.`,
        fields: [{ field: 'accountId', constraints: ['account_missing'] }],
      });
    }
    if (account.deletedAt && !closingEntry) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_POSTABLE',
        message: `Account ${account.code} ${account.name} is archived and cannot receive postings — restore it or choose another posting account.`,
        fields: [{ field: 'accountId', constraints: ['account_archived'] }],
      });
    }
    if (!account.allowsPosting && !closingEntry) {
      throw new BadRequestException({
        code: 'ACCOUNT_NOT_POSTABLE',
        message: `Account ${account.code} ${account.name} is a Group account and cannot receive postings — choose a Posting account under it.`,
        fields: [{ field: 'accountId', constraints: ['group_account'] }],
      });
    }
  }
}
