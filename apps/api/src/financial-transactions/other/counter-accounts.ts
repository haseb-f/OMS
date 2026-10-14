import { BadRequestException } from '@nestjs/common';
import { AccountType, type Prisma } from '@prisma/client';
import type { CounterDirection } from './other-voucher-types';

type Reader = Pick<
  Prisma.TransactionClient,
  | 'chartOfAccount'
  | 'receivingAccount'
  | 'postingSettings'
  | 'customerProfile'
  | 'customerGroup'
  | 'supplierProfile'
  | 'supplierGroup'
  | 'paymentMethod'
  | 'tax'
  | 'productCategory'
  | 'payrollComponent'
  | 'journalEntryLine'
>;

/**
 * R22 (D4) — the account types a counter-account may have, per direction.
 * Money in: equity (owner capital), liability (loan received, deposit
 * held), revenue / other income. Money out: equity (drawings), liability
 * (loan repayment), non-cash asset (deposit paid, advance to staff).
 * Expenses stay on the expense voucher (EXPENSE_PAYMENT); a receipt never
 * credits an expense and a payment never debits revenue.
 */
export const COUNTER_ACCOUNT_TYPES: Record<CounterDirection, AccountType[]> = {
  IN: [AccountType.EQUITY, AccountType.LIABILITY, AccountType.REVENUE],
  OUT: [AccountType.EQUITY, AccountType.LIABILITY, AccountType.ASSET],
};

export type CounterAccountExclusion =
  | 'CASH_OR_BANK'
  | 'RECEIVABLE_PAYABLE_CONTROL'
  | 'INVENTORY'
  | 'MODULE_OWNED'
  | 'PARTNER_LEDGER';

/**
 * Posting Settings mappings that stay offered (review T1): the generic
 * "other income / other expense" buckets are P&L accounts no subledger
 * reconciles against — exactly what an other receipt credits.
 */
const OFFERED_SETTINGS_MAPPINGS = new Set([
  'otherIncomeAccountId',
  'otherExpenseAccountId',
]);

export interface CounterAccountRow {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  accountType: AccountType;
  currencyId: string | null;
}

/**
 * Accounts that are never a counter-account, with the reason:
 *  - CASH_OR_BANK — the ledgers behind Receiving Accounts and the configured
 *    Cash / Bank accounts (the cash-flow statement's cash set): moving money
 *    between them is an internal transfer, never an "other" receipt;
 *  - RECEIVABLE_PAYABLE_CONTROL — partner control accounts and every AR / AP
 *    mapping (Settings, customer / supplier profiles and groups, agent funds
 *    payable): partner balances move only through invoices, receipts,
 *    payments, refunds and the agent ledger;
 *  - INVENTORY — the inventory account: stock value moves only through the
 *    Inventory Engine;
 *  - MODULE_OWNED (review T1) — every other account mapped in Posting
 *    Settings (VAT, retained earnings, FX difference, payroll, fixed assets /
 *    depreciation, prepaid, accruals, landed-cost clearing, investor /
 *    partner, suspense, sales / purchase …) plus payment-method clearing,
 *    tax, product-category and payroll-component accounts: each moves only
 *    through its own module (year closing, VAT return, asset register,
 *    payroll run, settlement …), so the subledgers keep reconciling;
 *  - PARTNER_LEDGER (R22 journeys O1) — any account whose ledger already
 *    carries partner-tagged lines (agent / company-partner / investor
 *    payables, mapped or not): a partner-less voucher would post into a
 *    partner sub-ledger.
 */
