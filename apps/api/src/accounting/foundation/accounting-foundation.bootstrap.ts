import {
  AccountType,
  JournalEntryStatus,
  JournalType,
  PartnerControlAccountType,
  PrismaClient,
  WorkflowBusinessAction,
  WorkflowType,
} from '@prisma/client';
import {
  POSTING_ROLE_SETTINGS,
  STANDARD_CHART_OF_ACCOUNTS,
  type PostingRole,
} from './standard-chart-of-accounts';

type PrismaLike = PrismaClient;

export interface FoundationActivationResult {
  accountsCreated: number;
  accountsReused: number;
  postingSettingsFilled: string[];
  receivingAccounts: string[];
  paymentSources: string[];
  journals: string[];
  fiscalYear: string | null;
  taxes: string[];
}

const PAYMENT_SOURCES = [
  { name: 'تحويل بنكي', code: 'BANK_TRANSFER' },
  { name: 'محفظة إلكترونية', code: 'WALLET' },
  { name: 'إنستاباي', code: 'INSTAPAY' },
  { name: 'إيداع نقدي', code: 'CASH_DEPOSIT' },
  { name: 'بوابة دفع', code: 'PAYMENT_GATEWAY' },
  { name: 'نقداً', code: 'CASH' },
  { name: 'أخرى', code: 'OTHER' },
];

const JOURNALS: Array<{
  code: string;
  name: string;
  type: JournalType;
  sequencePrefix: string;
  debitRole?: PostingRole;
  creditRole?: PostingRole;
}> = [
  {
    code: 'SJ',
    name: 'دفتر المبيعات',
    type: JournalType.SALES,
    sequencePrefix: 'SJ',
    debitRole: 'AR',
    creditRole: 'SALES_REVENUE',
  },
  {
    code: 'PJ',
    name: 'دفتر المشتريات',
    type: JournalType.PURCHASE,
    sequencePrefix: 'PJ',
    debitRole: 'INVENTORY',
    creditRole: 'AP',
  },
  {
    code: 'CSH',
    name: 'دفتر الصندوق',
    type: JournalType.CASH,
    sequencePrefix: 'CSH',
    debitRole: 'CASH',
    creditRole: 'AR',
  },
  {
    code: 'BNK',
    name: 'دفتر البنك',
    type: JournalType.BANK,
    sequencePrefix: 'BNK',
    debitRole: 'BANK',
    creditRole: 'AR',
  },
  {
    code: 'GJ',
    name: 'دفتر اليومية العامة',
    type: JournalType.GENERAL,
    sequencePrefix: 'GJ',
  },
];

function levelOf(parentLevel: number | null): number {
  return parentLevel == null ? 1 : parentLevel + 1;
}

/**
 * Idempotent production/local activation of the standard CoA, posting
 * mappings, journals, cash accounts, VAT, and the current fiscal year.
 * Never deletes accounts. Reuses existing rows by preferred code or alias.
 * Fills only null Posting Settings fields (does not overwrite a live mapping).
 */
