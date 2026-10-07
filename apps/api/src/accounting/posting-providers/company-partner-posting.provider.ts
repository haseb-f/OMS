import { Injectable, OnModuleInit } from '@nestjs/common';
import { PartnerEntitlementKind, Prisma } from '@prisma/client';
import { PostingEngineService } from '../posting-engine/posting-engine.service';
import { AccountMappingService } from '../account-mapping/account-mapping.service';
import type {
  PostingLine,
  PostingProvider,
  PostingResult,
} from '../posting-engine/posting-provider.interface';
import {
  PARTNER_PROFIT_ADJUSTMENT,
  PARTNER_PROFIT_DISTRIBUTION,
  PARTNER_PROFIT_PAYMENT,
  resolvePartnerProfitAccounts,
} from '../../company-partners/company-partner-accounts';
import { round2HalfUp } from '../../company-partners/partner-profit-calculator';

/**
 * R14 W5 (spec-5 §5) — company partner profit sharing. Amounts are in the
 * functional currency (Settings base currency); every partner line carries
 * the Partner dimension. Equity / liability accounts only — a distribution
 * of profit is never an expense, so it cannot feed back into the profit it
 * is computed from.
 *
 * Period closed:       Dr Partner profit distribution (equity)  Cr Partner profit payable (one line per partner)
 * Period adjustment:   the per-partner DIFFERENCE only — a positive delta credits the payable, a negative one debits it;
 *                      the net goes to the distribution account
 * Payment:             Dr Partner profit payable (partner)  Cr financial account (cash / bank)
 */
@Injectable()
export class CompanyPartnerPostingProvider
  implements PostingProvider, OnModuleInit
{
  readonly sourceTypes = [
    PARTNER_PROFIT_DISTRIBUTION,
    PARTNER_PROFIT_ADJUSTMENT,
    PARTNER_PROFIT_PAYMENT,
  ];

  constructor(
    private readonly postingEngine: PostingEngineService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  onModuleInit() {
    this.postingEngine.registerProvider(this);
  }

  async buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    switch (sourceType) {
      case PARTNER_PROFIT_DISTRIBUTION:
        return this.buildDistribution(sourceId, tx);
      case PARTNER_PROFIT_ADJUSTMENT:
        return this.buildAdjustment(sourceId, tx);
      case PARTNER_PROFIT_PAYMENT:
        return this.buildPayment(sourceId, tx);
      default:
        return null;
    }
  }

  private async functionalCurrencyId(tx: Prisma.TransactionClient) {
    const settings = await tx.postingSettings.findFirst({
      select: { functionalCurrencyId: true },
    });
    return settings?.functionalCurrencyId ?? null;
  }

  /** Σ amount per partner of the given entitlement rows, rounded to cents. */
  private sumByPartner(rows: Array<{ partnerId: string; amount: unknown }>) {
    const totals = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      totals.set(
        row.partnerId,
        (totals.get(row.partnerId) ?? new Prisma.Decimal(0)).add(
          new Prisma.Decimal(String(row.amount)),
        ),
      );
    }
    return [...totals].map(([partnerId, total]) => ({
      partnerId,
      amount: round2HalfUp(total),
    }));
  }

  private partnerLines(
    totals: Array<{ partnerId: string; amount: number }>,
    accounts: { distributionAccountId: string; payableAccountId: string },
    description: string,
  ): PostingLine[] {
    const nonZero = totals.filter((t) => t.amount !== 0);
    const net = round2HalfUp(
      nonZero.reduce((s, t) => s.add(t.amount), new Prisma.Decimal(0)),
    );
    const lines: PostingLine[] = [];
    if (net > 0) {
      lines.push({
        accountId: accounts.distributionAccountId,
        debit: net,
        description,
      });
    } else if (net < 0) {
      lines.push({
        accountId: accounts.distributionAccountId,
        credit: -net,
        description,
      });
    }
    for (const total of nonZero) {
      lines.push(
        total.amount > 0
          ? {
              accountId: accounts.payableAccountId,
              credit: total.amount,
              description: `${description} — partner share`,
              partnerId: total.partnerId,
            }
          : {
              accountId: accounts.payableAccountId,
              debit: -total.amount,
              description: `${description} — partner share`,
              partnerId: total.partnerId,
            },
      );
    }
    return lines;
  }

  private async buildDistribution(
    periodId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const period = await tx.partnerProfitPeriod.findUniqueOrThrow({
      where: { id: periodId },
      include: {
        entitlements: { where: { kind: PartnerEntitlementKind.ORIGINAL } },
      },
    });
    const totals = this.sumByPartner(period.entitlements);
    if (totals.every((t) => t.amount === 0)) return null;
    const accounts = await resolvePartnerProfitAccounts(
      this.accountMapping,
      tx,
    );
    const label = `${period.periodFrom.toISOString().slice(0, 10)} → ${period.periodTo.toISOString().slice(0, 10)}`;
    return {
      lines: this.partnerLines(
        totals,
        accounts,
        `Partner profit distribution ${label}`,
      ),
      description: `Partner profit distribution ${label}`,
      referenceNumber: `PPD ${label}`,
      currencyId: await this.functionalCurrencyId(tx),
      exchangeRate: 1,
      entryDate: period.periodTo,
    };
  }

  private async buildAdjustment(
    adjustmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const adjustment = await tx.partnerProfitAdjustment.findUniqueOrThrow({
      where: { id: adjustmentId },
      include: { entitlements: true, period: true },
    });
    const totals = this.sumByPartner(adjustment.entitlements);
    if (totals.every((t) => t.amount === 0)) return null;
    const accounts = await resolvePartnerProfitAccounts(
      this.accountMapping,
      tx,
    );
    const label = `${adjustment.period.periodFrom.toISOString().slice(0, 10)} → ${adjustment.period.periodTo.toISOString().slice(0, 10)}`;
    return {
      lines: this.partnerLines(
        totals,
        accounts,
        `Partner profit adjustment ${label}`,
      ),
      description: `Partner profit adjustment ${label}: ${adjustment.reason}`,
      referenceNumber: `PPD ${label}`,
      currencyId: await this.functionalCurrencyId(tx),
      exchangeRate: 1,
      entryDate: adjustment.entryDate,
    };
  }

  private async buildPayment(
    paymentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<PostingResult | null> {
    const payment = await tx.partnerPayment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const amount = Number(payment.amount);
    if (amount === 0) return null;
    const accounts = await resolvePartnerProfitAccounts(
      this.accountMapping,
      tx,
    );
    return {
      lines: [
        {
          accountId: accounts.payableAccountId,
          debit: amount,
          description: `Partner profit payment ${payment.paymentNumber}`,
          partnerId: payment.partnerId,
        },
        {
          accountId: payment.financialAccountId,
          credit: amount,
          description: `Partner profit payment ${payment.paymentNumber}`,
        },
      ],
      description: `Partner profit payment ${payment.paymentNumber}`,
      referenceNumber: payment.paymentNumber,
      currencyId: await this.functionalCurrencyId(tx),
      exchangeRate: 1,
      entryDate: payment.date,
    };
  }
}
