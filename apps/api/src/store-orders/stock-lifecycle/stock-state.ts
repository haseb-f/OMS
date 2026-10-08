import { StoreOrderStockStatus } from '@prisma/client';

/**
 * R15 W5a (spec §1) — the per-line physical state of a store order and its
 * `stockStatus`, derived from the ledger-backed facts the service reads:
 * the line units currently reserved (reserved ledger), the shipment lines
 * (dispatched / accepted / received back per attempt) and the lines issued
 * whole straight from a warehouse. Pure, so every rule is unit-tested.
 *
 * Units are order-line units (a kit counts kits, not components).
 *
 *  - A reshipment (`isReship`) carries the previous attempt's loose units
 *    (still with the carrier, neither accepted nor received back): they were
 *    transferred to transit once, by the earlier attempt. Any further units
 *    on the reship came from the reservation (a new transfer).
 *  - in transit = units transferred − accepted − received back.
 *  - open = ordered − delivered − in transit (what still has to leave);
 *    missing = open − reserved (never silently oversold → SHORT).
 */
export interface StockStateItem {
  id: string;
  quantity: number;
  /** Moves stock (tracked item or kit); services / digital lines never do. */
  stockLine: boolean;
}

export interface StockStateShipmentLine {
  id: string;
  storeOrderItemId: string;
  quantity: number;
  deliveredQuantity: number;
  returnedQuantity: number;
}

export interface StockStateShipment {
  id: string;
  attemptNumber: number;
  isReship: boolean;
  status: string | null;
  lines: StockStateShipmentLine[];
}

export interface StockStateInput {
  items: StockStateItem[];
  shipments: StockStateShipment[];
  /** Line units currently held reserved for the order, per item. */
  reservedUnits: ReadonlyMap<string, number>;
  /**
   * Lines issued whole straight from a warehouse: pickup handover, an R14
   * whole-order invoice, a pre-R15 agent dispatch. Delivered in full.
   */
  issuedWhole: ReadonlySet<string>;
  /** Not archived / cancelled. */
  active: boolean;
}

export interface LineStockState {
  itemId: string;
  ordered: number;
  reserved: number;
  /** Units transferred to transit (new dispatches, never a carried unit twice). */
  dispatched: number;
  inTransit: number;
  delivered: number;
  returned: number;
  open: number;
  missing: number;
}

export interface StockState {
  lines: Map<string, LineStockState>;
  /** Units a reship attempt line carried from the previous attempt. */
  carried: Map<string, number>;
  /** Units of an attempt line still with the carrier and not carried on. */
  loose: Map<string, number>;
  status: StoreOrderStockStatus;
}

/** Shipment statuses of a parcel on its way to the customer. */
export const OUT_WITH_CARRIER: ReadonlySet<string> = new Set([
  'SHIPPED',
  'OUT_FOR_DELIVERY',
]);

const byAttempt = (a: StockStateShipment, b: StockStateShipment) =>
  a.attemptNumber - b.attemptNumber;

/** The dispatched attempt immediately before `index` (attempts without lines never carried anything). */
function previousDispatched(
  sorted: StockStateShipment[],
  index: number,
): StockStateShipment | null {
  for (let i = index - 1; i >= 0; i--) {
    if (sorted[i].lines.length > 0) return sorted[i];
  }
  return null;
}

const lineOf = (shipment: StockStateShipment | null, itemId: string) =>
  shipment?.lines.find((line) => line.storeOrderItemId === itemId) ?? null;

const remaining = (line: StockStateShipmentLine | null) =>
  line
    ? Math.max(
        0,
        line.quantity - line.deliveredQuantity - line.returnedQuantity,
      )
    : 0;

export function computeStockState(input: StockStateInput): StockState {
  const sorted = [...input.shipments].sort(byAttempt);
  const carried = new Map<string, number>();
  sorted.forEach((shipment, index) => {
    if (!shipment.isReship || shipment.lines.length === 0) return;
    const previous = previousDispatched(sorted, index);
    for (const line of shipment.lines) {
      carried.set(
        line.id,
        Math.min(
          line.quantity,
          remaining(lineOf(previous, line.storeOrderItemId)),
        ),
      );
    }
  });

  const loose = new Map<string, number>();
  sorted.forEach((shipment, index) => {
    const next = sorted
      .slice(index + 1)
      .find((candidate) => candidate.lines.length > 0);
    const carriedOn = next?.isReship ? next : null;
    for (const line of shipment.lines) {
      const forward = carriedOn
        ? (carried.get(lineOf(carriedOn, line.storeOrderItemId)?.id ?? '') ?? 0)
        : 0;
      loose.set(line.id, Math.max(0, remaining(line) - forward));
    }
  });

  const lines = new Map<string, LineStockState>();
  for (const item of input.items) {
    if (!item.stockLine) continue;
    const own = sorted.flatMap((shipment) =>
      shipment.lines.filter((line) => line.storeOrderItemId === item.id),
    );
    const dispatched = own.reduce(
      (sum, line) => sum + line.quantity - (carried.get(line.id) ?? 0),
      0,
    );
    const accepted = own.reduce((sum, line) => sum + line.deliveredQuantity, 0);
    const returned = own.reduce((sum, line) => sum + line.returnedQuantity, 0);
    const whole = input.issuedWhole.has(item.id);
    const delivered = whole ? item.quantity : Math.min(accepted, item.quantity);
    const inTransit = whole ? 0 : Math.max(0, dispatched - accepted - returned);
    const reserved = whole ? 0 : (input.reservedUnits.get(item.id) ?? 0);
    const open = Math.max(0, item.quantity - delivered - inTransit);
    lines.set(item.id, {
      itemId: item.id,
      ordered: item.quantity,
      reserved,
      dispatched,
      inTransit,
      delivered,
      returned,
      open,
      missing: input.active ? Math.max(0, open - reserved) : 0,
    });
  }

  return {
    lines,
    carried,
    loose,
    status: orderStockStatus(
      [...lines.values()],
      sorted.at(-1)?.status ?? null,
      input.active,
    ),
  };
}

