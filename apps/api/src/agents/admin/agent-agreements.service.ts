import { Injectable } from '@nestjs/common';
import { Prisma, type AgentAgreement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { activeAgreementWhere, toDateOnly } from './agents.service';
import {
  dayString,
  inForceWhere,
  overlappingRangeWhere,
} from '../shipping-agreements/shipping-agreement-resolution';
import type {
  AgreementVersionDto,
  CreateAgreementDto,
  EndAgreementDto,
  UpdateAgreementDto,
} from './dto/agreement.dto';

type Client = Prisma.TransactionClient | PrismaService;

/** MasterDataActivityLog entity type of the commission agreement's audit trail (R17 §2). */
export const AGENT_AGREEMENT_ENTITY = 'AGENT_AGREEMENT';

/**
 * The agreement version in force for `agentId` at `date` (spec §2; R17 §2:
 * instant precision), or null. Used by order creation (snapshot source) and
 * the finance hooks.
 */
export async function resolveActiveAgreement(
  agentId: string,
  date: Date,
  client: Client,
): Promise<AgentAgreement | null> {
  return client.agentAgreement.findFirst({
    where: { agentId, ...activeAgreementWhere(date) },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }],
  });
}

/**
 * The exact version an existing order was assessed under (its snapshot) —
 * an amendment re-assesses against it, never against a later version.
 */
export function loadAssessedAgreement(
  agentId: string,
  id: string,
  client: Client,
): Promise<AgentAgreement | null> {
  return client.agentAgreement.findFirst({
    where: { id, agentId, activatedAt: { not: null } },
  });
}

const AGREEMENT_INCLUDE = {
  currency: { select: { id: true, code: true, name: true, symbol: true } },
  supersedes: {
    select: { id: true, agreementNumber: true, versionNumber: true },
  },
  supersededBy: {
    select: {
      id: true,
      agreementNumber: true,
      versionNumber: true,
      activeFrom: true,
    },
  },
  _count: { select: { storeOrders: true } },
} satisfies Prisma.AgentAgreementInclude;

/** The terms a version carries (everything but dates, currency and status). */
const VERSION_TERMS = [
  'productCommissionRatePercent',
  'serviceCommissionRatePercent',
  'shippingPolicy',
  'commissionEarningEvent',
  'returnCommissionTreatment',
  'customerShippingChargeOwner',
  'providerFeesBorneBy',
  'shippingFeePerShipment',
  'returnFeePerShipment',
  'serviceFeePerOrder',
  'allowAgentDestinations',
  'payoutHoldDays',
  'notes',
] as const;
type VersionTerm = (typeof VERSION_TERMS)[number];

/** Audit labels of the version terms (both languages). */
const TERM_LABEL: Record<VersionTerm, { ar: string; en: string }> = {
  productCommissionRatePercent: {
    ar: 'نسبة المنتجات %',
    en: 'Products rate %',
  },
  serviceCommissionRatePercent: {
    ar: 'نسبة الخدمات والدورات %',
    en: 'Services & courses rate %',
  },
  shippingPolicy: { ar: 'رسم شحن الوكيل', en: 'Agent shipping charge' },
  commissionEarningEvent: {
    ar: 'استحقاق العمولة',
    en: 'Commission earned when',
  },
  returnCommissionTreatment: {
    ar: 'العمولة على المرتجع',
    en: 'Commission on returns',
  },
  customerShippingChargeOwner: {
    ar: 'مالك شحن العميل',
    en: 'Customer shipping belongs to',
  },
  providerFeesBorneBy: { ar: 'رسوم مزوّد الدفع', en: 'Provider fees borne by' },
  shippingFeePerShipment: {
    ar: 'رسم الشحن لكل شحنة',
    en: 'Shipping fee per shipment',
  },
  returnFeePerShipment: {
    ar: 'رسم المرتجع لكل شحنة',
    en: 'Return fee per shipment',
  },
  serviceFeePerOrder: { ar: 'رسم الخدمة لكل طلب', en: 'Service fee per order' },
  allowAgentDestinations: {
    ar: 'الدفع للوكيل مباشرة',
    en: 'Customers may pay the agent',
  },
  payoutHoldDays: { ar: 'مدة حجز الصرف', en: 'Payout hold (days)' },
  notes: { ar: 'ملاحظات', en: 'Notes' },
};

