import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';
import {
  addCalendarDays,
  todayBusinessDate,
} from '../../common/time/business-date';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import {
  destinationKeyOf,
  shippingAgreementCoverage,
  tariffScopeOf,
} from '../pricing/agent-shipping-tariff';
import {
  SHIPPING_SERVICE_LABEL,
  type Bilingual,
  dateOnly,
  dayString,
  describeDestination,
  inForceWhere,
  overlappingRangeWhere,
  shippingAgreementDay,
} from './shipping-agreement-resolution';
import type {
  ActivateShippingAgreementDto,
  CreateShippingAgreementDto,
  DeactivateShippingAgreementDto,
  DuplicateShippingAgreementDto,
  ShippingAgreementRateDto,
  UpdateShippingAgreementDto,
} from './dto/shipping-agreement.dto';

type Tx = Prisma.TransactionClient;

/** MasterDataActivityLog entity type of the agreement's audit trail. */
export const SHIPPING_AGREEMENT_ENTITY = 'AGENT_SHIPPING_AGREEMENT';

const DETAIL_INCLUDE = {
  currency: { select: { id: true, code: true, name: true, symbol: true } },
  rates: {
    include: {
      country: { select: { id: true, code: true, name: true, nameEn: true } },
    },
    orderBy: [
      { countryId: { sort: 'asc', nulls: 'first' } },
      { city: 'asc' },
      { service: 'asc' },
    ],
  },
  supersedes: { select: { id: true, agreementNumber: true } },
  supersededBy: {
    select: { id: true, agreementNumber: true, effectiveFrom: true },
  },
} satisfies Prisma.AgentShippingAgreementInclude;

type DetailRow = Prisma.AgentShippingAgreementGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

interface NormalizedRate {
  service: DetailRow['rates'][number]['service'];
  countryId: string | null;
  city: string;
  destinationKey: string;
  amount: number;
}

const money = (value: number) => value.toFixed(2);

/**
 * The agent's shipping agreement document (R15 D15-13, spec-w3 §1):
 * DRAFT (editable, discardable) → ACTIVE (immutable; applies to orders dated
 * inside its range) → INACTIVE (deactivated, never applies again). At most
 * one ACTIVE agreement is in force per agent per day — activation is
 * serialized on the agent row and refuses overlaps unless the new agreement
 * replaces the earlier one from its start date. Every change is audited.
 * Orders snapshot the charge they were priced with, so nothing here ever
 * reprices an existing order.
 */
/**
 * Activity details are stored once, in both languages ("العربية — English"),
 * like the other R15 activity entries; dates are isolated left-to-right runs
 * so an Arabic line keeps "2026-10-08" intact.
 */
const LTR = (text: string) => `\u2066${text}\u2069`;
const day = (value: Date) => LTR(dayString(value));
function period(from: Date, to: Date | null): Bilingual {
  return {
    ar: `${day(from)} ← ${to ? day(to) : 'مفتوحة'}`,
    en: `${day(from)} → ${to ? day(to) : 'open'}`,
  };
}
function bilingual(ar: string | Bilingual, en?: string): string {
  return typeof ar === 'string' ? `${ar} — ${en}` : `${ar.ar} — ${ar.en}`;
}
function joinBilingual(
  a: Bilingual,
  b: Bilingual,
  arrowAr: string,
  arrowEn: string,
): string {
  return bilingual(`${a.ar}${arrowAr}${b.ar}`, `${a.en}${arrowEn}${b.en}`);
}
function suffixBilingual(a: Bilingual, ar: string, en: string): string {
  return bilingual(`${a.ar}${ar}`, `${a.en}${en}`);
}

