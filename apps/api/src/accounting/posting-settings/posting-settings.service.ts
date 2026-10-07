import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AccountType, JournalEntryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePostingSettingsDto } from './dto/update-posting-settings.dto';

const INCLUDE = {
  salesRevenueAccount: true,
  costOfGoodsSoldAccount: true,
  inventoryAccount: true,
  accountsReceivableAccount: true,
  accountsPayableAccount: true,
  defaultExpenseAccount: true,
  salesDiscountAccount: true,
  salesReturnAccount: true,
  inventoryAdjustmentAccount: true,
  purchaseAccount: true,
  purchaseReturnAccount: true,
  cashAccount: true,
  bankAccount: true,
  vatOutputAccount: true,
  vatInputAccount: true,
  roundDifferenceAccount: true,
  purchaseDiscountAccount: true,
  exchangeDifferenceAccount: true,
  suspenseAccount: true,
  retainedEarningsAccount: true,
  payrollPayableAccount: true,
  salaryExpenseAccount: true,
  kpiExpenseAccount: true,
  commissionExpenseAccount: true,
  defaultAllowanceExpenseAccount: true,
  defaultDeductionAccount: true,
  investorFundingAccount: true,
  investorProfitDistributionAccount: true,
  investorProfitPayableAccount: true,
  capitalReturnAccount: true,
  landedCostClearingAccount: true,
  shippingExpenseAccount: true,
  accruedShippingAccount: true,
  paymentGatewayFeeAccount: true,
  fulfillmentExpenseAccount: true,
  accruedFulfillmentAccount: true,
  fixedAssetsAccount: true,
  accumDepreciationAccount: true,
  depreciationExpenseAccount: true,
  prepaymentsAccount: true,
  accruedExpensesAccount: true,
  unrealizedFxAccount: true,
  otherIncomeAccount: true,
  otherExpenseAccount: true,
  assemblyCostAccount: true,
  agentFundsPayableAccount: true,
  agentCommissionRevenueAccount: true,
  agentServiceRevenueAccount: true,
  functionalCurrency: true,
  partnerProfitDistributionAccount: true,
  partnerProfitPayableAccount: true,
} as const;

/**
 * Accounting Settings (TASK-046/047) — the singleton row of global
 * fallback GL accounts every Posting Provider falls back to once
 * Product Category / Customer Group / Supplier Group / Tax overrides
 * (resolved by `AccountMappingService`) have none of their own.
 */