/** Comparable value of a term (Decimal → number, empty notes → null). */
function termValue(
  agreement: Pick<AgentAgreement, VersionTerm>,
  key: VersionTerm,
): string | number | boolean | null {
  const value = agreement[key];
  if (value == null) return null;
  if (typeof value === 'object') return Number(value);
  if (key === 'notes') return String(value).trim() || null;
  return value;
}

/**
 * Effective-dated agent agreements (spec §2). DRAFT is editable; ACTIVE
 * terms are immutable (change = end it and create a new one);
 * ENDED keeps its fixed last day. Active ranges of one agent never overlap —
 * activation is serialized on the agent row. The shipping charges live in
 * the agent's shipping agreement (R15 D15-13); this agreement keeps only the
 * shipping policy.
 */
@Injectable()
export class AgentAgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** Every version, newest first; `inForceId` = the version in force now. */
  async list(agentId: string) {
    await this.requireAgent(agentId);
    const [items, inForce] = await Promise.all([
      this.prisma.agentAgreement.findMany({
        where: { agentId },
        include: AGREEMENT_INCLUDE,
        orderBy: [
          { effectiveFrom: 'desc' },
          { versionNumber: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      resolveActiveAgreement(agentId, new Date(), this.prisma),
    ]);
    return items.map((item) => ({
      ...item,
      inForceNow: item.id === inForce?.id,
    }));
  }

  /** One version with its audit trail (who / when / field diff). */
  async findOne(agentId: string, agreementId: string) {
    const agreement = await this.prisma.agentAgreement.findFirst({
      where: { id: agreementId, agentId },
      include: AGREEMENT_INCLUDE,
    });
    if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
    const activity = await this.activityLog.findForEntity(
      AGENT_AGREEMENT_ENTITY,
      agreement.id,
    );
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              activity
                .map((entry) => entry.createdBy)
                .filter((id): id is string => !!id),
            ),
          ],
        },
      },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      ...agreement,
      activity: activity.map((entry) => ({
        id: entry.id,
        type: entry.type,
        description: entry.description,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        user: byId.get(entry.createdBy ?? '') ?? null,
      })),
    };
  }

  async create(agentId: string, dto: CreateAgreementDto, userId: string) {
    const agent = await this.requireAgent(agentId);
    const currencyId = dto.currencyId ?? agent.currencyId;
    this.assertCurrency(currencyId, agent.currencyId);
    this.assertRange(dto.effectiveFrom, dto.effectiveTo);
    assertShippingPolicyConsistent(dto);
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
          productCommissionRatePercent: dto.productCommissionRatePercent,
          serviceCommissionRatePercent: dto.serviceCommissionRatePercent,
          shippingPolicy: dto.shippingPolicy,
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
    assertShippingPolicyConsistent({
      shippingPolicy: dto.shippingPolicy ?? existing.shippingPolicy,
      customerShippingChargeOwner:
        dto.customerShippingChargeOwner ?? existing.customerShippingChargeOwner,
      shippingFeePerShipment:
        dto.shippingFeePerShipment ?? Number(existing.shippingFeePerShipment),
    });
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
        productCommissionRatePercent: dto.productCommissionRatePercent,
        serviceCommissionRatePercent: dto.serviceCommissionRatePercent,
        shippingPolicy: dto.shippingPolicy,
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
   * cannot both pass the overlap check. A PREDETERMINED_CHARGE agreement
   * whose start date no ACTIVE shipping agreement covers is activated with a
   * warning (R15 D15-13): its orders cannot be priced until one is.
   */
  async activate(agentId: string, agreementId: string, userId: string) {
    const activated = await this.prisma.$transaction(async (tx) => {
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
      assertShippingPolicyConsistent({
        ...agreement,
        shippingFeePerShipment: Number(agreement.shippingFeePerShipment),
      });
      const overlapping = await tx.agentAgreement.findFirst({
        where: {
          agentId,
          id: { not: agreementId },
          status: { in: ['ACTIVE', 'ENDED'] },
          ...overlappingRangeWhere(
            agreement.effectiveFrom,
            agreement.effectiveTo,
          ),
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
      return tx.agentAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          activatedBy: userId,
          // R17 §2 — a day-dated agreement is in force from its first instant.
          activeFrom: agreement.effectiveFrom,
          updatedBy: userId,
        },
      });
    });
    const warnings: Array<{ code: string; message: string }> = [];
    if (
      activated.shippingPolicy === 'PREDETERMINED_CHARGE' &&
      !(await this.prisma.agentShippingAgreement.findFirst({
        where: inForceWhere(agentId, activated.effectiveFrom),
        select: { id: true },
      }))
    ) {
      const day = dayString(activated.effectiveFrom);
      warnings.push({
        code: 'SHIPPING_AGREEMENT_NOT_IN_FORCE',
        message: `لا توجد اتفاقية شحن مفعّلة تغطي ${day}؛ لن تُسعَّر طلبات الشحن حتى تُفعَّل واحدة من الإعدادات ← اتفاقية الشحن — No active shipping agreement covers ${day}; shipped orders cannot be priced until one is activated under Settings → Shipping agreement.`,
      });
    }
    return { ...(await this.findOne(agentId, agreementId)), warnings };
  }

  /**
   * R17 §2 — "Edit" on the ACTIVE agreement in force now. Under the agent
   * row lock, at the save instant t: a new ACTIVE version (the current terms
   * + the changes, version + 1, `supersedes` = the current one) is in force
   * from t (`activeFrom = t`, day of t → the current end date); the current
   * version is ENDED at t (`activeTo = t`, last day = the day of t) and kept
   * read-only with its full terms. Exactly one version is in force at t
   * before and after (validated). Orders already submitted keep their terms
   * snapshot — nothing is repriced. Both versions are audited with the field
   * diff (MasterDataActivityLog).
   */
  async createVersion(
    agentId: string,
    agreementId: string,
    dto: AgreementVersionDto,
    userId: string,
  ) {
    const newId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agents WHERE id = ${agentId}::uuid FOR UPDATE`;
      const agent = await tx.agent.findFirst({
        where: { id: agentId, deletedAt: null },
      });
      if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
      const current = await tx.agentAgreement.findFirst({
        where: { id: agreementId, agentId },
      });
      if (!current) throw agentNotFoundError('Agreement', 'الاتفاقية');
      const at = new Date();
      const inForce = await tx.agentAgreement.findMany({
        where: { agentId, ...activeAgreementWhere(at) },
        select: { id: true },
      });
      if (
        current.status !== 'ACTIVE' ||
        !inForce.some((row) => row.id === agreementId)
      ) {
        throw agentConflict(
          'AGREEMENT_NOT_IN_FORCE',
          'يُعدَّل فقط إصدار الاتفاقية الساري الآن؛ المسودات تُعدَّل مباشرة والإصدارات المنتهية للقراءة فقط',
          'Only the agreement version in force now can be edited; drafts are edited directly and ended versions are read-only.',
        );
      }
      if (inForce.length !== 1) {
        throw agentConflict(
          'AGREEMENT_VERSION_OVERLAP',
          'أكثر من إصدار ساري في اللحظة نفسها؛ راجع الاتفاقيات قبل التعديل',
          'More than one version is in force at this instant; review the agreements before editing.',
        );
      }
      const terms = { ...current };
      for (const key of VERSION_TERMS) {
        const value = dto[key];
        if (value === undefined) continue;
        (terms as Record<string, unknown>)[key] =
          key === 'notes' ? (value as string | null)?.trim() || null : value;
      }
      const next = {
        ...terms,
        productCommissionRatePercent: new Prisma.Decimal(
          terms.productCommissionRatePercent,
        ),
        serviceCommissionRatePercent: new Prisma.Decimal(
          terms.serviceCommissionRatePercent,
        ),
        shippingFeePerShipment: new Prisma.Decimal(
          terms.shippingFeePerShipment,
        ),
        returnFeePerShipment: new Prisma.Decimal(terms.returnFeePerShipment),
        serviceFeePerOrder: new Prisma.Decimal(terms.serviceFeePerOrder),
      };
      assertShippingPolicyConsistent({
        ...next,
        shippingFeePerShipment: Number(next.shippingFeePerShipment),
      });
      assertExplicitTerms(next);
      const changes = VERSION_TERMS.flatMap((key) => {
        const from = termValue(current, key);
        const to = termValue(next, key);
        return from === to ? [] : [{ field: key, from, to }];
      });
      if (changes.length === 0) {
        throw agentUnprocessable(
          'AGREEMENT_NO_CHANGES',
          'لا توجد تغييرات لحفظها في إصدار جديد',
          'Nothing changed — no new version was created.',
        );
      }
      const day = toDateOnly(at);
      const agreementNumber = await this.numberingEngine.generateNumber(
        'AGENT_AGREEMENT',
        undefined,
        tx,
      );
      await tx.agentAgreement.update({
        where: { id: agreementId },
        data: {
          status: 'ENDED',
          effectiveTo: day,
          activeTo: at,
          endedAt: at,
          updatedBy: userId,
        },
      });
      const created = await tx.agentAgreement.create({
        data: {
          agentId,
          agreementNumber,
          status: 'ACTIVE',
          effectiveFrom: day,
          effectiveTo: current.effectiveTo,
          activeFrom: at,
          versionNumber: current.versionNumber + 1,
          supersedesId: agreementId,
          currencyId: current.currencyId,
          productCommissionRatePercent: next.productCommissionRatePercent,
          serviceCommissionRatePercent: next.serviceCommissionRatePercent,
          shippingPolicy: next.shippingPolicy,
          commissionEarningEvent: next.commissionEarningEvent,
          returnCommissionTreatment: next.returnCommissionTreatment,
          customerShippingChargeOwner: next.customerShippingChargeOwner,
          providerFeesBorneBy: next.providerFeesBorneBy,
          shippingFeePerShipment: next.shippingFeePerShipment,
          returnFeePerShipment: next.returnFeePerShipment,
          serviceFeePerOrder: next.serviceFeePerOrder,
          allowAgentDestinations: next.allowAgentDestinations,
          payoutHoldDays: next.payoutHoldDays,
          notes: next.notes,
          activatedAt: at,
          activatedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      const still = await tx.agentAgreement.findMany({
        where: { agentId, ...activeAgreementWhere(at) },
        select: { id: true },
      });
      if (still.length !== 1 || still[0].id !== created.id) {
        throw agentConflict(
          'AGREEMENT_VERSION_OVERLAP',
          'تعذر إنشاء الإصدار دون تداخل؛ لم يُحفظ شيء',
          'The version could not be created without an overlap; nothing was saved.',
        );
      }
      // Stored once in both languages ("العربية — English"); neither half
      // contains " — " (the UI splits on it).
      const when = `\u2066${at.toISOString()}\u2069`;
      const value = (v: string | number | boolean | null) =>
        `\u2066${v == null ? '-' : String(v)}\u2069`;
      const diffAr = changes
        .map(
          (c) => `${TERM_LABEL[c.field].ar}: ${value(c.from)} ← ${value(c.to)}`,
        )
        .join('؛ ');
      const diffEn = changes
        .map(
          (c) => `${TERM_LABEL[c.field].en}: ${value(c.from)} → ${value(c.to)}`,
        )
        .join('; ');
      await this.activityLog.log(
        AGENT_AGREEMENT_ENTITY,
        agreementId,
        'VERSION_CLOSED',
        `أُغلق الإصدار ${current.versionNumber} عند ${when}، ويحل محله الإصدار ${created.versionNumber} (${agreementNumber}): ${diffAr} — Version ${current.versionNumber} closed at ${when}, replaced by version ${created.versionNumber} (${agreementNumber}): ${diffEn}`,
        userId,
        { activeTo: at.toISOString(), supersededBy: created.id },
        tx,
      );
      await this.activityLog.log(
        AGENT_AGREEMENT_ENTITY,
        created.id,
        'VERSION_CREATED',
        `الإصدار ${created.versionNumber} ساري من ${when} بدلًا من ${current.agreementNumber}: ${diffAr} — Version ${created.versionNumber} in force from ${when}, replacing ${current.agreementNumber}: ${diffEn}`,
        userId,
        { activeFrom: at.toISOString(), supersedes: agreementId, changes },
        tx,
      );
      return created.id;
    });
    return this.findOne(agentId, newId);
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
        'شروط الاتفاقية المفعّلة لا تتغير في مكانها؛ استخدم «تعديل» لإنشاء إصدار جديد يسري من لحظة الحفظ',
        'An activated agreement’s terms never change in place — use Edit to create a new version in force from the save instant.',
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

/**
 * commission-policy.md A3: under PREDETERMINED_CHARGE the customer shipping
 * belongs to the company and settles the agent shipping charge — so the owner
 * must be the company and there is no second per-shipment fee. NONE never
 * keeps a flat fee it would not charge.
 */
function assertShippingPolicyConsistent(terms: {
  shippingPolicy: string;
  customerShippingChargeOwner: string;
  shippingFeePerShipment: number;
}) {
  const conflicts: string[] = [];
  if (terms.shippingPolicy === 'PREDETERMINED_CHARGE') {
    if (terms.customerShippingChargeOwner !== 'COMPANY') {
      conflicts.push('customerShippingChargeOwner');
    }
    if (Number(terms.shippingFeePerShipment) !== 0) {
      conflicts.push('shippingFeePerShipment');
    }
  }
  if (
    terms.shippingPolicy === 'NONE' &&
    Number(terms.shippingFeePerShipment) !== 0
  ) {
    conflicts.push('shippingFeePerShipment');
  }
  if (conflicts.length > 0) {
    throw agentUnprocessable(
      'AGENT_SHIPPING_POLICY_CONFLICT',
      'مع رسم الشحن المحدد مسبقًا يكون شحن العميل ملكًا للشركة ورسم الشحن لكل شحنة صفرًا؛ ومع تحمّل الشركة للشحن يكون رسم الشحن صفرًا — حتى لا يُحتسب الشحن مرتين',
      'With the predetermined shipping charge the customer shipping belongs to the company and the per-shipment fee is 0; when the company bears shipping the fee is 0 — so shipping is never charged twice.',
      { fields: conflicts },
    );
  }
}

/** Defense in depth: every term present and in range before activation (D3). */
function assertExplicitTerms(
  agreement: Pick<
    AgentAgreement,
    | VersionTerm
    | 'productCommissionRatePercent'
    | 'serviceCommissionRatePercent'
  >,
) {
  const missing: string[] = [];
  for (const key of [
    'productCommissionRatePercent',
    'serviceCommissionRatePercent',
  ] as const) {
    const rate = Number(agreement[key]);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) missing.push(key);
  }
  if (!agreement.shippingPolicy) {
    missing.push('shippingPolicy');
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