@Injectable()
export class AgentShippingAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** History (newest first) + which agreement is in force today. */
  async list(agentId: string) {
    await this.requireAgent(agentId);
    const [items, inForce] = await Promise.all([
      this.prisma.agentShippingAgreement.findMany({
        where: { agentId, deletedAt: null },
        include: {
          currency: { select: { id: true, code: true, symbol: true } },
          supersedes: { select: { id: true, agreementNumber: true } },
          supersededBy: { select: { id: true, agreementNumber: true } },
          _count: { select: { rates: true } },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.agentShippingAgreement.findFirst({
        where: inForceWhere(agentId, shippingAgreementDay(new Date())),
        select: { id: true },
      }),
    ]);
    return {
      inForceId: inForce?.id ?? null,
      items: items.map(({ _count, ...row }) => ({
        ...row,
        rateCount: _count.rates,
      })),
    };
  }

  /** Rates, coverage matrix, activation check (drafts), who / when, audit trail. */
  async findOne(agentId: string, id: string) {
    const agreement = await this.prisma.agentShippingAgreement.findFirst({
      where: { id, agentId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!agreement) throw notFound();
    return this.present(agreement);
  }

  async create(
    agentId: string,
    dto: CreateShippingAgreementDto,
    userId: string,
  ) {
    const agent = await this.requireAgent(agentId);
    const effectiveFrom = dateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? dateOnly(dto.effectiveTo) : null;
    assertRange(effectiveFrom, effectiveTo);
    const rates = await this.normalizeRates(dto.rates ?? []);
    const id = await this.prisma.$transaction(async (tx) => {
      const agreementNumber = await this.numberingEngine.generateNumber(
        'AGENT_SHIPPING_AGREEMENT',
        undefined,
        tx,
      );
      const created = await tx.agentShippingAgreement.create({
        data: {
          agreementNumber,
          agentId,
          // Always the agent's settlement currency.
          currencyId: agent.currencyId,
          status: 'DRAFT',
          effectiveFrom,
          effectiveTo,
          notes: dto.notes ?? null,
          createdBy: userId,
          updatedBy: userId,
          rates: {
            create: rates.map((rate) => ({
              ...rate,
              createdBy: userId,
              updatedBy: userId,
            })),
          },
        },
      });
      await this.audit(
        tx,
        created.id,
        'CREATED',
        bilingual(
          `أُنشئت المسودة ${agreementNumber} (${period(effectiveFrom, effectiveTo).ar}، ${rates.length} رسم)`,
          `Draft ${agreementNumber} created (${period(effectiveFrom, effectiveTo).en}, ${rates.length} rate(s))`,
        ),
        userId,
        { agentId },
      );
      return created.id;
    });
    return this.findOne(agentId, id);
  }

  async update(
    agentId: string,
    id: string,
    dto: UpdateShippingAgreementDto,
    userId: string,
  ) {
    const existing = await this.requireDraft(agentId, id);
    const effectiveFrom = dto.effectiveFrom
      ? dateOnly(dto.effectiveFrom)
      : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? existing.effectiveTo
        : dto.effectiveTo
          ? dateOnly(dto.effectiveTo)
          : null;
    assertRange(effectiveFrom, effectiveTo);
    const notes =
      dto.notes === undefined ? existing.notes : dto.notes?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreement.update({
        where: { id },
        data: { effectiveFrom, effectiveTo, notes, updatedBy: userId },
      });
      await this.audit(
        tx,
        id,
        'UPDATED',
        bilingual(
          `الفترة ${period(effectiveFrom, effectiveTo).ar}${notes !== existing.notes ? '، وتغيّرت الملاحظات' : ''}`,
          `Dates ${period(effectiveFrom, effectiveTo).en}${notes !== existing.notes ? ', notes changed' : ''}`,
        ),
        userId,
      );
    });
    return this.findOne(agentId, id);
  }

  async addRate(
    agentId: string,
    id: string,
    dto: ShippingAgreementRateDto,
    userId: string,
  ) {
    await this.requireDraft(agentId, id);
    const [rate] = await this.normalizeRates([dto]);
    await this.assertNoDuplicate(id, rate, null);
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreementRate.create({
        data: {
          ...rate,
          shippingAgreementId: id,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit(
        tx,
        id,
        'RATE_ADDED',
        bilingual(await this.rateText(rate, money(rate.amount))),
        userId,
      );
    });
    return this.findOne(agentId, id);
  }

  async updateRate(
    agentId: string,
    id: string,
    rateId: string,
    dto: ShippingAgreementRateDto,
    userId: string,
  ) {
    await this.requireDraft(agentId, id);
    const current = await this.requireRate(id, rateId);
    const [rate] = await this.normalizeRates([dto]);
    await this.assertNoDuplicate(id, rate, rateId);
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreementRate.update({
        where: { id: rateId },
        data: { ...rate, updatedBy: userId },
      });
      await this.audit(
        tx,
        id,
        'RATE_UPDATED',
        joinBilingual(
          await this.rateText(current, money(Number(current.amount))),
          await this.rateText(rate, money(rate.amount)),
          ' ← ',
          ' → ',
        ),
        userId,
      );
    });
    return this.findOne(agentId, id);
  }

  async removeRate(
    agentId: string,
    id: string,
    rateId: string,
    userId: string,
  ) {
    await this.requireDraft(agentId, id);
    const current = await this.requireRate(id, rateId);
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreementRate.delete({ where: { id: rateId } });
      await this.audit(
        tx,
        id,
        'RATE_REMOVED',
        suffixBilingual(
          await this.rateText(current, money(Number(current.amount))),
          ' — حُذف',
          ' removed',
        ),
        userId,
      );
    });
    return this.findOne(agentId, id);
  }

  /** Discard a DRAFT (soft delete) — an activated agreement is never deleted. */
  async discard(agentId: string, id: string, userId: string) {
    const draft = await this.requireDraft(agentId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreement.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      await this.audit(
        tx,
        id,
        'DISCARDED',
        bilingual(
          `أُلغيت المسودة ${draft.agreementNumber}`,
          `Draft ${draft.agreementNumber} discarded`,
        ),
        userId,
      );
    });
    return { id, discarded: true };
  }

  /**
   * A new DRAFT with the same rates — the way an agreed charge changes:
   * duplicate, edit, then activate with "replace from". Starts tomorrow
   * (Cairo) unless a date is given.
   */
  async duplicate(
    agentId: string,
    id: string,
    dto: DuplicateShippingAgreementDto,
    userId: string,
  ) {
    const agent = await this.requireAgent(agentId);
    const source = await this.prisma.agentShippingAgreement.findFirst({
      where: { id, agentId, deletedAt: null },
      include: { rates: true },
    });
    if (!source) throw notFound();
    const effectiveFrom = dateOnly(
      dto.effectiveFrom ?? addCalendarDays(todayBusinessDate(), 1),
    );
    const newId = await this.prisma.$transaction(async (tx) => {
      const agreementNumber = await this.numberingEngine.generateNumber(
        'AGENT_SHIPPING_AGREEMENT',
        undefined,
        tx,
      );
      const created = await tx.agentShippingAgreement.create({
        data: {
          agreementNumber,
          agentId,
          currencyId: agent.currencyId,
          status: 'DRAFT',
          effectiveFrom,
          effectiveTo: null,
          notes: source.notes,
          createdBy: userId,
          updatedBy: userId,
          rates: {
            create: source.rates.map((rate) => ({
              service: rate.service,
              countryId: rate.countryId,
              city: rate.city,
              destinationKey: rate.destinationKey,
              amount: rate.amount,
              createdBy: userId,
              updatedBy: userId,
            })),
          },
        },
      });
      await this.audit(
        tx,
        created.id,
        'DUPLICATED',
        bilingual(
          `نُسخت المسودة ${agreementNumber} من ${source.agreementNumber} (${source.rates.length} رسم)، تبدأ ${day(effectiveFrom)}`,
          `Draft ${agreementNumber} duplicated from ${source.agreementNumber} (${source.rates.length} rate(s)), from ${day(effectiveFrom)}`,
        ),
        userId,
        { sourceId: source.id, agentId },
      );
      return created.id;
    });
    return this.findOne(agentId, newId);
  }

  /**
   * DRAFT → ACTIVE under the agent row lock: at least one rate, a valid
   * range, the agent's currency, and no other ACTIVE agreement overlapping
   * the range — unless `replaceFrom`, allowed when exactly one ACTIVE
   * agreement overlaps and it started earlier: it is closed the day before
   * this one starts, in the same transaction. Missing service × destination
   * combinations only warn (the returned coverage lists them).
   */
  async activate(
    agentId: string,
    id: string,
    dto: ActivateShippingAgreementDto,
    userId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agent = await tx.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: { currencyId: true },
      });
      if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
      const agreement = await tx.agentShippingAgreement.findFirst({
        where: { id, agentId, deletedAt: null },
        include: { _count: { select: { rates: true } } },
      });
      if (!agreement) throw notFound();
      if (agreement.status !== 'DRAFT') {
        throw agentConflict(
          'SHIPPING_AGREEMENT_NOT_DRAFT',
          'يمكن تفعيل مسودة اتفاقية الشحن فقط',
          'Only a DRAFT shipping agreement can be activated.',
        );
      }
      if (agreement.currencyId !== agent.currencyId) {
        throw agentUnprocessable(
          'CURRENCY_MISMATCH',
          'عملة اتفاقية الشحن يجب أن تساوي عملة تسوية الوكيل',
          'The shipping agreement currency must equal the agent’s settlement currency.',
        );
      }
      if (agreement._count.rates === 0) {
        throw agentUnprocessable(
          'SHIPPING_AGREEMENT_NO_RATES',
          'أضف سعرًا واحدًا على الأقل قبل التفعيل',
          'Add at least one rate before activation.',
        );
      }
      assertRange(agreement.effectiveFrom, agreement.effectiveTo);

      const overlapping = await this.overlapping(tx, agreement);
      let replaced: (typeof overlapping)[number] | null = null;
      if (overlapping.length > 0) {
        const canReplace = canReplaceFrom(agreement, overlapping);
        if (!dto.replaceFrom || !canReplace) {
          throw overlapError(overlapping, canReplace);
        }
        replaced = overlapping[0];
        const closeOn = dateOnly(
          addCalendarDays(dayString(agreement.effectiveFrom), -1),
        );
        await tx.agentShippingAgreement.update({
          where: { id: replaced.id },
          data: { effectiveTo: closeOn, updatedBy: userId },
        });
        await this.audit(
          tx,
          replaced.id,
          'REPLACED',
          bilingual(
            `أُغلقت في ${day(closeOn)} (كانت ${replaced.effectiveTo ? day(replaced.effectiveTo) : 'مفتوحة'}) — حلّت محلها ${agreement.agreementNumber} من ${day(agreement.effectiveFrom)}`,
            `Closed on ${day(closeOn)} (was ${replaced.effectiveTo ? day(replaced.effectiveTo) : 'open'}) — replaced by ${agreement.agreementNumber} from ${day(agreement.effectiveFrom)}`,
          ),
          userId,
          { replacedBy: agreement.id },
        );
      }
      await tx.agentShippingAgreement.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          activatedBy: userId,
          supersedesId: replaced?.id ?? null,
          updatedBy: userId,
        },
      });
      await this.audit(
        tx,
        id,
        'ACTIVATED',
        bilingual(
          `فُعّلت ${period(agreement.effectiveFrom, agreement.effectiveTo).ar}${replaced ? `، بدلًا من ${replaced.agreementNumber}` : ''}`,
          `Activated ${period(agreement.effectiveFrom, agreement.effectiveTo).en}${replaced ? `, replacing ${replaced.agreementNumber}` : ''}`,
        ),
        userId,
        replaced ? { supersedes: replaced.id } : undefined,
      );
    });
    return this.findOne(agentId, id);
  }

  /**
   * ACTIVE → INACTIVE (reason required). Never deleted; never applies to a
   * new order again. Orders already priced keep their snapshot.
   */
  async deactivate(
    agentId: string,
    id: string,
    dto: DeactivateShippingAgreementDto,
    userId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agreement = await tx.agentShippingAgreement.findFirst({
        where: { id, agentId, deletedAt: null },
        select: { status: true, agreementNumber: true },
      });
      if (!agreement) throw notFound();
      if (agreement.status !== 'ACTIVE') {
        throw agentConflict(
          'SHIPPING_AGREEMENT_NOT_ACTIVE',
          'يمكن إيقاف اتفاقية الشحن المفعّلة فقط',
          'Only an ACTIVE shipping agreement can be deactivated.',
        );
      }
      await tx.agentShippingAgreement.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          deactivatedAt: new Date(),
          deactivatedBy: userId,
          deactivationReason: dto.reason,
          updatedBy: userId,
        },
      });
      await this.audit(
        tx,
        id,
        'DEACTIVATED',
        bilingual(`أُوقفت: ${dto.reason}`, `Deactivated: ${dto.reason}`),
        userId,
      );
    });
    return this.findOne(agentId, id);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async present(agreement: DetailRow) {
    const rows = agreement.rates.map((rate) => ({
      id: rate.id,
      service: rate.service,
      countryId: rate.countryId,
      city: rate.city,
      amount: Number(rate.amount),
    }));
    const [activity, inForce, activation] = await Promise.all([
      this.activityLog.findForEntity(SHIPPING_AGREEMENT_ENTITY, agreement.id),
      this.prisma.agentShippingAgreement.findFirst({
        where: {
          id: agreement.id,
          ...inForceWhere(agreement.agentId, shippingAgreementDay(new Date())),
        },
        select: { id: true },
      }),
      agreement.status === 'DRAFT'
        ? this.activationCheck(agreement)
        : Promise.resolve(null),
    ]);
    const people = await this.userNames([
      agreement.createdBy,
      agreement.activatedBy,
      agreement.deactivatedBy,
      ...activity.map((entry) => entry.createdBy),
    ]);
    const { rates, ...head } = agreement;
    const countries = new Map(
      rates.flatMap((rate) =>
        rate.countryId && rate.country ? [[rate.countryId, rate.country]] : [],
      ),
    );
    const countryOf = (countryId: string | null) =>
      countryId ? (countries.get(countryId) ?? null) : null;
    const coverage = shippingAgreementCoverage(rows);
    // All destinations first, then by country name and city.
    const order = (d: { countryId: string | null; city: string }) =>
      d.countryId
        ? `1|${countryOf(d.countryId)?.name ?? ''}|${d.countryId}|${d.city.toLocaleLowerCase()}`
        : '0';
    return {
      ...head,
      inForceToday: inForce != null,
      createdByUser: people.get(agreement.createdBy ?? '') ?? null,
      activatedByUser: people.get(agreement.activatedBy ?? '') ?? null,
      deactivatedByUser: people.get(agreement.deactivatedBy ?? '') ?? null,
      rates: rates.map((rate) => ({
        id: rate.id,
        service: rate.service,
        countryId: rate.countryId,
        country: rate.country,
        city: rate.city,
        scope: tariffScopeOf(rate),
        amount: Number(rate.amount),
      })),
      coverage: {
        complete: coverage.complete,
        destinations: coverage.destinations
          .map((d) => ({ ...d, country: countryOf(d.countryId) }))
          .sort((a, b) => order(a).localeCompare(order(b))),
        missing: coverage.missing
          .map((m) => ({ ...m, country: countryOf(m.countryId) }))
          .sort((a, b) => order(a).localeCompare(order(b))),
      },
      activation,
      activity: activity.map((entry) => ({
        id: entry.id,
        type: entry.type,
        description: entry.description,
        createdAt: entry.createdAt,
        user: people.get(entry.createdBy ?? '') ?? null,
      })),
    };
  }

  /** What Activate would do now (shown before activating a draft). */
  private async activationCheck(agreement: DetailRow) {
    const overlapping = await this.overlapping(this.prisma, agreement);
    const problems: string[] = [];
    if (agreement.rates.length === 0)
      problems.push('SHIPPING_AGREEMENT_NO_RATES');
    const canReplace =
      overlapping.length > 0 && canReplaceFrom(agreement, overlapping);
    if (overlapping.length > 0 && !canReplace) {
      problems.push('SHIPPING_AGREEMENT_OVERLAP');
    }
    return {
      ready: problems.length === 0,
      problems,
      overlapping: overlapping.map(overlapRef),
      /** Activate with `replaceFrom: true` closes the overlapping agreement on this day. */
      replaceCloses: canReplace
        ? addCalendarDays(dayString(agreement.effectiveFrom), -1)
        : null,
    };
  }

  private overlapping(
    client: Tx | PrismaService,
    agreement: {
      id: string;
      agentId: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    },
  ) {
    return client.agentShippingAgreement.findMany({
      where: {
        agentId: agreement.agentId,
        id: { not: agreement.id },
        status: 'ACTIVE',
        deletedAt: null,
        ...overlappingRangeWhere(
          agreement.effectiveFrom,
          agreement.effectiveTo,
        ),
      },
      select: {
        id: true,
        agreementNumber: true,
        effectiveFrom: true,
        effectiveTo: true,
        supersededBy: { select: { id: true } },
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  /**
   * Validates and normalizes rows: country exists, a city needs its country
   * (trimmed, compared case-insensitively through the destination key), and
   * no two rows of the list share a service × destination.
   */
  private async normalizeRates(
    dtos: ShippingAgreementRateDto[],
  ): Promise<NormalizedRate[]> {
    const countryIds = [
      ...new Set(dtos.map((d) => d.countryId).filter((c): c is string => !!c)),
    ];
    const known = new Set(
      (
        await this.prisma.country.findMany({
          where: { id: { in: countryIds }, deletedAt: null },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    const seen = new Set<string>();
    return dtos.map((dto) => {
      const city = (dto.city ?? '').trim();
      const countryId = dto.countryId ?? null;
      if (city && !countryId) {
        throw agentUnprocessable(
          'SHIPPING_AGREEMENT_CITY_NEEDS_COUNTRY',
          'حدد دولة المدينة',
          'Choose the country of the city.',
        );
      }
      if (countryId && !known.has(countryId)) {
        throw agentUnprocessable(
          'COUNTRY_NOT_FOUND',
          'الدولة غير موجودة',
          'Country not found.',
        );
      }
      const destinationKey = destinationKeyOf(countryId, city);
      const key = `${dto.service}#${destinationKey}`;
      if (seen.has(key)) {
        throw agentConflict(
          'SHIPPING_AGREEMENT_RATE_DUPLICATE',
          `${SHIPPING_SERVICE_LABEL[dto.service].ar} مكرر لنفس الوجهة`,
          `${SHIPPING_SERVICE_LABEL[dto.service].en} is listed twice for the same destination.`,
        );
      }
      seen.add(key);
      return {
        service: dto.service,
        countryId,
        city,
        destinationKey,
        amount: dto.amount,
      };
    });
  }

  /** One row per service × destination; the existing row is named. */
  private async assertNoDuplicate(
    shippingAgreementId: string,
    rate: NormalizedRate,
    exceptRateId: string | null,
  ) {
    const existing = await this.prisma.agentShippingAgreementRate.findFirst({
      where: {
        shippingAgreementId,
        service: rate.service,
        destinationKey: rate.destinationKey,
        ...(exceptRateId ? { id: { not: exceptRateId } } : {}),
      },
    });
    if (!existing) return;
    const where = await describeDestination(this.prisma, existing);
    const service = SHIPPING_SERVICE_LABEL[existing.service];
    const amount = money(Number(existing.amount));
    throw agentConflict(
      'SHIPPING_AGREEMENT_RATE_DUPLICATE',
      `يوجد سعر ${service.ar} إلى ${where.ar} = ${amount} في هذه الاتفاقية؛ عدّل ذلك السطر`,
      `${service.en} to ${where.en} already has ${amount} in this agreement; edit that row.`,
      { existingRateId: existing.id },
    );
  }

  /** "<service> × <destination> = <amount>" in both languages (activity details). */
  private async rateText(
    rate: {
      service: NormalizedRate['service'];
      countryId: string | null;
      city: string;
    },
    amount: string,
  ): Promise<Bilingual> {
    const where = await describeDestination(this.prisma, rate);
    const service = SHIPPING_SERVICE_LABEL[rate.service];
    return {
      ar: `${service.ar} × ${where.ar} = ${amount}`,
      en: `${service.en} × ${where.en} = ${amount}`,
    };
  }

  private audit(
    tx: Tx,
    id: string,
    type: string,
    description: string,
    userId: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.activityLog.log(
      SHIPPING_AGREEMENT_ENTITY,
      id,
      type,
      description,
      userId,
      metadata,
      tx,
    );
  }

  private async userNames(ids: Array<string | null>) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    const users = wanted.length
      ? await this.prisma.user.findMany({
          where: { id: { in: wanted } },
          select: { id: true, fullName: true },
        })
      : [];
    return new Map(users.map((user) => [user.id, user]));
  }

  private async requireAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true, currencyId: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return agent;
  }

  private async requireDraft(agentId: string, id: string) {
    const agreement = await this.prisma.agentShippingAgreement.findFirst({
      where: { id, agentId, deletedAt: null },
    });
    if (!agreement) throw notFound();
    if (agreement.status !== 'DRAFT') {
      throw agentConflict(
        'SHIPPING_AGREEMENT_NOT_DRAFT',
        'اتفاقية الشحن المفعّلة لا تُعدَّل؛ انسخها كمسودة جديدة ثم فعّلها مع «الاستبدال من تاريخ»',
        'An activated shipping agreement is never edited; duplicate it as a new draft, then activate it with "replace from".',
      );
    }
    return agreement;
  }

  private async requireRate(shippingAgreementId: string, rateId: string) {
    const rate = await this.prisma.agentShippingAgreementRate.findFirst({
      where: { id: rateId, shippingAgreementId },
    });
    if (!rate) throw agentNotFoundError('Shipping rate', 'سعر الشحن');
    return rate;
  }
}

const notFound = () =>
  agentNotFoundError('Shipping agreement', 'اتفاقية الشحن');

function assertRange(from: Date, to: Date | null) {
  if (to && to < from) {
    throw agentUnprocessable(
      'SHIPPING_AGREEMENT_INVALID_RANGE',
      'تاريخ الانتهاء يسبق تاريخ البداية',
      'The end date is before the start date.',
    );
  }
}

interface OverlapRow {
  id: string;
  agreementNumber: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  supersededBy: { id: string } | null;
}

/**
 * "Replace from date" is unambiguous only when exactly one ACTIVE agreement
 * overlaps, it started earlier (so closing it the day before leaves it a
 * valid range) and no other agreement already replaced it.
 */
function canReplaceFrom(
  agreement: { effectiveFrom: Date },
  overlapping: OverlapRow[],
) {
  return (
    overlapping.length === 1 &&
    overlapping[0].effectiveFrom < agreement.effectiveFrom &&
    !overlapping[0].supersededBy
  );
}

const overlapRef = (row: OverlapRow) => ({
  id: row.id,
  agreementNumber: row.agreementNumber,
  effectiveFrom: dayString(row.effectiveFrom),
  effectiveTo: row.effectiveTo ? dayString(row.effectiveTo) : null,
});

function overlapError(overlapping: OverlapRow[], canReplace: boolean) {
  const names = overlapping
    .map(
      (row) =>
        `${row.agreementNumber} (${dayString(row.effectiveFrom)} → ${row.effectiveTo ? dayString(row.effectiveTo) : '∞'})`,
    )
    .join(', ');
  return agentConflict(
    'SHIPPING_AGREEMENT_OVERLAP',
    canReplace
      ? `فترة الاتفاقية تتداخل مع ${names}؛ فعّلها مع «الاستبدال من تاريخ» لإغلاق السابقة قبل يوم من البداية`
      : `فترة الاتفاقية تتداخل مع ${names}؛ عدّل التواريخ أو أوقف الاتفاقية المتداخلة`,
    canReplace
      ? `The agreement dates overlap ${names}; activate with "replace from" to close it the day before this one starts.`
      : `The agreement dates overlap ${names}; change the dates or deactivate the overlapping agreement.`,
    { overlapping: overlapping.map(overlapRef), canReplace },
  );
}
