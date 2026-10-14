import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

type Reader = Pick<
  Prisma.TransactionClient,
  'receivingAccount' | 'postingSettings'
>;

export interface MoneyAccount {
  id: string;
  name: string;
  chartOfAccountId: string;
  /** The account's own currency (null = the functional currency). */
  currencyId: string | null;
}

/**
 * R22 (D4) — a cash / bank account (Receiving Account) a voucher may move
 * money through: it exists, is not archived and is active. `field` names the
 * request field in the error.
 */
export async function loadMoneyAccount(
  client: Reader,
  id: string,
  field: 'receivingAccountId' | 'targetReceivingAccountId',
): Promise<MoneyAccount> {
  const account = await client.receivingAccount.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      chartOfAccountId: true,
      currencyId: true,
      isActive: true,
    },
  });
  if (!account) {
    throw new BadRequestException({
      code: 'MONEY_ACCOUNT_INVALID',
      message: 'Cash / bank account not found or archived.',
      fields: [{ field, constraints: ['not_found'] }],
    });
  }
  if (!account.isActive) {
    throw new BadRequestException({
      code: 'MONEY_ACCOUNT_INVALID',
      message: `الحساب ${account.name} غير نشط — Cash / bank account ${account.name} is inactive.`,
      fields: [{ field, constraints: ['inactive'] }],
    });
  }
  return account;
}

/**
 * R22 (D4) — the two legs of an internal transfer: two different cash /
 * bank accounts with two different ledger accounts, in ONE currency (an
 * account without a currency is in the functional currency). A transfer
 * between currencies is refused with 422 TRANSFER_CROSS_CURRENCY: it is a
 * currency exchange (two amounts, a dealt rate and a realised FX
 * difference), not a same-value move, and is not supported as a voucher —
 * record it as a manual journal entry. Returns the transfer's currency
 * (null = functional).
 */
export async function resolveTransferLegs(
  client: Reader,
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
): Promise<{
  source: MoneyAccount;
  target: MoneyAccount;
  currencyId: string | null;
}> {
  if (!sourceId || !targetId) {
    throw new BadRequestException({
      code: 'TRANSFER_ACCOUNTS_REQUIRED',
      message:
        'اختر الحساب المحوَّل منه والحساب المحوَّل إليه — Choose the account the money leaves (receivingAccountId) and the account it goes to (targetReceivingAccountId).',
      fields: [
        ...(!sourceId
          ? [{ field: 'receivingAccountId', constraints: ['required'] }]
          : []),
        ...(!targetId
          ? [{ field: 'targetReceivingAccountId', constraints: ['required'] }]
          : []),
      ],
    });
  }
  const [source, target] = await Promise.all([
    loadMoneyAccount(client, sourceId, 'receivingAccountId'),
    loadMoneyAccount(client, targetId, 'targetReceivingAccountId'),
  ]);
  if (
    source.id === target.id ||
    source.chartOfAccountId === target.chartOfAccountId
  ) {
    throw new BadRequestException({
      code: 'TRANSFER_SAME_ACCOUNT',
      message:
        'التحويل يكون بين حسابين مختلفين — An internal transfer moves money between two different cash / bank accounts.',
      fields: [
        { field: 'targetReceivingAccountId', constraints: ['same_account'] },
      ],
    });
  }
  if (!(await sameCurrency(client, source.currencyId, target.currencyId))) {
    throw crossCurrency(source.name, target.name);
  }
  return { source, target, currencyId: source.currencyId };
}

/** Two currency ids name the same currency (null = the functional currency). */
export async function sameCurrency(
  client: Reader,
  a: string | null,
  b: string | null,
): Promise<boolean> {
  if (a === b) return true;
  const functionalId =
    (
      await client.postingSettings.findFirst({
        select: { functionalCurrencyId: true },
      })
    )?.functionalCurrencyId ?? null;
  return (a ?? functionalId) === (b ?? functionalId);
}

/** The voucher currency of a transfer must be its accounts' currency. */
export async function assertTransferCurrency(
  client: Reader,
  voucherCurrencyId: string | null | undefined,
  legsCurrencyId: string | null,
): Promise<void> {
  if (voucherCurrencyId === undefined) return;
  if (!(await sameCurrency(client, voucherCurrencyId, legsCurrencyId))) {
    throw crossCurrency('the voucher', 'its accounts');
  }
}

/** An other receipt / payment moves money in the currency of its cash / bank account (when the account has one). */
export async function assertMoneyAccountCurrency(
  client: Reader,
  voucherCurrencyId: string | null,
  account: MoneyAccount,
): Promise<void> {
  if (!account.currencyId) return;
  if (await sameCurrency(client, voucherCurrencyId, account.currencyId)) return;
  throw new BadRequestException({
    code: 'CURRENCY_MISMATCH',
    message: `عملة السند تختلف عن عملة الحساب ${account.name} — The voucher currency differs from the currency of cash / bank account ${account.name}.`,
    fields: [{ field: 'currencyId', constraints: ['currency_mismatch'] }],
  });
}

function crossCurrency(from: string, to: string) {
  return new UnprocessableEntityException({
    code: 'TRANSFER_CROSS_CURRENCY',
    message: `التحويل بين عملتين غير مدعوم كسند تحويل — سجّله كقيد يومية — ${from} and ${to} are in different currencies: an exchange between currencies is not an internal transfer voucher; record it as a manual journal entry.`,
    fields: [
      { field: 'targetReceivingAccountId', constraints: ['currency_mismatch'] },
    ],
  });
}