export async function counterAccountExclusions(
  client: Reader,
): Promise<Map<string, CounterAccountExclusion>> {
  const [
    receiving,
    settings,
    controls,
    customerProfiles,
    customerGroups,
    supplierProfiles,
    supplierGroups,
    paymentMethods,
    taxes,
    categories,
    payrollComponents,
    partnerLedgers,
  ] = await Promise.all([
    client.receivingAccount.findMany({ select: { chartOfAccountId: true } }),
    client.postingSettings.findFirst(),
    client.chartOfAccount.findMany({
      where: { partnerControlType: { not: null } },
      select: { id: true },
    }),
    client.customerProfile.findMany({
      where: { defaultReceivableAccountId: { not: null } },
      select: { defaultReceivableAccountId: true },
      distinct: ['defaultReceivableAccountId'],
    }),
    client.customerGroup.findMany({
      where: { defaultReceivableAccountId: { not: null } },
      select: { defaultReceivableAccountId: true },
    }),
    client.supplierProfile.findMany({
      where: { defaultPayableAccountId: { not: null } },
      select: { defaultPayableAccountId: true },
      distinct: ['defaultPayableAccountId'],
    }),
    client.supplierGroup.findMany({
      where: { defaultPayableAccountId: { not: null } },
      select: { defaultPayableAccountId: true },
    }),
    client.paymentMethod.findMany({
      where: { accountId: { not: null } },
      select: { accountId: true },
    }),
    client.tax.findMany({
      select: { inputAccountId: true, outputAccountId: true },
    }),
    client.productCategory.findMany({
      select: {
        revenueAccountId: true,
        cogsAccountId: true,
        inventoryAccountId: true,
        purchaseAccountId: true,
      },
    }),
    client.payrollComponent.findMany({
      where: { accountingMappingAccountId: { not: null } },
      select: { accountingMappingAccountId: true },
    }),
    client.journalEntryLine.groupBy({
      by: ['accountId'],
      where: { partnerId: { not: null } },
    }),
  ]);
  const excluded = new Map<string, CounterAccountExclusion>();
  const mark = (
    ids: (string | null | undefined)[],
    reason: CounterAccountExclusion,
  ) => {
    for (const id of ids) if (id && !excluded.has(id)) excluded.set(id, reason);
  };
  mark(
    [
      ...receiving.map((row) => row.chartOfAccountId),
      settings?.cashAccountId,
      settings?.bankAccountId,
    ],
    'CASH_OR_BANK',
  );
  mark(
    [
      ...controls.map((row) => row.id),
      settings?.accountsReceivableAccountId,
      settings?.accountsPayableAccountId,
      settings?.agentFundsPayableAccountId,
      ...customerProfiles.map((row) => row.defaultReceivableAccountId),
      ...customerGroups.map((row) => row.defaultReceivableAccountId),
      ...supplierProfiles.map((row) => row.defaultPayableAccountId),
      ...supplierGroups.map((row) => row.defaultPayableAccountId),
    ],
    'RECEIVABLE_PAYABLE_CONTROL',
  );
  mark(
    [
      settings?.inventoryAccountId,
      ...categories.map((row) => row.inventoryAccountId),
    ],
    'INVENTORY',
  );
  const settingsMappings = Object.entries(settings ?? {})
    .filter(
      ([key, value]) =>
        key.endsWith('AccountId') &&
        !OFFERED_SETTINGS_MAPPINGS.has(key) &&
        typeof value === 'string',
    )
    .map(([, value]) => value as string);
  mark(
    [
      ...settingsMappings,
      ...paymentMethods.map((row) => row.accountId),
      ...taxes.flatMap((row) => [row.inputAccountId, row.outputAccountId]),
      ...categories.flatMap((row) => [
        row.revenueAccountId,
        row.cogsAccountId,
        row.purchaseAccountId,
      ]),
      ...payrollComponents.map((row) => row.accountingMappingAccountId),
    ],
    'MODULE_OWNED',
  );
  mark(
    partnerLedgers.map((row) => row.accountId),
    'PARTNER_LEDGER',
  );
  return excluded;
}

/** `GET financial-transactions/counter-accounts?direction=` — every allowed posting account, by code. */
export async function listCounterAccounts(
  client: Reader,
  direction: CounterDirection,
): Promise<CounterAccountRow[]> {
  const [excluded, accounts] = await Promise.all([
    counterAccountExclusions(client),
    client.chartOfAccount.findMany({
      where: {
        deletedAt: null,
        allowsPosting: true,
        accountType: { in: COUNTER_ACCOUNT_TYPES[direction] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        nameEn: true,
        accountType: true,
        currencyId: true,
      },
      orderBy: { code: 'asc' },
    }),
  ]);
  return accounts.filter((account) => !excluded.has(account.id));
}

const REASON_MESSAGE: Record<CounterAccountExclusion, string> = {
  CASH_OR_BANK:
    'is a cash / bank account — move money between your own accounts with an internal transfer',
  RECEIVABLE_PAYABLE_CONTROL:
    'is a receivable / payable control account — settle customers and suppliers with a receipt, payment or refund',
  INVENTORY:
    'is the inventory account — stock value moves only through inventory documents',
  MODULE_OWNED:
    'is owned by another module (mapped in Posting Settings, a payment method, a tax, a product category or a payroll component) — it moves only through that module',
  PARTNER_LEDGER:
    "carries partner balances (agent, partner or investor ledger) — it moves only through that partner's own documents",
};

/**
 * The one counter-account rule, enforced at create / update / confirm and
 * again by the posting provider inside the posting transaction (a draft
 * saved against an account that later became a Group, a cash account or a
 * control account never reaches the ledger).
 */
export async function assertCounterAccount(
  client: Reader,
  accountId: string | null | undefined,
  direction: CounterDirection,
): Promise<void> {
  const fail = (constraint: string, message: string) =>
    new BadRequestException({
      code: 'COUNTER_ACCOUNT_NOT_ALLOWED',
      message,
      fields: [{ field: 'counterAccountId', constraints: [constraint] }],
    });
  if (!accountId) {
    throw fail(
      'required',
      'اختر الحساب المقابل — Choose the counter-account this voucher posts against.',
    );
  }
  const account = await client.chartOfAccount.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { code: true, name: true, accountType: true, allowsPosting: true },
  });
  if (!account) {
    throw fail('not_found', 'Counter-account not found or archived.');
  }
  const label = `"${account.code} ${account.name}"`;
  if (!account.allowsPosting) {
    throw fail(
      'group_account',
      `الحساب المقابل حساب تجميعي — ${label} is a Group account and cannot be posted to directly — choose a Posting account under it.`,
    );
  }
  if (!COUNTER_ACCOUNT_TYPES[direction].includes(account.accountType)) {
    throw fail(
      'account_type',
      direction === 'IN'
        ? `نوع الحساب المقابل غير مسموح في التحصيل — ${label} is a ${account.accountType} account; an other receipt credits an equity, liability or revenue account (record an expense refund against the expense voucher instead).`
        : `نوع الحساب المقابل غير مسموح في الصرف — ${label} is a ${account.accountType} account; an other payment debits an equity, liability or non-cash asset account (record expenses with an expense voucher).`,
    );
  }
  const reason = (await counterAccountExclusions(client)).get(accountId);
  if (reason) {
    throw fail(
      reason.toLowerCase(),
      `الحساب المقابل غير مسموح — ${label} ${REASON_MESSAGE[reason]}.`,
    );
  }
}
