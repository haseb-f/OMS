import { Injectable } from '@nestjs/common';
import { Prisma, type AgentAgreement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { activeAgreementWhere, toDateOnly } from './agents.service';
import type {
  CreateAgreementDto,
  EndAgreementDto,
  UpdateAgreementDto,
  UpsertShippingRateDto,
} from './dto/agreement.dto';

type Client = Prisma.TransactionClient | PrismaService;

/**
 * The agreement in force for `agentId` on `date` (spec §2), or null. Used by
 * order creation (snapshot source) and the finance hooks.
 */
export async function resolveActiveAgreement(
  agentId: string,
  date: Date,
  client: Client,
): Promise<AgentAgreement | null> {
  return client.agentAgreement.findFirst({
    where: { agentId, ...activeAgreementWhere(date) },
    orderBy: { effectiveFrom: 'desc' },
  });
}

export interface ResolvedShippingRate {
  id: string;
  amount: number;
  countryId: string;
  /** '' = the whole-country rate. */
  city: string;
}

const normalizeCity = (city: string | null | undefined) =>
  (city ?? '').trim().toLocaleLowerCase();

/**
 * Configured customer shipping charge (spec §5): the destination city's row
 * wins, else the country row, else null — never a guessed amount.
 */
export async function resolveShippingRate(
  agreement: { id: string },
  countryId: string,
  city: string | null | undefined,
  client: Client,
): Promise<ResolvedShippingRate | null> {
  const rows = await client.agentShippingRate.findMany({
    where: { agreementId: agreement.id, countryId },
  });
  const wanted = normalizeCity(city);
  const cityRow = wanted
    ? rows.find((row) => normalizeCity(row.city) === wanted)
    : undefined;
  const row = cityRow ?? rows.find((r) => normalizeCity(r.city) === '');
  if (!row) return null;
  return {
    id: row.id,
    amount: Number(row.amount),
    countryId: row.countryId,
    city: row.city,
  };
}

const AGREEMENT_INCLUDE = {
  currency: { select: { id: true, code: true, name: true, symbol: true } },
  shippingRates: {
    include: {
      country: { select: { id: true, code: true, name: true, nameEn: true } },
    },
    orderBy: [{ countryId: 'asc' as const }, { city: 'asc' as const }],
  },
  _count: { select: { storeOrders: true } },
} satisfies Prisma.AgentAgreementInclude;

/**
 * Effective-dated agent agreements (spec §2). DRAFT is editable; ACTIVE
 * terms and rates are immutable (change = end it and create a new one);
 * ENDED keeps its fixed last day. Active ranges of one agent never overlap —
 * activation is serialized on the agent row.
 */
@Injectable()
export class AgentAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
  ) {}

  async list(agentId: string) {
    await this.requireAgent(agentId);
    return this.prisma.agentAgreement.findMany({
      where: { agentId },
      include: AGREEMENT_INCLUDE,
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(agentId: string, agreementId: string) {
    const agreement = await this.prisma.agentAgreement.findFirst({
      where: { id: agreementId, agentId },
      include: AGREEMENT_INCLUDE,
    });
    if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
    return agreement;
  }

  async create(agentId: string, dto: CreateAgreementDto, userId: string) {
    const agent = await this.requireAgent(agentId);
    const currencyId = dto.currencyId ?? agent.currencyId;
    this.assertCurrency(currencyId, agent.currencyId);
    this.assertRange(dto.effectiveFrom, dto.effectiveTo);
    const agreement = await this.prisma.$transaction(async (tx) => {
      const agreementNumber = await this.numberingEngine.generateNumber(
        'AGENT_AGREEMENT',
        undefined,
        tx,
      );
      return tx.agentAgreement.create({
        data: {
          agentId,
          agreementNumber,
          status: 'DRAFT',
          effectiveFrom: toDateOnly(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? toDateOnly(dto.effectiveTo) : null,
          currencyId,
          commissionRatePercent: dto.commissionRatePercent,
          commissionEarningEvent: dto.commissionEarningEvent,
          returnCommissionTreatment: dto.returnCommissionTreatment,
          customerShippingChargeOwner: dto.customerShippingChargeOwner,
          providerFeesBorneBy: dto.providerFeesBorneBy,
          shippingFeePerShipment: dto.shippingFeePerShipment,
          returnFeePerShipment: dto.returnFeePerShipment,
          serviceFeePerOrder: dto.serviceFeePerOrder,
          allowAgentDestinations: dto.allowAgentDestinations,
          payoutHoldDays: dto.payoutHoldDays,
          notes: dto.notes,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    });
    return this.findOne(agentId, agreement.id);
  }

  async update(
    agentId: string,
    agreementId: string,
    dto: UpdateAgreementDto,
    userId: string,
  ) {
    const agent = await this.requireAgent(agentId);
    const existing = await this.requireDraft(agentId, agreementId);
    if (dto.currencyId) this.assertCurrency(dto.currencyId, agent.currencyId);
    const from = dto.effectiveFrom ?? existing.effectiveFrom.toISOString();
    const to =
      dto.effectiveTo !== undefined
        ? dto.effectiveTo
        : existing.effectiveTo?.toISOString();
    this.assertRange(from, to);
    await this.prisma.agentAgreement.update({
      where: { id: agreementId },
      data: {
        effectiveFrom: dto.effectiveFrom
          ? toDateOnly(dto.effectiveFrom)
          : undefined,
        effectiveTo:
          dto.effectiveTo !== undefined
            ? dto.effectiveTo
              ? toDateOnly(dto.effectiveTo)
              : null
            : undefined,
        currencyId: dto.currencyId,
        commissionRatePercent: dto.commissionRatePercent,
        commissionEarningEvent: dto.commissionEarningEvent,
        returnCommissionTreatment: dto.returnCommissionTreatment,
        customerShippingChargeOwner: dto.customerShippingChargeOwner,
        providerFeesBorneBy: dto.providerFeesBorneBy,
        shippingFeePerShipment: dto.shippingFeePerShipment,
        returnFeePerShipment: dto.returnFeePerShipment,
        serviceFeePerOrder: dto.serviceFeePerOrder,
        allowAgentDestinations: dto.allowAgentDestinations,
        payoutHoldDays: dto.payoutHoldDays,
        notes: dto.notes,
        updatedBy: userId,
      },
    });
    return this.findOne(agentId, agreementId);
  }

  /**
   * DRAFT → ACTIVE. Every term is re-validated as explicit and in range,
   * and the range must not overlap any other activated agreement of the
   * agent. The agent row is locked FOR UPDATE so two concurrent activations
   * cannot both pass the overlap check.
   */
  async activate(agentId: string, agreementId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agent = await tx.agent.findFirst({
        where: { id: agentId, deletedAt: null },
      });
      if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
      const agreement = await tx.agentAgreement.findFirst({
        where: { id: agreementId, agentId },
      });
      if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
      if (agreement.status !== 'DRAFT') {
        throw agentConflict(
          'AGREEMENT_NOT_DRAFT',
          'يمكن تفعيل الاتفاقيات المسودة فقط',
          'Only a DRAFT agreement can be activated.',
        );
      }
      this.assertCurrency(agreement.currencyId, agent.currencyId);
      assertExplicitTerms(agreement);
      const overlapping = await tx.agentAgreement.findFirst({
        where: {
          agentId,
          id: { not: agreementId },
          status: { in: ['ACTIVE', 'ENDED'] },
          ...overlapWhere(agreement.effectiveFrom, agreement.effectiveTo),
        },
        select: { agreementNumber: true },
      });
      if (overlapping) {
        throw agentConflict(
          'AGREEMENT_OVERLAP',
          `فترة الاتفاقية تتداخل مع الاتفاقية ${overlapping.agreementNumber}`,
          `The agreement dates overlap agreement ${overlapping.agreementNumber}. End it first or choose non-overlapping dates.`,
        );
      }
      await tx.agentAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          activatedBy: userId,
          updatedBy: userId,
        },
      });
    });
    return this.findOne(agentId, agreementId);
  }

  /**
   * Fixes the last day of an ACTIVE agreement (only shortening — an end
   * date can never extend over a later agreement). Existing orders keep
   * their snapshots.
   */
  async end(
    agentId: string,
    agreementId: string,
    dto: EndAgreementDto,
    userId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agreement = await tx.agentAgreement.findFirst({
        where: { id: agreementId, agentId },
      });
      if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
      if (agreement.status !== 'ACTIVE') {
        throw agentConflict(
          'AGREEMENT_NOT_ACTIVE',
          'يمكن إنهاء الاتفاقيات النشطة فقط',
          'Only an ACTIVE agreement can be ended.',
        );
      }
      const effectiveTo = toDateOnly(dto.effectiveTo ?? new Date());
      if (effectiveTo < agreement.effectiveFrom) {
        throw agentUnprocessable(
          'AGREEMENT_INVALID_RANGE',
          'تاريخ الانتهاء يسبق تاريخ البداية',
          'The end date is before the agreement start date.',
        );
      }
      if (agreement.effectiveTo && effectiveTo > agreement.effectiveTo) {
        throw agentUnprocessable(
          'AGREEMENT_END_EXTENDS',
          'لا يمكن تمديد الاتفاقية عند إنهائها',
          'Ending cannot extend the agreement beyond its current last day.',
        );
      }
      await tx.agentAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'ENDED',
          effectiveTo,
          endedAt: new Date(),
          updatedBy: userId,
        },
      });
    });
    return this.findOne(agentId, agreementId);
  }

  // ── Shipping rates (DRAFT agreements only) ──────────────────────────────

  async upsertShippingRate(
    agentId: string,
    agreementId: string,
    dto: UpsertShippingRateDto,
  ) {
    await this.requireDraft(agentId, agreementId);
    const country = await this.prisma.country.findFirst({
      where: { id: dto.countryId, deletedAt: null },
      select: { id: true },
    });
    if (!country) {
      throw agentUnprocessable(
        'COUNTRY_NOT_FOUND',
        'الدولة غير موجودة',
        'Country not found.',
      );
    }
    const city = (dto.city ?? '').trim();
    const existing = (
      await this.prisma.agentShippingRate.findMany({
        where: { agreementId, countryId: dto.countryId },
      })
    ).find((row) => normalizeCity(row.city) === normalizeCity(city));
    if (existing) {
      await this.prisma.agentShippingRate.update({
        where: { id: existing.id },
        data: { amount: dto.amount },
      });
    } else {
      await this.prisma.agentShippingRate.create({
        data: {
          agreementId,
          countryId: dto.countryId,
          city,
          amount: dto.amount,
        },
      });
    }
    return this.findOne(agentId, agreementId);
  }

  async removeShippingRate(
    agentId: string,
    agreementId: string,
    rateId: string,
  ) {
    await this.requireDraft(agentId, agreementId);
    const deleted = await this.prisma.agentShippingRate.deleteMany({
      where: { id: rateId, agreementId },
    });
    if (deleted.count === 0) {
      throw agentNotFoundError('Shipping rate', 'سعر الشحن');
    }
    return this.findOne(agentId, agreementId);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async requireAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return agent;
  }

  private async requireDraft(agentId: string, agreementId: string) {
    const agreement = await this.prisma.agentAgreement.findFirst({
      where: { id: agreementId, agentId },
    });
    if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
    if (agreement.status !== 'DRAFT') {
      throw agentConflict(
        'AGREEMENT_IMMUTABLE',
        'شروط الاتفاقية المفعّلة وأسعار الشحن فيها لا تتغير؛ أنهِها وأنشئ اتفاقية جديدة',
        'An activated agreement’s terms and shipping rates are immutable — end it and create a new agreement.',
      );
    }
    return agreement;
  }

  private assertCurrency(currencyId: string, agentCurrencyId: string) {
    if (currencyId !== agentCurrencyId) {
      throw agentUnprocessable(
        'CURRENCY_MISMATCH',
        'عملة الاتفاقية يجب أن تساوي عملة تسوية الوكيل',
        'The agreement currency must equal the agent’s settlement currency.',
      );
    }
  }

  private assertRange(from: string, to: string | null | undefined) {
    if (to && toDateOnly(to) < toDateOnly(from)) {
      throw agentUnprocessable(
        'AGREEMENT_INVALID_RANGE',
        'تاريخ الانتهاء يسبق تاريخ البداية',
        'The end date is before the agreement start date.',
      );
    }
  }
}

