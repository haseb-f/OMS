import { BadRequestException } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import type { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import type { PrismaService } from '../prisma/prisma.service';

/** R14 W5 — posting source types of company-partner profit sharing. */
export const PARTNER_PROFIT_DISTRIBUTION = 'PARTNER_PROFIT_DISTRIBUTION';
export const PARTNER_PROFIT_ADJUSTMENT = 'PARTNER_PROFIT_ADJUSTMENT';
export const PARTNER_PROFIT_PAYMENT = 'PARTNER_PROFIT_PAYMENT';

export interface PartnerProfitAccounts {
  distributionAccountId: string;
  payableAccountId: string;
}

const SETTINGS_HINT =
  'Settings → Accounting → Company partners / الإعدادات ← المحاسبة ← الشركاء';

/**
 * The two partner-profit accounts (decision D5-3): configured in Settings →
 * Accounting, never created automatically. Distribution must be a postable
 * EQUITY account and payable a postable LIABILITY account — a partner
 * distribution never touches the income statement (no circularity, spec §3).
 * Resolved through AccountMappingService (the one place providers ask for an
 * account); the type check lives here so the service can refuse BEFORE any
 * write with an actionable message, and the provider re-checks at posting.
 */
export async function resolvePartnerProfitAccounts(
  accountMapping: AccountMappingService,
  client: Prisma.TransactionClient | PrismaService,
): Promise<PartnerProfitAccounts> {
  let distributionAccountId: string;
  let payableAccountId: string;
  try {
    distributionAccountId =
      await accountMapping.resolvePartnerProfitDistributionAccount(client);
    payableAccountId =
      await accountMapping.resolvePartnerProfitPayableAccount(client);
  } catch {
    throw new BadRequestException({
      code: 'PARTNER_ACCOUNTS_NOT_CONFIGURED',
      message: `اختر حساب توزيع أرباح الشركاء (حقوق ملكية) وحساب أرباح الشركاء المستحقة (التزامات) في ${SETTINGS_HINT} — Choose the partner profit distribution (equity) and partner profit payable (liability) accounts in ${SETTINGS_HINT} before closing a period or recording a payment.`,
    });
  }
  await assertAccountKind(
    client,
    distributionAccountId,
    AccountType.EQUITY,
    'Partner profit distribution',
  );
  await assertAccountKind(
    client,
    payableAccountId,
    AccountType.LIABILITY,
    'Partner profit payable',
  );
  return { distributionAccountId, payableAccountId };
}

export async function assertAccountKind(
  client: Prisma.TransactionClient | PrismaService,
  accountId: string,
  expected: AccountType | AccountType[],
  label: string,
  fix = `Change it in ${SETTINGS_HINT}.`,
) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const account = await client.chartOfAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { code: true, name: true, accountType: true, allowsPosting: true },
  });
  if (!account) {
    throw new BadRequestException({
      code: 'PARTNER_ACCOUNT_INVALID',
      message: `${label}: account not found.`,
    });
  }
  if (!allowed.includes(account.accountType) || !account.allowsPosting) {
    throw new BadRequestException({
      code: 'PARTNER_ACCOUNT_INVALID',
      message: `${label} must be a postable ${allowed.join(' / ')} account — ${account.code} ${account.name} is ${account.allowsPosting ? account.accountType : 'a group account'}. ${fix}`,
    });
  }
}