/** Order-level summary of the line states (see `StoreOrderStockStatus`). */
export function orderStockStatus(
  lines: LineStockState[],
  latestShipmentStatus: string | null,
  active: boolean,
): StoreOrderStockStatus {
  if (lines.length === 0) return StoreOrderStockStatus.NOT_REQUIRED;
  const sum = (pick: (line: LineStockState) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const ordered = sum((l) => l.ordered);
  const delivered = sum((l) => l.delivered);
  const inTransit = sum((l) => l.inTransit);
  const returned = sum((l) => l.returned);
  const reserved = sum((l) => l.reserved);
  const missing = sum((l) => l.missing);
  const withCarrier =
    latestShipmentStatus !== null && OUT_WITH_CARRIER.has(latestShipmentStatus);

  if (!active) {
    if (inTransit > 0) return StoreOrderStockStatus.RETURNING;
    if (delivered > 0) {
      return delivered >= ordered
        ? StoreOrderStockStatus.DELIVERED
        : StoreOrderStockStatus.PARTIALLY_DELIVERED;
    }
    return returned > 0
      ? StoreOrderStockStatus.RETURNED
      : StoreOrderStockStatus.RELEASED;
  }
  if (delivered >= ordered) {
    // Issued whole at a pre-R15 agent dispatch, parcel still on its way.
    return withCarrier && lines.every((line) => line.dispatched === 0)
      ? StoreOrderStockStatus.IN_TRANSIT
      : StoreOrderStockStatus.DELIVERED;
  }
  if (delivered > 0) return StoreOrderStockStatus.PARTIALLY_DELIVERED;
  if (inTransit > 0) {
    return withCarrier
      ? StoreOrderStockStatus.IN_TRANSIT
      : StoreOrderStockStatus.RETURNING;
  }
  if (missing > 0) return StoreOrderStockStatus.SHORT;
  if (reserved > 0) return StoreOrderStockStatus.RESERVED;
  return StoreOrderStockStatus.PENDING;
}

/**
 * What a new (not yet dispatched) attempt carries per item: a reship carries
 * the loose units of the attempt it replaces; any other attempt carries none.
 */
export function carryableUnits(
  state: Pick<StockState, 'loose'>,
  shipments: StockStateShipment[],
  shipment: Pick<StockStateShipment, 'attemptNumber' | 'isReship'>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!shipment.isReship) return result;
  const previous = [...shipments]
    .filter(
      (candidate) =>
        candidate.attemptNumber < shipment.attemptNumber &&
        candidate.lines.length > 0,
    )
    .sort(byAttempt)
    .at(-1);
  for (const line of previous?.lines ?? []) {
    const units = state.loose.get(line.id) ?? 0;
    if (units > 0) result.set(line.storeOrderItemId, units);
  }
  return result;
}

/**
 * Line units a set of component quantities covers: a plain line is its own
 * product; a kit counts whole kits by its least-covered component.
 */
export function unitsCovered(
  perUnit: ReadonlyMap<string, number>,
  quantities: ReadonlyMap<string, number>,
): number {
  let units = Number.POSITIVE_INFINITY;
  for (const [productId, per] of perUnit) {
    if (per <= 0) continue;
    units = Math.min(
      units,
      Math.floor(Math.max(quantities.get(productId) ?? 0, 0) / per),
    );
  }
  return Number.isFinite(units) ? units : 0;
}

/**
 * Order-line amount of `accepted` units delivered on one shipment: the line's
 * agreed amount prorated by cumulative delivered units (`deliveredBefore` on
 * earlier attempts), rounded to 2 dp — so the deliveries of a line always add
 * up to the agreed amount exactly (the last one takes the remainder).
 */
export function proratedLineAmount(
  agreedAmount: number,
  ordered: number,
  deliveredBefore: number,
  accepted: number,
): number {
  if (ordered <= 0) return 0;
  const upTo = (units: number) =>
    Math.round(((agreedAmount * Math.min(units, ordered)) / ordered) * 100) /
    100;
  return (
    Math.round(
      (upTo(deliveredBefore + accepted) - upTo(deliveredBefore)) * 100,
    ) / 100
  );
}