@Injectable()
export class PostingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the singleton row on first read if it doesn't exist yet — no seed dependency required. */
  async get() {
    const existing = await this.prisma.postingSettings.findFirst({
      include: INCLUDE,
    });
    if (existing) return existing;
    return this.prisma.postingSettings.create({ data: {}, include: INCLUDE });
  }

  async update(dto: UpdatePostingSettingsDto, userId?: string) {
    const existing = await this.get();
    await this.assertFunctionalCurrencyChangeAllowed(
      existing.functionalCurrencyId,
      dto.functionalCurrencyId,
    );
    await this.assertAgentAccounts(dto, existing);
    await this.assertAssemblyCostAccount(dto, existing);
    await this.assertPartnerProfitAccounts(dto, existing);
    return this.prisma.postingSettings.update({
      where: { id: existing.id },
      data: { ...dto, updatedBy: userId ?? null },
      include: INCLUDE,
    });
  }

  /**
   * Agents milestone (spec §11 D1): the agent funds payable account must be a
   * postable LIABILITY; the commission and service revenue accounts must be
   * postable REVENUE accounts. Validated here so Finance cannot point agent
   * postings at an unsuitable account.
   */
  private async assertAgentAccounts(
    dto: UpdatePostingSettingsDto,
    existing: {
      functionalCurrencyId: string | null;
      agentFundsPayableAccountId: string | null;
      agentCommissionRevenueAccountId: string | null;
      agentServiceRevenueAccountId: string | null;
    },
  ) {
    const functionalCurrencyId =
      dto.functionalCurrencyId ?? existing.functionalCurrencyId;
    const checks: Array<[string | undefined | null, AccountType, string]> = [
      [
        dto.agentFundsPayableAccountId,
        AccountType.LIABILITY,
        'Agent funds payable',
      ],
      [
        dto.agentCommissionRevenueAccountId,
        AccountType.REVENUE,
        'Agent commission revenue',
      ],
      [
        dto.agentServiceRevenueAccountId,
        AccountType.REVENUE,
        'Fulfillment service revenue',
      ],
    ];
    for (const [accountId, expected, label] of checks) {
      if (!accountId) continue;
      const account = await this.prisma.chartOfAccount.findFirst({
        where: { id: accountId, deletedAt: null },
        select: {
          code: true,
          name: true,
          accountType: true,
          allowsPosting: true,
          currencyId: true,
        },
      });
      if (!account) {
        throw new BadRequestException({
          code: 'AGENT_ACCOUNT_INVALID',
          message: `${label}: account not found.`,
        });
      }
      if (account.accountType !== expected || !account.allowsPosting) {
        throw new BadRequestException({
          code: 'AGENT_ACCOUNT_INVALID',
          message: `${label} must be a postable ${expected} account — ${account.code} ${account.name} is ${account.allowsPosting ? account.accountType : 'a header account'}.`,
        });
      }
      // Agent balances are carried in the functional currency (F-M4): the
      // account must be unrestricted or locked to that currency.
      if (
        account.currencyId &&
        (!functionalCurrencyId || account.currencyId !== functionalCurrencyId)
      ) {
        throw new BadRequestException({
          code: 'AGENT_ACCOUNT_CURRENCY',
          message: `${label}: ${account.code} ${account.name} is locked to a currency other than the functional currency — choose an account without a currency lock or in the functional currency.`,
        });
      }
    }
    // F-M4: once agent entries are in the GL, the three agent accounts are
    // frozen — re-pointing them would split one agent balance across two
    // accounts (and strand earlier postings on the old one).
    const fields = [
      'agentFundsPayableAccountId',
      'agentCommissionRevenueAccountId',
      'agentServiceRevenueAccountId',
    ] as const;
    const changing = fields.filter(
      (field) =>
        dto[field] !== undefined &&
        existing[field] != null &&
        (dto[field] ?? null) !== existing[field],
    );
    if (changing.length > 0) {
      const posted = await this.prisma.agentLedgerEntry.count({
        where: { postingStatus: 'POSTED' },
      });
      if (posted > 0) {
        throw new ConflictException({
          code: 'AGENT_ACCOUNTS_LOCKED',
          message:
            'لا يمكن تغيير حسابات الوكلاء بعد ترحيل قيود عليها — The agent accounts cannot change once agent ledger entries have been posted to them.',
          fields: changing.map((field) => ({
            field,
            constraints: ['lockedAfterPosting'],
          })),
        });
      }
    }
  }

  /**
   * R13 — the assembly cost account receives the credit of approved direct
   * assembly costs (functional amounts, Posting Engine). It must exist, be a
   * postable (leaf) account and not be locked to a currency other than the
   * functional one — never a header account the engine would reject at
   * posting time.
   */
  private async assertAssemblyCostAccount(
    dto: UpdatePostingSettingsDto,
    existing: { functionalCurrencyId: string | null },
  ) {
    if (!dto.assemblyCostAccountId) return;
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id: dto.assemblyCostAccountId, deletedAt: null },
      select: { code: true, name: true, allowsPosting: true, currencyId: true },
    });
    if (!account) {
      throw new BadRequestException({
        code: 'ASSEMBLY_COST_ACCOUNT_INVALID',
        message: 'Assembly cost account: account not found.',
      });
    }
    if (!account.allowsPosting) {
      throw new BadRequestException({
        code: 'ASSEMBLY_COST_ACCOUNT_INVALID',
        message: `Assembly cost account must be a postable account — ${account.code} ${account.name} is a header account.`,
      });
    }
    const functionalCurrencyId =
      dto.functionalCurrencyId ?? existing.functionalCurrencyId;
    if (
      account.currencyId &&
      (!functionalCurrencyId || account.currencyId !== functionalCurrencyId)
    ) {
      throw new BadRequestException({
        code: 'ASSEMBLY_COST_ACCOUNT_INVALID',
        message: `Assembly cost account: ${account.code} ${account.name} is locked to a currency other than the functional currency — choose an account without a currency lock or in the functional currency.`,
      });
    }
  }

  /**
   * R14 W5 (spec-5, D5-3) — partner profit distribution must be a postable
   * EQUITY account and partner profit payable a postable LIABILITY account
   * (a distribution is never an expense). Both are frozen once a partner
   * profit entry is posted — re-pointing them would split the partners'
   * payable balance across two accounts.
   */
  private async assertPartnerProfitAccounts(
    dto: UpdatePostingSettingsDto,
    existing: {
      partnerProfitDistributionAccountId: string | null;
      partnerProfitPayableAccountId: string | null;
    },
  ) {
    const checks: Array<[string | undefined | null, AccountType, string]> = [
      [
        dto.partnerProfitDistributionAccountId,
        AccountType.EQUITY,
        'Partner profit distribution',
      ],
      [
        dto.partnerProfitPayableAccountId,
        AccountType.LIABILITY,
        'Partner profit payable',
      ],
    ];
    for (const [accountId, expected, label] of checks) {
      if (!accountId) continue;
      const account = await this.prisma.chartOfAccount.findFirst({
        where: { id: accountId, deletedAt: null },
        select: {
          code: true,
          name: true,
          accountType: true,
          allowsPosting: true,
        },
      });
      if (
        !account ||
        account.accountType !== expected ||
        !account.allowsPosting
      ) {
        throw new BadRequestException({
          code: 'PARTNER_ACCOUNT_INVALID',
          message: account
            ? `${label} must be a postable ${expected} account — ${account.code} ${account.name} is ${account.allowsPosting ? account.accountType : 'a group account'}.`
            : `${label}: account not found.`,
        });
      }
    }
    const fields = [
      'partnerProfitDistributionAccountId',
      'partnerProfitPayableAccountId',
    ] as const;
    const changing = fields.filter(
      (field) =>
        dto[field] !== undefined &&
        existing[field] != null &&
        (dto[field] ?? null) !== existing[field],
    );
    if (changing.length > 0) {
      const posted = await this.prisma.journalEntry.count({
        where: {
          deletedAt: null,
          sourceType: {
            in: [
              'PARTNER_PROFIT_DISTRIBUTION',
              'PARTNER_PROFIT_ADJUSTMENT',
              'PARTNER_PROFIT_PAYMENT',
            ],
          },
        },
      });
      if (posted > 0) {
        throw new ConflictException({
          code: 'PARTNER_ACCOUNTS_LOCKED',
          message:
            'لا يمكن تغيير حسابات أرباح الشركاء بعد ترحيل قيود عليها — The partner profit accounts cannot change once partner profit entries have been posted to them.',
          fields: changing.map((field) => ({
            field,
            constraints: ['lockedAfterPosting'],
          })),
        });
      }
    }
  }

  /**
   * The base currency is the unit every posted amount is stored in. Once it
   * is set and entries have been posted, changing it would silently
   * re-denominate history — so it can only be set the first time, or
   * changed while nothing has been posted yet.
   */
  private async assertFunctionalCurrencyChangeAllowed(
    current: string | null,
    next: string | null | undefined,
  ) {
    if (next === undefined || next === current || current === null) return;
    const posted = await this.prisma.journalEntry.count({
      where: { deletedAt: null, status: { not: JournalEntryStatus.DRAFT } },
    });
    if (posted > 0) {
      throw new BadRequestException({
        code: 'FUNCTIONAL_CURRENCY_LOCKED',
        message: `The base currency cannot be changed after ${posted} journal entries have been posted in it.`,
      });
    }
  }
}
