import { Injectable } from '@nestjs/common';
import type { PartnerRequestContext } from '../auth/guards/jwt-auth.guard';
import { businessDateOf } from '../common/time/business-date';
import {
  CompanyPartnersService,
  agreementView,
} from '../company-partners/company-partners.service';
import {
  type StatementPeriodRow,
  PartnerStatementService,
} from '../company-partners/partner-statement.service';
import { PartnerPaymentsService } from '../company-partners/partner-payments.service';
import { rangesOverlap } from '../company-partners/partner-profit-calculator';

type AgreementView = ReturnType<typeof agreementView>;

/** The terms a partner sees of its own agreement — no notes, ids or audit fields. */
function termsView(agreement: AgreementView) {
  return {
    profitSharePercent: agreement.profitSharePercent,
    basis: agreement.basis,
    frequency: agreement.frequency,
    status: agreement.status,
    effectiveFrom: agreement.effectiveFrom,
    effectiveTo: agreement.effectiveTo,
  };
}

/**
 * R15 (D15-14, spec-w4 §2) — what a company partner's own login may read.
 * Every method is scoped by the server-verified `PartnerRequestContext`
 * (never a URL / query / body id) and returns an explicit partner-safe
 * projection of the shared statement computation: this partner only, no
 * journal entry, no account code or name, no other partner, no customer or
 * document record, and of the company figures only the profit lines the
 * partner's agreement uses.
 */
@Injectable()
export class PartnerPortalService {
  constructor(
    private readonly partners: CompanyPartnersService,
    private readonly statements: PartnerStatementService,
    private readonly payments: PartnerPaymentsService,
  ) {}

  /** Identity, partnership span / status, terms and the login itself. */
  async me(partner: PartnerRequestContext) {
    const profile = await this.partners.findOne(partner.partnerId);
    const today = businessDateOf(new Date());
    const agreements = profile.agreements.filter((a) => a.status !== 'DRAFT');
    const current =
      agreements.find((a) =>
        rangesOverlap(a.effectiveFrom, a.effectiveTo, today, today),
      ) ??
      agreements[0] ??
      null;
    return {
      partner: { name: profile.name, partnerNumber: profile.partnerNumber },
      partnership: profile.partnership,
      currentAgreement: current ? termsView(current) : null,
      agreements: agreements.map(termsView),
      login: profile.login
        ? {
            email: profile.login.email,
            fullName: profile.login.fullName,
            lastLoginAt: profile.login.lastLoginAt,
          }
        : null,
    };
  }

  /** Overview figures: the latest period, provisional vs approved, paid, still payable / advance. */
  async summary(partner: PartnerRequestContext) {
    const statement = await this.statements.periodStatement(partner.partnerId);
    // The latest recorded payment — the same set "paid" counts (a payment is
    // recorded once, whatever its value date), so the two never disagree.
    const [lastPayment] = await this.payments.history(partner.partnerId, {
      from: statement.partnership.startedOn ?? statement.range.from,
      to: '9999-12-31',
    });
    return {
      currency: statement.currency,
      partnership: statement.partnership,
      range: statement.range,
      currentPeriod: statement.periods.at(-1) ?? null,
      estimated: statement.totals.estimated,
      position: statement.position,
      lastPayment: lastPayment
        ? {
            date: lastPayment.date,
            amount: lastPayment.amount,
            method: lastPayment.method,
            reversed: lastPayment.reversed,
          }
        : null,
    };
  }

  /** Every reviewed / closed period of the partner, newest first. */
  periods(partner: PartnerRequestContext): Promise<StatementPeriodRow[]> {
    return this.statements.savedPeriods(partner.partnerId);
  }

  /** One reviewed / closed period (404 unless the partner has a share in it). */
  period(partner: PartnerRequestContext, periodId: string) {
    return this.statements.savedPeriod(partner.partnerId, periodId);
  }

  /** The per-period statement of a range, with payment and adjustment history. */
  async statement(
    partner: PartnerRequestContext,
    range: { from?: string; to?: string },
  ) {
    const statement = await this.statements.periodStatement(
      partner.partnerId,
      range.from,
      range.to,
    );
    const { from, to } = statement.range;
    const [profile, payments] = await Promise.all([
      this.partners.findOne(partner.partnerId),
      this.payments.history(partner.partnerId, { from, to }),
    ]);
    return {
      partner: { name: profile.name, partnerNumber: profile.partnerNumber },
      range: statement.range,
      currency: statement.currency,
      partnership: statement.partnership,
      terms: profile.agreements
        .filter(
          (a) =>
            a.status !== 'DRAFT' &&
            rangesOverlap(a.effectiveFrom, a.effectiveTo, from, to),
        )
        .map(termsView),
      periods: statement.periods,
      totals: statement.totals,
      adjustments: statement.adjustments.map((adjustment) => ({
        periodId: adjustment.periodId,
        periodFrom: adjustment.periodFrom,
        periodTo: adjustment.periodTo,
        date: adjustment.date,
        reason: adjustment.reason,
        amount: adjustment.amount,
      })),
      payments,
      position: statement.position,
    };
  }
}
