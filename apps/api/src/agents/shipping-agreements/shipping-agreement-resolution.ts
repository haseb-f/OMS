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
  currencyId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rows: TariffRow[];
}

/**
 * The shipping agreement in force for `agentId` on the Cairo date of `date`
 * (activation guarantees at most one), with its rows in the shape the pure
 * resolver reads. Null = none — never a zero charge.
 */
export async function resolveShippingAgreement(
  agentId: string,
  date: Date,
  client: Client,
): Promise<InForceShippingAgreement | null> {
  const agreement = await client.agentShippingAgreement.findFirst({
    where: inForceWhere(agentId, shippingAgreementDay(date)),
    orderBy: { effectiveFrom: 'desc' },
    include: { rates: true },
  });
  if (!agreement) return null;
  return {
    id: agreement.id,
    agreementNumber: agreement.agreementNumber,
    currencyId: agreement.currencyId,
    effectiveFrom: agreement.effectiveFrom,
    effectiveTo: agreement.effectiveTo,
    rows: agreement.rates.map((rate) => ({
      id: rate.id,
      service: rate.service,
      countryId: rate.countryId,
      city: rate.city,
      amount: Number(rate.amount),
    })),
  };
}

/**
 * The agreed charges of the agreement in force today, as the agent sees
 * them (portal `/me`): number, dates, currency and service × destination →
 * charge. Charges only — carrier cost and margin are not part of it.
 */
export async function shippingAgreementTerms(
  agentId: string,
  date: Date,
  client: Client,
) {
  const agreement = await client.agentShippingAgreement.findFirst({
    where: inForceWhere(agentId, shippingAgreementDay(date)),
    orderBy: { effectiveFrom: 'desc' },
    select: {
      agreementNumber: true,
      effectiveFrom: true,
      effectiveTo: true,
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
          country: {
            select: { id: true, name: true, nameEn: true, code: true },
          },
        },
      },
    },
  });
  if (!agreement) return null;
  return {
    ...agreement,
    rates: agreement.rates.map((rate) => ({
      service: rate.service,
      country: rate.country,
      city: rate.city || null,
      amount: Number(rate.amount),
    })),
  };
}

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
    ar: `اتفاقية الشحن${number} لا تتضمن سعرًا لـ ${ar} إلى ${destination.ar}؛ تضيفه الشركة في إصدار جديد (نسخ ← تعديل ← تفعيل مع «الاستبدال من تاريخ») أو تُختار طريقة توصيل أخرى`,
    en: `Shipping agreement${number} has no charge for ${en} to ${destination.en}; the company adds it in a new version (Duplicate → edit → Activate with "replace from") or another delivery method is chosen.`,
  };
}