/** Ranges [from, to|∞] overlap the given [from, to|∞]. */
function overlapWhere(
  from: Date,
  to: Date | null,
): Prisma.AgentAgreementWhereInput {
  return {
    AND: [
      // other.from ≤ this.to (or this is open-ended)
      ...(to ? [{ effectiveFrom: { lte: to } }] : []),
      // other.to ≥ this.from (or other is open-ended)
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
    ],
  };
}

/** Defense in depth: every term present and in range before activation (D3). */
function assertExplicitTerms(agreement: AgentAgreement) {
  const missing: string[] = [];
  const rate = Number(agreement.commissionRatePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    missing.push('commissionRatePercent');
  }
  for (const key of [
    'shippingFeePerShipment',
    'returnFeePerShipment',
    'serviceFeePerOrder',
  ] as const) {
    const value = Number(agreement[key]);
    if (!Number.isFinite(value) || value < 0) missing.push(key);
  }
  for (const key of [
    'commissionEarningEvent',
    'returnCommissionTreatment',
    'customerShippingChargeOwner',
    'providerFeesBorneBy',
  ] as const) {
    if (!agreement[key]) missing.push(key);
  }
  if (!(agreement.payoutHoldDays >= 0)) missing.push('payoutHoldDays');
  if (missing.length > 0) {
    throw agentUnprocessable(
      'AGREEMENT_TERMS_INCOMPLETE',
      'أكمل جميع شروط الاتفاقية قبل التفعيل',
      'Complete every agreement term before activation.',
      { fields: missing },
    );
  }
}
