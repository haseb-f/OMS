/**
 * Agent shipping agreement charges (R15 D15-13; spec-w3 §2). Pure: no I/O.
 *
 * A row of the agent's shipping agreement is (service, destination) → agreed
 * charge. Service = the delivery channel Shipping chooses × the order's
 * payment type — one of four, never a wildcard. Destination = all
 * destinations (no country), a country, or a city of a country. Resolution
 * for a concrete order: the row of that service with the most specific
 * matching destination wins (city → country → all destinations). Nothing is
 * ever guessed: no matching row = unresolved (null), never zero.
 */
import type { AgentShippingService } from '@prisma/client';

export type { AgentShippingService };
/** The concrete channels an order can be delivered by. */
export type DeliveryChannel = 'CARRIER' | 'INTERNAL_COURIER';
export type OrderPaymentType = 'PREPAID' | 'CASH_ON_DELIVERY';

export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = [
  'CARRIER',
  'INTERNAL_COURIER',
];

/** The four services, in the order every screen lists them. */
export const AGENT_SHIPPING_SERVICES: readonly AgentShippingService[] = [
  'PREPAID_CARRIER',
  'COD_CARRIER',
  'COD_INTERNAL_COURIER',
  'PREPAID_INTERNAL_COURIER',
];

/** (delivery channel, payment type) → the agreement service it is priced by. */
export function serviceOf(
  channel: DeliveryChannel,
  paymentType: OrderPaymentType,
): AgentShippingService {
  const cod = paymentType === 'CASH_ON_DELIVERY';
  if (channel === 'CARRIER') return cod ? 'COD_CARRIER' : 'PREPAID_CARRIER';
  return cod ? 'COD_INTERNAL_COURIER' : 'PREPAID_INTERNAL_COURIER';
}

/** ShippingCompany.type → delivery channel. */
export function deliveryChannelOf(
  shippingCompanyType: 'INTERNAL_DELIVERY' | 'EXTERNAL_COMPANY',
): DeliveryChannel {
  return shippingCompanyType === 'INTERNAL_DELIVERY'
    ? 'INTERNAL_COURIER'
    : 'CARRIER';
}

export type TariffScope = 'CITY' | 'COUNTRY' | 'ALL';

export interface TariffRow {
  id: string;
  service: AgentShippingService;
  /** null = all destinations. */
  countryId: string | null;
  /** '' = the whole country (or all destinations). */
  city: string;
  amount: number;
}

export interface TariffDestination {
  countryId: string | null | undefined;
  city: string | null | undefined;
}

export interface ResolvedTariff {
  id: string;
  amount: number;
  service: AgentShippingService;
  /** How specific the winning row is. */
  scope: TariffScope;
}

export const normalizeTariffCity = (city: string | null | undefined) =>
  (city ?? '').trim().toLocaleLowerCase();

export function tariffScopeOf(row: {
  countryId: string | null;
  city: string;
}): TariffScope {
  if (!row.countryId) return 'ALL';
  return normalizeTariffCity(row.city) ? 'CITY' : 'COUNTRY';
}

/**
 * The unique key of a destination within one service of an agreement:
 * "*" (all destinations), "<countryId>", "<countryId>|<lower(city)>". The
 * city compares trimmed and case-insensitively ("Cairo" = " cairo ").
 */
export function destinationKeyOf(
  countryId: string | null | undefined,
  city: string | null | undefined,
): string {
  if (!countryId) return '*';
  const normalized = normalizeTariffCity(city);
  return normalized ? `${countryId}|${normalized}` : countryId;
}

const SPECIFICITY: Record<TariffScope, number> = {
  CITY: 2,
  COUNTRY: 1,
  ALL: 0,
};

export function resolveTariff(
  rows: readonly TariffRow[],
  destination: TariffDestination,
  service: AgentShippingService,
): ResolvedTariff | null {
  const wantedCity = normalizeTariffCity(destination.city);
  let best: { row: TariffRow; scope: TariffScope } | null = null;
  for (const row of rows) {
    if (row.service !== service) continue;
    const scope = tariffScopeOf(row);
    if (scope !== 'ALL' && row.countryId !== destination.countryId) continue;
    if (scope === 'CITY' && normalizeTariffCity(row.city) !== wantedCity) {
      continue;
    }
    if (!best || SPECIFICITY[scope] > SPECIFICITY[best.scope]) {
      best = { row, scope };
    }
  }
  if (!best) return null;
  return {
    id: best.row.id,
    amount: best.row.amount,
    service,
    scope: best.scope,
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
 * Provisional estimate = the CARRIER charge, else the first resolvable
 * channel. Null when no channel resolves (the order cannot be priced).
 */
export function resolveSubmissionTariff(
  rows: readonly TariffRow[],
  destination: TariffDestination,
  paymentType: OrderPaymentType,
): SubmissionTariff | null {
  const byChannel = {} as Record<DeliveryChannel, ResolvedTariff | null>;
  for (const channel of DELIVERY_CHANNELS) {
    byChannel[channel] = resolveTariff(
      rows,
      destination,
      serviceOf(channel, paymentType),
    );
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

export interface CoverageDestination {
  key: string;
  countryId: string | null;
  /** As entered on the first row of that destination ('' = whole country / all). */
  city: string;
  scope: TariffScope;
  /** Per service: the charge an order to this destination gets (null = missing). */
  cells: Record<
    AgentShippingService,
    { rateId: string; amount: number; inherited: boolean } | null
  >;
}

export interface ShippingAgreementCoverage {
  destinations: CoverageDestination[];
  missing: Array<{
    destinationKey: string;
    countryId: string | null;
    city: string;
    service: AgentShippingService;
  }>;
  complete: boolean;
}

/**
 * The service × destination matrix of an agreement (spec-w3 §1 / §6): one
 * row per destination the agreement names (all destinations first, then by
 * country and city), one cell per service = what an order to that
 * destination is charged — its own row, or a broader row it inherits
 * (`inherited`). An empty cell is a combination no order there can be
 * priced for; missing combinations warn, they never block activation.
 */
export function shippingAgreementCoverage(
  rows: readonly TariffRow[],
): ShippingAgreementCoverage {
  const byKey = new Map<string, { countryId: string | null; city: string }>();
  for (const row of rows) {
    const key = destinationKeyOf(row.countryId, row.city);
    if (!byKey.has(key)) {
      byKey.set(key, { countryId: row.countryId, city: row.city.trim() });
    }
  }
  const keys = [...byKey.keys()].sort((a, b) =>
    a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b),
  );
  const destinations = keys.map((key): CoverageDestination => {
    const { countryId, city } = byKey.get(key)!;
    const scope = tariffScopeOf({ countryId, city });
    const cells = {} as CoverageDestination['cells'];
    for (const service of AGENT_SHIPPING_SERVICES) {
      const hit = resolveTariff(rows, { countryId, city }, service);
      cells[service] = hit
        ? { rateId: hit.id, amount: hit.amount, inherited: hit.scope !== scope }
        : null;
    }
    return { key, countryId, city, scope, cells };
  });
  const missing = destinations.flatMap((d) =>
    AGENT_SHIPPING_SERVICES.filter((s) => d.cells[s] == null).map(
      (service) => ({
        destinationKey: d.key,
        countryId: d.countryId,
        city: d.city,
        service,
      }),
    ),
  );
  return { destinations, missing, complete: missing.length === 0 };
}

const toMinor = (value: number) => Math.round(value * 100);
