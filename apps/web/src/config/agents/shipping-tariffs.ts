import type {
  AgentShippingRate,
  TariffDeliveryChannel,
  TariffPaymentType,
} from "@/services/agents-service";

/**
 * Agent shipping tariffs (spec-2-agent-pricing.md 2B) — the same "most
 * specific row wins" rule the API applies (city → channel → payment type),
 * used to show the resolved fee per destination next to the editable rows.
 */
export type DeliveryChannel = Exclude<TariffDeliveryChannel, "ANY">;
export type OrderPaymentType = Exclude<TariffPaymentType, "ANY">;

export const TARIFF_CHANNELS: readonly DeliveryChannel[] = ["CARRIER", "INTERNAL_COURIER"];
export const TARIFF_PAYMENT_TYPES: readonly OrderPaymentType[] = ["PREPAID", "CASH_ON_DELIVERY"];

type TariffRate = Pick<
  AgentShippingRate,
  "id" | "countryId" | "city" | "deliveryChannel" | "paymentType" | "amount"
>;

const normalizeCity = (city: string | null | undefined) => (city ?? "").trim().toLocaleLowerCase();

const specificity = (rate: TariffRate) =>
  (normalizeCity(rate.city) ? 4 : 0) +
  (rate.deliveryChannel !== "ANY" ? 2 : 0) +
  (rate.paymentType !== "ANY" ? 1 : 0);

export function resolveTariffRate<T extends TariffRate>(
  rates: readonly T[],
  destination: { countryId: string; city?: string | null },
  channel: DeliveryChannel,
  paymentType: OrderPaymentType,
): T | null {
  const wanted = normalizeCity(destination.city);
  let best: T | null = null;
  for (const rate of rates) {
    if (rate.countryId !== destination.countryId) continue;
    const city = normalizeCity(rate.city);
    if (city && city !== wanted) continue;
    if (rate.deliveryChannel !== "ANY" && rate.deliveryChannel !== channel) continue;
    if (rate.paymentType !== "ANY" && rate.paymentType !== paymentType) continue;
    if (!best || specificity(rate) > specificity(best)) best = rate;
  }
  return best;
}

export type TariffCellKey = `${DeliveryChannel}:${OrderPaymentType}`;

export const TARIFF_CELLS: readonly {
  key: TariffCellKey;
  channel: DeliveryChannel;
  paymentType: OrderPaymentType;
}[] = TARIFF_CHANNELS.flatMap((channel) =>
  TARIFF_PAYMENT_TYPES.map((paymentType) => ({
    key: `${channel}:${paymentType}` as TariffCellKey,
    channel,
    paymentType,
  })),
);

export interface TariffMatrixRow<T extends TariffRate> {
  key: string;
  countryId: string;
  /** '' = the whole country. */
  city: string;
  cells: Record<TariffCellKey, T | null>;
}

/**
 * One row per configured destination (country, or country + city) with the
 * resolved fee for every channel × payment type — null = not configured
 * (Shipping cannot assign that delivery method there).
 */
export function tariffMatrix<T extends TariffRate>(rates: readonly T[]): TariffMatrixRow<T>[] {
  const destinations = new Map<string, { countryId: string; city: string }>();
  for (const rate of rates) {
    const key = `${rate.countryId}|${normalizeCity(rate.city)}`;
    if (!destinations.has(key)) {
      destinations.set(key, { countryId: rate.countryId, city: rate.city.trim() });
    }
  }
  return [...destinations.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, destination]) => ({
      key,
      ...destination,
      cells: Object.fromEntries(
        TARIFF_CELLS.map((cell) => [
          cell.key,
          resolveTariffRate(rates, destination, cell.channel, cell.paymentType),
        ]),
      ) as Record<TariffCellKey, T | null>,
    }));
}
