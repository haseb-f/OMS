/**
 * Agent shipping agreement charges (R15 D15-13; spec-w3 §2; R17 §3). Pure:
 * no I/O.
 *
 * A row of the agent's shipping agreement is (service, destination) → agreed
 * charge. Service = one of the four concrete services (delivery channel
 * Shipping chooses × the order's payment type) or `ANY` (every service — the
 * agreement's default row). Destination = all destinations (no country), a
 * country, or a city of a country.
 *
 * Resolution for a concrete order (R17 §3, unambiguous): the most specific
 * matching destination first (city → country → all destinations); at the
 * same destination a service-specific row beats `ANY`. Duplicates (same
 * service × destination) never exist (validated on save), so exactly one row
 * wins. Nothing is ever guessed: no matching row = unresolved (null), never
 * zero.
 *
 * COD collection fee: a COD service priced by an `ADDED` row pays the row
 * amount + the agreement's `codCollectionFee`; an `INCLUDED` row is
 * all-inclusive. Prepaid services never pay the fee.
 */
import type {
  AgentShippingCodFeeMode,
  AgentShippingService,
} from '@prisma/client';

export type { AgentShippingService, AgentShippingCodFeeMode };
/** A service an order is actually delivered by (never the `ANY` wildcard). */
export type ConcreteShippingService = Exclude<AgentShippingService, 'ANY'>;
/** The concrete channels an order can be delivered by. */
export type DeliveryChannel = 'CARRIER' | 'INTERNAL_COURIER';
export type OrderPaymentType = 'PREPAID' | 'CASH_ON_DELIVERY';
/** How the COD collection fee entered a charge (NONE = prepaid, or no fee). */
export type CodFeeApplication = AgentShippingCodFeeMode | 'NONE';

export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = [
  'CARRIER',
  'INTERNAL_COURIER',
];

/** The four concrete services, in the order every screen lists them. */
export const AGENT_SHIPPING_SERVICES: readonly ConcreteShippingService[] = [
  'PREPAID_CARRIER',
  'COD_CARRIER',
  'COD_INTERNAL_COURIER',
  'PREPAID_INTERNAL_COURIER',
];

export const isCodService = (service: AgentShippingService) =>
  service === 'COD_CARRIER' || service === 'COD_INTERNAL_COURIER';

/** (delivery channel, payment type) → the agreement service it is priced by. */
export function serviceOf(
  channel: DeliveryChannel,
  paymentType: OrderPaymentType,
): ConcreteShippingService {
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
  /** R17 §3 — absent = ADDED (rows written before the COD fee existed). */
  codFee?: AgentShippingCodFeeMode;
}

export interface TariffDestination {
  countryId: string | null | undefined;
  city: string | null | undefined;
}

export interface ResolvedTariff {
  id: string;
  /** The agent shipping charge: base + COD fee (ADDED) or base. */
  amount: number;
  /** The winning row's amount. */
  base: number;
  /** COD collection fee added on top of the base (0 when none applies). */
  codFee: number;
  codFeeMode: CodFeeApplication;
  /** The concrete service the charge is for. */
  service: AgentShippingService;
  /** The winning row's service (`ANY` = the default row). */
  rowService: AgentShippingService;
  /** How specific the winning row's destination is. */
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

/**
 * The first service × destination listed twice (null = none) — the rule the
 * API enforces on every save ("<service>#<destinationKey>").
 */
export function duplicateRateKey(
  rows: ReadonlyArray<Pick<TariffRow, 'service' | 'countryId' | 'city'>>,
): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.service}#${destinationKeyOf(row.countryId, row.city)}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

const SPECIFICITY: Record<TariffScope, number> = {
  CITY: 2,
  COUNTRY: 1,
  ALL: 0,
};

/** Destination first (×2), then service-specific over `ANY` (+1). */
const rank = (scope: TariffScope, exactService: boolean) =>
  SPECIFICITY[scope] * 2 + (exactService ? 1 : 0);

/**
 * The charge of one concrete service to a destination. `codCollectionFee` =
 * the agreement's COD collection fee (null / 0 = none).
 */
export function resolveTariff(
  rows: readonly TariffRow[],
  destination: TariffDestination,
  service: AgentShippingService,
  codCollectionFee: number | null = null,
): ResolvedTariff | null {
  const wantedCity = normalizeTariffCity(destination.city);
  let best: { row: TariffRow; scope: TariffScope; rank: number } | null = null;
  for (const row of rows) {
    if (row.service !== service && row.service !== 'ANY') continue;
    const scope = tariffScopeOf(row);
    if (scope !== 'ALL' && row.countryId !== destination.countryId) continue;
    if (scope === 'CITY' && normalizeTariffCity(row.city) !== wantedCity) {
      continue;
    }
    const score = rank(scope, row.service === service);
    if (!best || score > best.rank) best = { row, scope, rank: score };
  }
  if (!best) return null;
  const base = best.row.amount;
  const fee = toMinor(codCollectionFee ?? 0);
  let codFeeMode: CodFeeApplication = 'NONE';
  let codFee = 0;
  if (isCodService(service)) {
    if ((best.row.codFee ?? 'ADDED') === 'INCLUDED') codFeeMode = 'INCLUDED';
    else if (fee > 0) {
      codFeeMode = 'ADDED';
      codFee = fromMinor(fee);
    }
  }
  return {
    id: best.row.id,
    amount: fromMinor(toMinor(base) + toMinor(codFee)),
    base,
    codFee,
    codFeeMode,
    service,
    rowService: best.row.service,
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
  codCollectionFee: number | null = null,
): SubmissionTariff | null {
  const byChannel = {} as Record<DeliveryChannel, ResolvedTariff | null>;
  for (const channel of DELIVERY_CHANNELS) {
    byChannel[channel] = resolveTariff(
      rows,
      destination,
      serviceOf(channel, paymentType),
      codCollectionFee,
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
    ConcreteShippingService,
    {
      rateId: string;
      amount: number;
      base: number;
      codFeeMode: CodFeeApplication;
      inherited: boolean;
      rowService: AgentShippingService;
    } | null
  >;
}

export interface ShippingAgreementCoverage {
  destinations: CoverageDestination[];
  missing: Array<{
    destinationKey: string;
    countryId: string | null;
    city: string;
    service: ConcreteShippingService;
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
  codCollectionFee: number | null = null,
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
      const hit = resolveTariff(
        rows,
        { countryId, city },
        service,
        codCollectionFee,
      );
      cells[service] = hit
        ? {
            rateId: hit.id,
            amount: hit.amount,
            base: hit.base,
            codFeeMode: hit.codFeeMode,
            // Charged by a broader destination's row.
            inherited: hit.scope !== scope,
            // ANY = the agreement's default (every-service) row.
            rowService: hit.rowService,
          }
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
const fromMinor = (minor: number) => minor / 100;
