import type { AgentShippingService, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  businessDateOf,
  toBusinessDateString,
} from '../../common/time/business-date';
import type {
  TariffDestination,
  TariffRow,
} from '../pricing/agent-shipping-tariff';

type Client = Prisma.TransactionClient | PrismaService;

/**
 * Bilingual text for the OMS "عربي — English" business-message convention.
 * Neither half contains " — " (callers split on it).
 */
export interface Bilingual {
  ar: string;
  en: string;
}

export const SHIPPING_SERVICE_LABEL: Record<AgentShippingService, Bilingual> = {
  ANY: { ar: 'كل الخدمات', en: 'All services' },
  PREPAID_CARRIER: { ar: 'شركة شحن (مدفوع مسبقًا)', en: 'Prepaid carrier' },
  COD_CARRIER: { ar: 'شركة شحن (الدفع عند الاستلام)', en: 'Carrier COD' },
  COD_INTERNAL_COURIER: {
    ar: 'مندوب داخلي (الدفع عند الاستلام)',
    en: 'Internal courier COD',
  },
  PREPAID_INTERNAL_COURIER: {
    ar: 'مندوب داخلي (مدفوع مسبقًا)',
    en: 'Internal courier prepaid',
  },
};

/** A `@db.Date` value (UTC midnight) of a "YYYY-MM-DD" calendar date. */
export function dateOnly(day: string): Date {
  return new Date(`${toBusinessDateString(day)}T00:00:00.000Z`);
}

/** "YYYY-MM-DD" of a `@db.Date` value. */
export const dayString = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The Cairo business date of an instant as a `@db.Date` value — shipping
 * agreement dates are Cairo calendar days (an order at 00:30 Cairo on the 1st
 * belongs to the 1st, not to the UTC 31st).
 */
export const shippingAgreementDay = (instant: Date) =>
  dateOnly(businessDateOf(instant));

/**
 * R17 §2 — the instant bounds of a version: in force at `instant` when
 * activeFrom ≤ instant < activeTo (null bounds = the day range alone).
 * Shared by the commission and shipping agreements.
 */
export function activeAtInstantWhere(instant: Date) {
  return {
    AND: [
      { OR: [{ activeFrom: null }, { activeFrom: { lte: instant } }] },
      { OR: [{ activeTo: null }, { activeTo: { gt: instant } }] },
    ],
  };
}

/**
 * The ACTIVE shipping agreement version of an agent in force at `instant`:
 * its Cairo day inside the day range AND the instant inside the version's
 * instant bounds (R17 §2 — never two versions at once).
 */
export function inForceAtWhere(
  agentId: string,
  instant: Date,
): Prisma.AgentShippingAgreementWhereInput {
  return {
    ...inForceWhere(agentId, shippingAgreementDay(instant)),
    ...activeAtInstantWhere(instant),
  };
}

/** ACTIVE (never discarded) shipping agreements of an agent in force on `day`. */
export function inForceWhere(
  agentId: string,
  day: Date,
): Prisma.AgentShippingAgreementWhereInput {
  return {
    agentId,
    status: 'ACTIVE',
    deletedAt: null,
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
}

/**
 * Rows whose inclusive [effectiveFrom, effectiveTo | ∞] range overlaps
 * [from, to | ∞] — shared by the commission and shipping agreements.
 */
export function overlappingRangeWhere(from: Date, to: Date | null) {
  return {
    AND: [
      // other.from ≤ this.to (or this is open-ended)
      ...(to ? [{ effectiveFrom: { lte: to } }] : []),
      // other.to ≥ this.from (or other is open-ended)
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
    ],
  };
}

export interface InForceShippingAgreement {
  id: string;
  agreementNumber: string;
  versionNumber: number;
  currencyId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** R17 §3 — fixed COD collection fee (null = none). */
  codCollectionFee: number | null;
  rows: TariffRow[];
}

const IN_FORCE_INCLUDE = {
  rates: true,
} satisfies Prisma.AgentShippingAgreementInclude;

function toInForce(
  agreement: Prisma.AgentShippingAgreementGetPayload<{
    include: typeof IN_FORCE_INCLUDE;
  }>,
): InForceShippingAgreement {
  return {
    id: agreement.id,
    agreementNumber: agreement.agreementNumber,
    versionNumber: agreement.versionNumber,
    currencyId: agreement.currencyId,
    effectiveFrom: agreement.effectiveFrom,
    effectiveTo: agreement.effectiveTo,
    codCollectionFee:
      agreement.codCollectionFee == null
        ? null
        : Number(agreement.codCollectionFee),
    rows: agreement.rates.map((rate) => ({
      id: rate.id,
      service: rate.service,
      countryId: rate.countryId,
      city: rate.city,
      amount: Number(rate.amount),
      codFee: rate.codFee,
    })),
  };
}

/**
 * The shipping agreement version in force for `agentId` at `instant` (R17
 * §2: the assessment instant — order submission), with its rows in the shape
 * the pure resolver reads. Activation and versioning guarantee at most one.
 * Null = none — never a zero charge.
 */
export async function resolveShippingAgreement(
  agentId: string,
  instant: Date,
  client: Client,
): Promise<InForceShippingAgreement | null> {
  const agreement = await client.agentShippingAgreement.findFirst({
    where: inForceAtWhere(agentId, instant),
    orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }],
    include: IN_FORCE_INCLUDE,
  });
  return agreement ? toInForce(agreement) : null;
}

