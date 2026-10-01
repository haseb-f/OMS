/**
 * Agent shipping tariffs (spec-2-agent-pricing.md 2B). Pure: no I/O.
 *
 * A tariff row is (destination country [+ city], delivery channel, payment
 * type) → amount, per agreement. `ANY` matches every channel / payment type.
 * Resolution for a concrete (destination, channel, payment type): the most
 * specific row wins — a city row before the country row, then the exact
 * channel before ANY, then the exact payment type before ANY. Nothing is
 * ever guessed: no matching row = unresolved (null).
 */

export type TariffDeliveryChannel = 'ANY' | 'CARRIER' | 'INTERNAL_COURIER';
export type TariffPaymentType = 'ANY' | 'PREPAID' | 'CASH_ON_DELIVERY';
/** The concrete channels an order can be delivered by. */
export type DeliveryChannel = Exclude<TariffDeliveryChannel, 'ANY'>;
export type OrderPaymentType = Exclude<TariffPaymentType, 'ANY'>;

export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = [
  'CARRIER',
  'INTERNAL_COURIER',
];

export interface TariffRow {
  id: string;
  countryId: string;
  /** '' = the whole country. */
  city: string;
  deliveryChannel: TariffDeliveryChannel;
  paymentType: TariffPaymentType;
  amount: number;
}

export interface TariffDestination {
  countryId: string;
  city: string | null | undefined;
}

export interface ResolvedTariff {
  id: string;
  amount: number;
  countryId: string;
  city: string;
  /** The row's own dimensions (may be ANY). */
  rowDeliveryChannel: TariffDeliveryChannel;
  rowPaymentType: TariffPaymentType;
}

export const normalizeTariffCity = (city: string | null | undefined) =>
  (city ?? '').trim().toLocaleLowerCase();

/** ShippingCompany.type → delivery channel. */
export function deliveryChannelOf(
  shippingCompanyType: 'INTERNAL_DELIVERY' | 'EXTERNAL_COMPANY',
): DeliveryChannel {
  return shippingCompanyType === 'INTERNAL_DELIVERY'
    ? 'INTERNAL_COURIER'
    : 'CARRIER';
}

/** Specificity score: city (4) > channel (2) > payment type (1). */
function specificity(row: TariffRow): number {
  return (
    (normalizeTariffCity(row.city) ? 4 : 0) +
    (row.deliveryChannel !== 'ANY' ? 2 : 0) +
    (row.paymentType !== 'ANY' ? 1 : 0)
  );
}

export function resolveTariff(
  rows: readonly TariffRow[],
  destination: TariffDestination,
  channel: DeliveryChannel,
  paymentType: OrderPaymentType,
): ResolvedTariff | null {
  const wantedCity = normalizeTariffCity(destination.city);
  let best: TariffRow | null = null;
  for (const row of rows) {
    if (row.countryId !== destination.countryId) continue;
    const rowCity = normalizeTariffCity(row.city);
    if (rowCity && rowCity !== wantedCity) continue;
    if (row.deliveryChannel !== 'ANY' && row.deliveryChannel !== channel) {
      continue;
    }
    if (row.paymentType !== 'ANY' && row.paymentType !== paymentType) {
      continue;
    }
    if (!best || specificity(row) > specificity(best)) best = row;
  }
  if (!best) return null;
  return {
    id: best.id,
    amount: best.amount,
    countryId: best.countryId,
    city: best.city,
    rowDeliveryChannel: best.deliveryChannel,
    rowPaymentType: best.paymentType,
  };
}

export interface SubmissionTariff {
  /**
   * CONFIRMED when every channel resolves to the same fee (smart default,
   * no waiting for Shipping); otherwise PENDING_METHOD with a provisional
   * estimate.
   */
  status: 'CONFIRMED' | 'PENDING_METHOD';
  /** The fee (confirmed) or the provisional estimate. */
  tariff: ResolvedTariff;
  /** Channel the estimate was taken from (null when confirmed for every channel). */
  estimateChannel: DeliveryChannel | null;
  byChannel: Record<DeliveryChannel, ResolvedTariff | null>;
}

/**
 * Fee at order submission, before Shipping chooses the delivery method.
 * Provisional estimate = the CARRIER tariff, else the first resolvable
 * channel. Null when no channel resolves (the order cannot be priced).
 */
export function resolveSubmissionTariff(
  rows: readonly TariffRow[],
  destination: TariffDestination,
  paymentType: OrderPaymentType,
): SubmissionTariff | null {
  const byChannel = {} as Record<DeliveryChannel, ResolvedTariff | null>;
  for (const channel of DELIVERY_CHANNELS) {
    byChannel[channel] = resolveTariff(rows, destination, channel, paymentType);
  }
  const resolved = DELIVERY_CHANNELS.map((c) => byChannel[c]);
  const first = resolved.find((r): r is ResolvedTariff => r != null);
  if (!first) return null;
  const allEqual = resolved.every(
    (r) => r != null && toMinor(r.amount) === toMinor(first.amount),
  );
  if (allEqual) {
    return {
      status: 'CONFIRMED',
      tariff: byChannel.CARRIER ?? first,
      estimateChannel: null,
      byChannel,
    };
  }
  const estimateChannel: DeliveryChannel = byChannel.CARRIER
    ? 'CARRIER'
    : DELIVERY_CHANNELS.find((c) => byChannel[c] != null)!;
  return {
    status: 'PENDING_METHOD',
    tariff: byChannel[estimateChannel]!,
    estimateChannel,
    byChannel,
  };
}

const toMinor = (value: number) => Math.round(value * 100);