export async function activateAccountingFoundation(
  prisma: PrismaLike,
  userId?: string,
): Promise<FoundationActivationResult> {
  let accountsCreated = 0;
  let accountsReused = 0;
  const byCode = new Map<string, { id: string; level: number }>();

  const existing = await prisma.chartOfAccount.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      level: true,
      parentAccountId: true,
      allowsPosting: true,
    },
  });
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const def of STANDARD_CHART_OF_ACCOUNTS) {
    const aliasHit = (def.aliases ?? [])
      .map((alias) => existingByCode.get(alias))
      .find(Boolean);
    const current = existingByCode.get(def.code) ?? aliasHit ?? null;
    const parent = def.parentCode ? byCode.get(def.parentCode) : null;
    if (def.parentCode && !parent && !current) {
      throw new Error(
        `Standard CoA parent ${def.parentCode} missing while creating ${def.code}.`,
      );
    }
    const level = levelOf(parent?.level ?? null);

    if (current) {
      await prisma.chartOfAccount.update({
        where: { id: current.id },
        data: {
          name: def.name,
          nameEn: def.nameEn,
          accountType: def.accountType,
          parentAccountId: parent?.id ?? null,
          level,
          allowsPosting: def.allowsPosting,
          allowReconciliation: def.allowReconciliation ?? false,
          partnerControlType: def.partnerControlType ?? undefined,
          isSystemAccount: def.isSystemAccount ?? false,
          updatedBy: userId ?? null,
        },
      });
      byCode.set(def.code, { id: current.id, level });
      accountsReused += 1;
    } else {
      const created = await prisma.chartOfAccount.create({
        data: {
          code: def.code,
          name: def.name,
          nameEn: def.nameEn,
          accountType: def.accountType,
          parentAccountId: parent?.id ?? null,
          level,
          allowsPosting: def.allowsPosting,
          allowReconciliation: def.allowReconciliation ?? false,
          partnerControlType: def.partnerControlType ?? null,
          isSystemAccount: def.isSystemAccount ?? false,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      existingByCode.set(def.code, {
        id: created.id,
        code: created.code,
        level: created.level,
        parentAccountId: created.parentAccountId,
        allowsPosting: created.allowsPosting,
      });
      byCode.set(def.code, { id: created.id, level: created.level });
      accountsCreated += 1;
    }

    if (parent) {
      await prisma.chartOfAccount.update({
        where: { id: parent.id },
        data: { allowsPosting: false },
      });
    }
  }

  const roleIds = new Map<PostingRole, string>();
  for (const def of STANDARD_CHART_OF_ACCOUNTS) {
    if (!def.role) continue;
    const id = byCode.get(def.code)?.id;
    if (id) roleIds.set(def.role, id);
  }

  const postingSettingsData: Record<string, string> = {};
  const postingSettingsFilled: string[] = [];
  for (const [role, field] of Object.entries(POSTING_ROLE_SETTINGS) as Array<
    [PostingRole, string | null]
  >) {
    if (!field) continue;
    const accountId = roleIds.get(role);
    if (!accountId) continue;
    postingSettingsData[field] = accountId;
  }
  // Purchase / default expense share the operating-expense leaf when present.
  if (roleIds.get('OPERATING_EXPENSE')) {
    postingSettingsData.defaultExpenseAccountId =
      roleIds.get('OPERATING_EXPENSE')!;
    if (!postingSettingsData.purchaseAccountId) {
      postingSettingsData.purchaseAccountId = roleIds.get('OPERATING_EXPENSE')!;
    }
  }

  const existingSettings = await prisma.postingSettings.findFirst();
  if (existingSettings) {
    const patch: Record<string, string> = {};
    for (const [field, accountId] of Object.entries(postingSettingsData)) {
      const current = (existingSettings as Record<string, unknown>)[field];
      if (current == null) {
        patch[field] = accountId;
        postingSettingsFilled.push(field);
      }
    }
    if (Object.keys(patch).length > 0) {
      await prisma.postingSettings.update({
        where: { id: existingSettings.id },
        data: { ...patch, updatedBy: userId ?? null },
      });
    }
  } else {
    await prisma.postingSettings.create({
      data: { ...postingSettingsData, updatedBy: userId ?? null },
    });
    postingSettingsFilled.push(...Object.keys(postingSettingsData));
  }

  const arId = roleIds.get('AR');
  const apId = roleIds.get('AP');
  if (arId) {
    await prisma.chartOfAccount.update({
      where: { id: arId },
      data: {
        partnerControlType: PartnerControlAccountType.RECEIVABLE,
        allowReconciliation: true,
      },
    });
  }
  if (apId) {
    await prisma.chartOfAccount.update({
      where: { id: apId },
      data: {
        partnerControlType: PartnerControlAccountType.PAYABLE,
        allowReconciliation: true,
      },
    });
  }

  const cashId = roleIds.get('CASH');
  const bankId = roleIds.get('BANK');
  const receivingAccounts: string[] = [];
  if (cashId) {
    await prisma.receivingAccount.upsert({
      where: { code: 'CASH-01' },
      update: { chartOfAccountId: cashId, name: 'الصندوق الرئيسي' },
      create: {
        code: 'CASH-01',
        name: 'الصندوق الرئيسي',
        chartOfAccountId: cashId,
        isDefault: true,
      },
    });
    receivingAccounts.push('CASH-01');
  }
  if (bankId) {
    await prisma.receivingAccount.upsert({
      where: { code: 'BANK-01' },
      update: { chartOfAccountId: bankId, name: 'البنك الرئيسي' },
      create: {
        code: 'BANK-01',
        name: 'البنك الرئيسي',
        chartOfAccountId: bankId,
      },
    });
    receivingAccounts.push('BANK-01');
  }

  const paymentSources: string[] = [];
  for (const source of PAYMENT_SOURCES) {
    const existingSource = await prisma.paymentSource.findFirst({
      where: { OR: [{ name: source.name }, { code: source.code }] },
    });
    if (existingSource) {
      await prisma.paymentSource.update({
        where: { id: existingSource.id },
        data: {
          name: source.name,
          code: source.code,
          isActive: true,
          deletedAt: null,
        },
      });
    } else {
      await prisma.paymentSource.create({
        data: {
          name: source.name,
          code: source.code,
          isActive: true,
        },
      });
    }
    paymentSources.push(source.code);
  }

  const journals: string[] = [];
  for (const journal of JOURNALS) {
    const debitId = journal.debitRole
      ? roleIds.get(journal.debitRole)
      : undefined;
    const creditId = journal.creditRole
      ? roleIds.get(journal.creditRole)
      : undefined;
    await prisma.journal.upsert({
      where: { code: journal.code },
      update: {
        name: journal.name,
        type: journal.type,
        isActive: true,
        ...(debitId ? { defaultDebitAccountId: debitId } : {}),
        ...(creditId ? { defaultCreditAccountId: creditId } : {}),
      },
      create: {
        code: journal.code,
        name: journal.name,
        type: journal.type,
        sequencePrefix: journal.sequencePrefix,
        isActive: true,
        defaultDebitAccountId: debitId,
        defaultCreditAccountId: creditId,
      },
    });
    journals.push(journal.code);
  }

  const vatOutId = roleIds.get('VAT_OUTPUT');
  const vatInId = roleIds.get('VAT_INPUT');
  const taxes = [
    { code: 'VAT15', name: 'ضريبة القيمة المضافة 15%', rate: 15 },
    { code: 'VAT14', name: 'ضريبة القيمة المضافة 14%', rate: 14 },
    { code: 'VAT0', name: 'معفى من الضريبة', rate: 0 },
  ];
  const taxCodes: string[] = [];
  for (const tax of taxes) {
    await prisma.tax.upsert({
      where: { code: tax.code },
      update: {
        name: tax.name,
        rate: tax.rate,
        ...(vatOutId ? { outputAccountId: vatOutId } : {}),
        ...(vatInId ? { inputAccountId: vatInId } : {}),
      },
      create: {
        code: tax.code,
        name: tax.name,
        rate: tax.rate,
        outputAccountId: vatOutId,
        inputAccountId: vatInId,
      },
    });
    taxCodes.push(tax.code);
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const covering = await prisma.fiscalYear.findFirst({
    where: {
      deletedAt: null,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    select: { id: true, name: true, startDate: true },
  });
  let fiscalYear: string | null = covering?.name ?? null;
  let fiscalYearId = covering?.id ?? null;
  let fiscalYearStart = covering?.startDate ?? null;
  if (!covering) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    const months = Array.from({ length: 12 }, (_, month) => {
      const startDate = new Date(Date.UTC(year, month, 1));
      const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      return {
        name: `${startDate.toLocaleString('en', { month: 'short' })} ${year}`,
        startDate,
        endDate,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      };
    });
    const createdYear = await prisma.fiscalYear.create({
      data: {
        name: `FY ${year}`,
        startDate: start,
        endDate: end,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
        periods: { create: months },
      },
    });
    fiscalYear = createdYear.name;
    fiscalYearId = createdYear.id;
    fiscalYearStart = createdYear.startDate;
  }

  const cashAccountId = roleIds.get('CASH');
  const equityAccountId =
    roleIds.get('RETAINED_EARNINGS') ?? roleIds.get('CAPITAL');
  if (fiscalYearId && cashAccountId && equityAccountId) {
    const existingOpening = await prisma.journalEntry.findFirst({
      where: {
        sourceType: 'OPENING_BALANCE',
        sourceId: fiscalYearId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!existingOpening) {
      const generalJournal = await prisma.journal.findFirst({
        where: { type: JournalType.GENERAL, isActive: true, deletedAt: null },
        select: { id: true },
      });
      await prisma.journalEntry.create({
        data: {
          entryNumber: `OB-${year}`,
          entryDate: fiscalYearStart ?? new Date(Date.UTC(year, 0, 1)),
          description: `Opening Balance — ${fiscalYear}`,
          status: JournalEntryStatus.POSTED,
          sourceType: 'OPENING_BALANCE',
          sourceId: fiscalYearId,
          fiscalYearId,
          journalId: generalJournal?.id,
          totalDebit: 1,
          totalCredit: 1,
          postedAt: new Date(),
          postedBy: userId ?? null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: {
            create: [
              {
                accountId: cashAccountId,
                description: 'Opening cash',
                debit: 1,
                credit: 0,
                lineOrder: 0,
              },
              {
                accountId: equityAccountId,
                description: 'Opening equity',
                debit: 0,
                credit: 1,
                lineOrder: 1,
              },
            ],
          },
        },
      });
    }
  }

  const followUpTypes = [
    { code: 'PHONE', name: 'اتصال هاتفي', nameEn: 'Phone Call' },
    { code: 'WHATSAPP', name: 'واتساب', nameEn: 'WhatsApp' },
    { code: 'VISIT', name: 'زيارة', nameEn: 'Visit' },
  ];
  for (const type of followUpTypes) {
    await prisma.leadFollowUpType.upsert({
      where: { code: type.code },
      update: { name: type.name, nameEn: type.nameEn, isActive: true },
      create: type,
    });
  }

  const classifications = [
    { code: 'RETAIL', name: 'تجزئة', nameEn: 'Retail' },
    { code: 'WHOLESALE', name: 'جملة', nameEn: 'Wholesale' },
  ];
  for (const row of classifications) {
    await prisma.customerClassification.upsert({
      where: { code: row.code },
      update: { name: row.name, nameEn: row.nameEn, isActive: true },
      create: row,
    });
  }

  const noPurchaseReasons = [
    { code: 'PRICE', name: 'السعر مرتفع', nameEn: 'Price too high' },
    { code: 'NOT_INTERESTED', name: 'غير مهتم', nameEn: 'Not interested' },
    {
      code: 'COMPETITOR',
      name: 'اشترى من منافس',
      nameEn: 'Bought from competitor',
    },
  ];
  for (const row of noPurchaseReasons) {
    await prisma.noPurchaseReason.upsert({
      where: { code: row.code },
      update: { name: row.name, nameEn: row.nameEn, isActive: true },
      create: row,
    });
  }

  const leadStatuses = await prisma.statusDefinition.findMany({
    where: { workflowType: WorkflowType.LEAD, deletedAt: null },
    select: { id: true, code: true },
  });
  const leadByCode = new Map(leadStatuses.map((row) => [row.code, row.id]));
  const leadTransitions: Array<{
    from: string;
    to: string;
    labelAr: string;
    labelEn: string;
    businessAction?: WorkflowBusinessAction;
    sortOrder: number;
  }> = [
    {
      from: 'NEW',
      to: 'IN_PROGRESS',
      labelAr: 'بدء المتابعة',
      labelEn: 'Start follow-up',
      sortOrder: 0,
    },
    {
      from: 'IN_PROGRESS',
      to: 'QUALIFIED',
      labelAr: 'تأهيل',
      labelEn: 'Qualify',
      sortOrder: 0,
    },
    {
      from: 'QUALIFIED',
      to: 'CONVERTED',
      labelAr: 'تحويل إلى عميل',
      labelEn: 'Convert to customer',
      businessAction: WorkflowBusinessAction.LEAD_CONVERT,
      sortOrder: 0,
    },
  ];
  for (const transition of leadTransitions) {
    const fromStatusId = leadByCode.get(transition.from);
    const toStatusId = leadByCode.get(transition.to);
    if (!fromStatusId || !toStatusId) continue;
    const existingTransition = await prisma.workflowTransition.findFirst({
      where: {
        workflowType: WorkflowType.LEAD,
        fromStatusId,
        toStatusId,
        deletedAt: null,
      },
    });
    if (existingTransition) {
      await prisma.workflowTransition.update({
        where: { id: existingTransition.id },
        data: {
          isActive: true,
          labelAr: transition.labelAr,
          labelEn: transition.labelEn,
          businessAction:
            transition.businessAction ?? WorkflowBusinessAction.NONE,
        },
      });
    } else {
      await prisma.workflowTransition.create({
        data: {
          workflowType: WorkflowType.LEAD,
          fromStatusId,
          toStatusId,
          labelAr: transition.labelAr,
          labelEn: transition.labelEn,
          businessAction:
            transition.businessAction ?? WorkflowBusinessAction.NONE,
          isSystemProtected: true,
          isActive: true,
          sortOrder: transition.sortOrder,
        },
      });
    }
  }

  return {
    accountsCreated,
    accountsReused,
    postingSettingsFilled,
    receivingAccounts,
    paymentSources,
    journals,
    fiscalYear,
    taxes: taxCodes,
  };
}

export function accountTypeOfRoot(code: string): AccountType | null {
  return (
    STANDARD_CHART_OF_ACCOUNTS.find((row) => row.code === code)?.accountType ??
    null
  );
}