/**
 * The exact version an existing order was assessed under (its snapshot) —
 * an amendment re-assesses against it, never against a later version.
 * Activated versions only (a draft never priced an order).
 */
export async function loadAssessedShippingAgreement(
  agentId: string,
  id: string,
  client: Client,
): Promise<InForceShippingAgreement | null> {
  const agreement = await client.agentShippingAgreement.findFirst({
    where: { id, agentId, activatedAt: { not: null } },
    include: IN_FORCE_INCLUDE,
  });
  return agreement ? toInForce(agreement) : null;
}

/**
 * The agreed charges of the agreement in force now, as the agent sees them
 * (portal `/me`): number, version, dates, currency, COD collection fee and
 * service × destination → base charge, COD fee mode and the COD total. The
 * agent's tariff only — carrier cost and margin are not part of it.
 */
export async function shippingAgreementTerms(
  agentId: string,
  date: Date,
  client: Client,
) {
  const agreement = await client.agentShippingAgreement.findFirst({
    where: inForceAtWhere(agentId, date),
    orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }],
    select: {
      agreementNumber: true,
      versionNumber: true,
      effectiveFrom: true,
      effectiveTo: true,
      activeFrom: true,
      codCollectionFee: true,
      currency: { select: { id: true, code: true, name: true, symbol: true } },
      rates: {
        orderBy: [
          { countryId: { sort: 'asc', nulls: 'first' } },
          { city: 'asc' },
          { service: 'asc' },
        ],
        select: {
          service: true,
          city: true,
          amount: true,
          codFee: true,
          country: {
            select: { id: true, name: true, nameEn: true, code: true },
          },
        },
      },
    },
  });
  if (!agreement) return null;
  const codCollectionFee =
    agreement.codCollectionFee == null
      ? null
      : Number(agreement.codCollectionFee);
  return {
    ...agreement,
    codCollectionFee,
    rates: agreement.rates.map((rate) => {
      const base = Number(rate.amount);
      // R17 §3 — what a COD order pays by this row (prepaid pays `amount`).
      const addsFee =
        rate.codFee === 'ADDED' &&
        codCollectionFee != null &&
        codCollectionFee > 0 &&
        !PREPAID_ONLY.has(rate.service);
      return {
        service: rate.service,
        country: rate.country,
        city: rate.city || null,
        amount: base,
        codFee: rate.codFee,
        codAmount: PREPAID_ONLY.has(rate.service)
          ? null
          : addsFee
            ? Math.round((base + codCollectionFee) * 100) / 100
            : base,
      };
    }),
  };
}

const PREPAID_ONLY: ReadonlySet<AgentShippingService> = new Set([
  'PREPAID_CARRIER',
  'PREPAID_INTERNAL_COURIER',
]);

/** "Egypt / Cairo", "Egypt", or "all destinations" in both languages. */
export async function describeDestination(
  client: Client,
  destination: TariffDestination,
): Promise<Bilingual> {
  const city = destination.city?.trim() || null;
  if (!destination.countryId) {
    return { ar: 'كل الوجهات', en: 'all destinations' };
  }
  const country = await client.country.findUnique({
    where: { id: destination.countryId },
    select: { name: true, nameEn: true },
  });
  const ar = [country?.name, city].filter(Boolean).join(' / ');
  const en = [country?.nameEn ?? country?.name, city]
    .filter(Boolean)
    .join(' / ');
  return { ar: ar || '—', en: en || '—' };
}

/** AGENT_SHIPPING_AGREEMENT_MISSING — no agreement in force on the order date. */
export function missingAgreementMessage(agentName: string, day: Date) {
  const date = dayString(day);
  return {
    ar: `لا توجد اتفاقية شحن سارية للوكيل ${agentName} في ${date}؛ تفعّلها الشركة من الوكيل ← الإعدادات ← اتفاقية الشحن`,
    en: `No active shipping agreement for ${agentName} on ${date}; the company activates one under Agent → Settings → Shipping agreement.`,
  };
}

/** AGENT_SHIPPING_TARIFF_MISSING — the agreement in force lacks the service × destination. */
export function missingTariffMessage(
  agreementNumber: string | null | undefined,
  services: readonly AgentShippingService[],
  destination: Bilingual,
) {
  const ar = services.map((s) => SHIPPING_SERVICE_LABEL[s].ar).join(' / ');
  const en = services.map((s) => SHIPPING_SERVICE_LABEL[s].en).join(' / ');
  const number = agreementNumber ? ` ${agreementNumber}` : '';
  return {
    ar: `اتفاقية الشحن${number} لا تتضمن سعرًا لـ ${ar} إلى ${destination.ar}؛ تضيفه الشركة بتعديل الاتفاقية (إصدار جديد) أو تُختار طريقة توصيل أخرى`,
    en: `Shipping agreement${number} has no charge for ${en} to ${destination.en}; the company adds it by editing the agreement (a new version) or another delivery method is chosen.`,
  };
}
