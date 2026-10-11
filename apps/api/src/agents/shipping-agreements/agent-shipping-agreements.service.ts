import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';
import {
  addCalendarDays,
  businessDayStart,
  todayBusinessDate,
} from '../../common/time/business-date';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import {
  destinationKeyOf,
  isCodService,
  shippingAgreementCoverage,
  tariffScopeOf,
} from '../pricing/agent-shipping-tariff';
import {
  SHIPPING_SERVICE_LABEL,
  type Bilingual,
  dateOnly,
  dayString,
  describeDestination,
  inForceAtWhere,
  overlappingRangeWhere,
  shippingAgreementDay,
} from './shipping-agreement-resolution';
import type {
  ActivateShippingAgreementDto,
  CreateShippingAgreementDto,
  DeactivateShippingAgreementDto,
  DuplicateShippingAgreementDto,
  ShippingAgreementRateDto,
  ShippingAgreementVersionDto,
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
  supersedes: {
    select: { id: true, agreementNumber: true, versionNumber: true },
  },
  supersededBy: {
    select: {
      id: true,
      agreementNumber: true,
      versionNumber: true,
      effectiveFrom: true,
      activeFrom: true,
    },
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
  codFee: DetailRow['rates'][number]['codFee'];
}

const money = (value: number) => value.toFixed(2);
const decimalOrNull = (value: Prisma.Decimal | null) =>
  value == null ? null : Number(value);
/** First instant of a shipping agreement's (Cairo) start day. */
const dayStartOf = (effectiveFrom: Date) =>
  businessDayStart(dayString(effectiveFrom));

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
        orderBy: [
          { effectiveFrom: 'desc' },
          { versionNumber: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.agentShippingAgreement.findFirst({
        where: inForceAtWhere(agentId, new Date()),
        select: { id: true },
      }),
    ]);
    return {
      inForceId: inForce?.id ?? null,
      items: items.map(({ _count, ...row }) => ({
        ...row,
        codCollectionFee: decimalOrNull(row.codCollectionFee),
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
          codCollectionFee: dto.codCollectionFee ?? null,
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
    const codCollectionFee =
      dto.codCollectionFee === undefined
        ? decimalOrNull(existing.codCollectionFee)
        : dto.codCollectionFee;
    // R17 compact form: the complete rate list replaces the draft's rows.
    const rates = dto.rates ? await this.normalizeRates(dto.rates) : null;
    const before = rates
      ? await this.prisma.agentShippingAgreementRate.findMany({
          where: { shippingAgreementId: id },
        })
      : [];
    const diff = rates
      ? await this.termsDiff(
          {
            codCollectionFee: decimalOrNull(existing.codCollectionFee),
            notes: existing.notes,
            rates: before.map(normalizedFromRow),
          },
          { codCollectionFee, notes, rates },
        )
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.agentShippingAgreement.update({
        where: { id },
        data: {
          effectiveFrom,
          effectiveTo,
          notes,
          codCollectionFee,
          updatedBy: userId,
        },
      });
      if (rates) {
        await tx.agentShippingAgreementRate.deleteMany({
          where: { shippingAgreementId: id },
        });
        await tx.agentShippingAgreementRate.createMany({
          data: rates.map((rate) => ({
            ...rate,
            shippingAgreementId: id,
            createdBy: userId,
            updatedBy: userId,
          })),
        });
      }
      const feeChanged =
        codCollectionFee !== decimalOrNull(existing.codCollectionFee);
      await this.audit(
        tx,
        id,
        'UPDATED',
        bilingual(
          `الفترة ${period(effectiveFrom, effectiveTo).ar}${notes !== existing.notes ? '، وتغيّرت الملاحظات' : ''}${feeChanged ? `، رسوم التحصيل ${feeText(codCollectionFee).ar}` : ''}${diff?.text.length ? `؛ ${diff.text.map((t) => t.ar).join('؛ ')}` : ''}`,
          `Dates ${period(effectiveFrom, effectiveTo).en}${notes !== existing.notes ? ', notes changed' : ''}${feeChanged ? `, COD collection fee ${feeText(codCollectionFee).en}` : ''}${diff?.text.length ? `; ${diff.text.map((t) => t.en).join('; ')}` : ''}`,
        ),
        userId,
        diff ? { changes: diff.changes } : undefined,
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
        bilingual(await this.rateText(rate, rateAmountText(rate))),
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
          await this.rateText(
            normalizedFromRow(current),
            rateAmountText(normalizedFromRow(current)),
          ),
          await this.rateText(rate, rateAmountText(rate)),
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
          codCollectionFee: source.codCollectionFee,
          createdBy: userId,
          updatedBy: userId,
          rates: {
            create: source.rates.map((rate) => ({
              service: rate.service,
              countryId: rate.countryId,
              city: rate.city,
              destinationKey: rate.destinationKey,
              amount: rate.amount,
              codFee: rate.codFee,
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
          // R17 §2 — a day-dated version is in force from its first instant.
          activeFrom: dayStartOf(agreement.effectiveFrom),
          versionNumber: replaced ? replaced.versionNumber + 1 : 1,
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
   * R17 §2 — "Edit" on the ACTIVE agreement in force now. Under the agent
   * row lock, at the save instant t: a new ACTIVE version (copy + the new
   * terms, version + 1, `supersedes` = the current one) is in force from t
   * (`activeFrom = t`, Cairo day of t → the current end date); the current
   * version closes at t (`activeTo = t`, last day = the day of t) and stays
   * read-only with its full content. A planned successor of the current
   * version moves onto the new one. Exactly one version is in force at t
   * before and after (validated). Orders already submitted keep their
   * snapshot — nothing is repriced. Both versions are audited with the field
   * diff (MasterDataActivityLog).
   */
  async createVersion(
    agentId: string,
    id: string,
    dto: ShippingAgreementVersionDto,
    userId: string,
  ) {
    const rates = await this.normalizeRates(dto.rates);
    const newId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agent = await tx.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: { currencyId: true },
      });
      if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
      const current = await tx.agentShippingAgreement.findFirst({
        where: { id, agentId, deletedAt: null },
        include: {
          rates: true,
          supersededBy: { select: { id: true } },
        },
      });
      if (!current) throw notFound();
      const at = new Date();
      const inForce = await tx.agentShippingAgreement.findMany({
        where: inForceAtWhere(agentId, at),
        select: { id: true },
      });
      if (
        current.status !== 'ACTIVE' ||
        !inForce.some((row) => row.id === id)
      ) {
        throw agentConflict(
          'SHIPPING_AGREEMENT_NOT_IN_FORCE',
          'يُعدَّل فقط إصدار اتفاقية الشحن الساري الآن؛ المسودات تُعدَّل مباشرة والإصدارات المغلقة للقراءة فقط',
          'Only the shipping agreement version in force now can be edited; drafts are edited directly and closed versions are read-only.',
        );
      }
      if (inForce.length !== 1) {
        throw agentConflict(
          'SHIPPING_AGREEMENT_VERSION_OVERLAP',
          'أكثر من إصدار ساري في اللحظة نفسها؛ راجع الاتفاقيات قبل التعديل',
          'More than one version is in force at this instant; review the agreements before editing.',
        );
      }
      const notes =
        dto.notes === undefined ? current.notes : dto.notes?.trim() || null;
      const codCollectionFee =
        dto.codCollectionFee === undefined
          ? decimalOrNull(current.codCollectionFee)
          : dto.codCollectionFee;
      const diff = await this.termsDiff(
        {
          codCollectionFee: decimalOrNull(current.codCollectionFee),
          notes: current.notes,
          rates: current.rates.map(normalizedFromRow),
        },
        { codCollectionFee, notes, rates },
      );
      if (diff.changes.length === 0) {
        throw agentUnprocessable(
          'AGREEMENT_NO_CHANGES',
          'لا توجد تغييرات لحفظها في إصدار جديد',
          'Nothing changed — no new version was created.',
        );
      }
      const day = shippingAgreementDay(at);
      const agreementNumber = await this.numberingEngine.generateNumber(
        'AGENT_SHIPPING_AGREEMENT',
        undefined,
        tx,
      );
      // A planned successor ("replace from date") follows the new version.
      if (current.supersededBy) {
        await tx.agentShippingAgreement.update({
          where: { id: current.supersededBy.id },
          data: { supersedesId: null },
        });
      }
      await tx.agentShippingAgreement.update({
        where: { id },
        data: { effectiveTo: day, activeTo: at, updatedBy: userId },
      });
      const created = await tx.agentShippingAgreement.create({
        data: {
          agreementNumber,
          agentId,
          currencyId: agent.currencyId,
          status: 'ACTIVE',
          effectiveFrom: day,
          effectiveTo: current.effectiveTo,
          activeFrom: at,
          versionNumber: current.versionNumber + 1,
          supersedesId: id,
          codCollectionFee,
          notes,
          activatedAt: at,
          activatedBy: userId,
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
      if (current.supersededBy) {
        await tx.agentShippingAgreement.update({
          where: { id: current.supersededBy.id },
          data: { supersedesId: created.id },
        });
      }
      const still = await tx.agentShippingAgreement.findMany({
        where: inForceAtWhere(agentId, at),
        select: { id: true },
      });
      if (still.length !== 1 || still[0].id !== created.id) {
        throw agentConflict(
          'SHIPPING_AGREEMENT_VERSION_OVERLAP',
          'تعذر إنشاء الإصدار دون تداخل؛ لم يُحفظ شيء',
          'The version could not be created without an overlap; nothing was saved.',
        );
      }
      const when = LTR(at.toISOString());
      const ar = diff.text.map((t) => t.ar).join('؛ ');
      const en = diff.text.map((t) => t.en).join('; ');
      await this.audit(
        tx,
        id,
        'VERSION_CLOSED',
        bilingual(
          `أُغلق الإصدار ${current.versionNumber} عند ${when}، ويحل محله الإصدار ${created.versionNumber} (${agreementNumber}): ${ar}`,
          `Version ${current.versionNumber} closed at ${when}, replaced by version ${created.versionNumber} (${agreementNumber}): ${en}`,
        ),
        userId,
        { activeTo: at.toISOString(), supersededBy: created.id },
      );
      await this.audit(
        tx,
        created.id,
        'VERSION_CREATED',
        bilingual(
          `الإصدار ${created.versionNumber} ساري من ${when} بدلًا من ${current.agreementNumber}: ${ar}`,
          `Version ${created.versionNumber} in force from ${when}, replacing ${current.agreementNumber}: ${en}`,
        ),
        userId,
        {
          activeFrom: at.toISOString(),
          supersedes: id,
          changes: diff.changes,
        },
      );
      return created.id;
    });
    return this.findOne(agentId, newId);
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
      codFee: rate.codFee,
    }));
    const codCollectionFee = decimalOrNull(agreement.codCollectionFee);
    const [activity, inForce, activation] = await Promise.all([
      this.activityLog.findForEntity(SHIPPING_AGREEMENT_ENTITY, agreement.id),
      this.prisma.agentShippingAgreement.findFirst({
        where: {
          id: agreement.id,
          ...inForceAtWhere(agreement.agentId, new Date()),
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
    const coverage = shippingAgreementCoverage(rows, codCollectionFee);
    // All destinations first, then by country name and city.
    const order = (d: { countryId: string | null; city: string }) =>
      d.countryId
        ? `1|${countryOf(d.countryId)?.name ?? ''}|${d.countryId}|${d.city.toLocaleLowerCase()}`
        : '0';
    return {
      ...head,
      codCollectionFee,
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
        codFee: rate.codFee,
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
        versionNumber: true,
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
        // Prepaid-only rows never see the fee: always ADDED (the neutral mode).
        codFee:
          dto.service === 'PREPAID_CARRIER' ||
          dto.service === 'PREPAID_INTERNAL_COURIER'
            ? 'ADDED'
            : (dto.codFee ?? 'ADDED'),
      };
    });
  }

  /**
   * Field diff between two term sets (R17 §2 audit): the COD collection
   * fee, the notes and every rate row by service × destination (added /
   * removed / amount or COD-fee mode changed).
   */
  private async termsDiff(
    before: {
      codCollectionFee: number | null;
      notes: string | null;
      rates: NormalizedRate[];
    },
    after: {
      codCollectionFee: number | null;
      notes: string | null;
      rates: NormalizedRate[];
    },
  ) {
    const changes: Array<{
      field: string;
      key?: string;
      from: unknown;
      to: unknown;
    }> = [];
    const text: Bilingual[] = [];
    if (before.codCollectionFee !== after.codCollectionFee) {
      changes.push({
        field: 'codCollectionFee',
        from: before.codCollectionFee,
        to: after.codCollectionFee,
      });
      text.push({
        ar: `رسوم التحصيل ${feeText(before.codCollectionFee).ar} ← ${feeText(after.codCollectionFee).ar}`,
        en: `COD collection fee ${feeText(before.codCollectionFee).en} → ${feeText(after.codCollectionFee).en}`,
      });
    }
    if ((before.notes ?? '') !== (after.notes ?? '')) {
      changes.push({ field: 'notes', from: before.notes, to: after.notes });
      text.push({ ar: 'تغيّرت الملاحظات', en: 'notes changed' });
    }
    const keyOf = (rate: NormalizedRate) =>
      `${rate.service}#${rate.destinationKey}`;
    const old = new Map(before.rates.map((rate) => [keyOf(rate), rate]));
    const next = new Map(after.rates.map((rate) => [keyOf(rate), rate]));
    for (const [key, rate] of next) {
      const was = old.get(key);
      if (
        was &&
        money(was.amount) === money(rate.amount) &&
        was.codFee === rate.codFee
      ) {
        continue;
      }
      changes.push({
        field: 'rate',
        key,
        from: was ? { amount: was.amount, codFee: was.codFee } : null,
        to: { amount: rate.amount, codFee: rate.codFee },
      });
      const now = await this.rateText(rate, rateAmountText(rate));
      text.push(
        was
          ? joinParts(
              await this.rateText(was, rateAmountText(was)),
              now,
              ' ← ',
              ' → ',
            )
          : { ar: `أُضيف ${now.ar}`, en: `added ${now.en}` },
      );
    }
    for (const [key, rate] of old) {
      if (next.has(key)) continue;
      changes.push({
        field: 'rate',
        key,
        from: { amount: rate.amount, codFee: rate.codFee },
        to: null,
      });
      const was = await this.rateText(rate, rateAmountText(rate));
      text.push({ ar: `حُذف ${was.ar}`, en: `removed ${was.en}` });
    }
    return { changes, text };
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
        'اتفاقية الشحن المفعّلة لا تُعدَّل في مكانها؛ استخدم «تعديل» لإنشاء إصدار جديد يسري من لحظة الحفظ',
        'An activated shipping agreement is never changed in place; use Edit to create a new version in force from the save instant.',
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

/** A stored rate row in the normalized shape (for diffs). */
const normalizedFromRow = (rate: {
  service: NormalizedRate['service'];
  countryId: string | null;
  city: string;
  destinationKey: string;
  amount: Prisma.Decimal;
  codFee: NormalizedRate['codFee'];
}): NormalizedRate => ({
  service: rate.service,
  countryId: rate.countryId,
  city: rate.city,
  destinationKey: rate.destinationKey,
  amount: Number(rate.amount),
  codFee: rate.codFee,
});

/** "35.00" or "35.00 (شامل رسوم التحصيل / incl. COD fee)" for a COD-capable INCLUDED row. */
function rateAmountText(rate: NormalizedRate): string {
  const included =
    rate.codFee === 'INCLUDED' &&
    (rate.service === 'ANY' || isCodService(rate.service));
  return included
    ? `${money(rate.amount)} (شامل رسوم التحصيل / incl. COD fee)`
    : money(rate.amount);
}

const feeText = (fee: number | null): Bilingual =>
  fee == null || fee === 0
    ? { ar: 'بدون', en: 'none' }
    : { ar: money(fee), en: money(fee) };

const joinParts = (
  a: Bilingual,
  b: Bilingual,
  arrowAr: string,
  arrowEn: string,
): Bilingual => ({
  ar: `${a.ar}${arrowAr}${b.ar}`,
  en: `${a.en}${arrowEn}${b.en}`,
});

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
  versionNumber: number;
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
