import { createHash } from 'node:crypto';
import { stockLineMovementKey } from '../../sales/shared/stock-fulfillment';
import type { ResolvedStockLine } from '../../inventory/stock-lines/stock-line-resolver';

/**
 * R15 W5a (spec §1) — the movement references and idempotency keys of the
 * store-order stock lifecycle. The ledger is the truth; every key carries the
 * document line it belongs to so the per-line state can be read back from it.
 *
 * | reference             | movements                                         | key                                                                   |
 * | --------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
 * | `STORE_ORDER`         | RESERVATION / RESERVATION_RELEASE                 | `STORE_ORDER:<order>:<item>[:<component>]:<TYPE>:<seq>`               |
 * | `STORE_ORDER_TRANSIT` | TRANSFER warehouse → WH-TRANSIT and back          | `STORE_ORDER_TRANSIT:<shipmentLine>[:<component>][:<n>]:OUT\|IN`       |
 * |                       |                                                   | back: `STORE_ORDER_TRANSIT:<shipmentLine>[:<component>]:BACK:<receipt>:OUT\|IN` |
 * | `SALES_INVOICE`       | SALES_DELIVERY (company, out of WH-TRANSIT)       | `SALES_INVOICE:<invoice>:<invoiceItem>[:<component>]:SALES_DELIVERY`  |
 * | `STORE_ORDER`         | SALES_DELIVERY (agent delivery out of WH-TRANSIT) | `STORE_ORDER:<order>:<shipmentLine>[:<component>]:SALES_DELIVERY`     |
 * | `STORE_ORDER`         | SALES_DELIVERY (pickup / pre-R15 agent dispatch)  | `STORE_ORDER:<order>:<item>[:<component>]:SALES_DELIVERY`             |
 *
 * Reservation keys of R14 had no `:<seq>` on the first cycle — they parse the
 * same way. R14 releases carried no key at all; the per-line reading caps the
 * keyed balance by the order's real reserved balance (see `allocateReserved`).
 */
export const STORE_ORDER_REFERENCE = 'STORE_ORDER';
export const STORE_ORDER_TRANSIT_REFERENCE = 'STORE_ORDER_TRANSIT';

/** `STORE_ORDER:<order>:<line>[:<component>]:<type>:<seq>`. */
export function storeOrderMovementKey(
  orderId: string,
  line: Pick<ResolvedStockLine, 'lineKey' | 'productId' | 'parentProductId'>,
  type: 'RESERVATION' | 'RESERVATION_RELEASE' | 'SALES_DELIVERY',
  seq?: number,
): string {
  const key = stockLineMovementKey(STORE_ORDER_REFERENCE, orderId, line, type);
  return seq === undefined ? key : `${key}:${seq}`;
}

/** Base of a transit transfer key (`…:OUT` / `…:IN` are appended by the writer). */
export function transitKeyBase(
  shipmentLineId: string,
  line: Pick<ResolvedStockLine, 'productId' | 'parentProductId'>,
  part?: string,
): string {
  return [
    STORE_ORDER_TRANSIT_REFERENCE,
    shipmentLineId,
    ...(line.parentProductId ? [line.productId] : []),
    ...(part ? [part] : []),
  ].join(':');
}

/** Base of a receive-back transfer key. */
export function backKeyBase(
  shipmentLineId: string,
  line: Pick<ResolvedStockLine, 'productId' | 'parentProductId'>,
  receipt: string,
): string {
  return `${transitKeyBase(shipmentLineId, line)}:BACK:${receipt}`;
}

/** Short, key-safe digest of a client idempotency key (one receive-back receipt). */
export function receiptDigest(clientKey: string): string {
  return createHash('sha256').update(clientKey).digest('hex').slice(0, 24);
}

/** The document line (+ component) a `STORE_ORDER:` / `STORE_ORDER_TRANSIT:` key belongs to. */
export interface ParsedLedgerKey {
  /** `<item>` / `<shipmentLine>` segment. */
  lineKey: string;
  componentId: string | null;
  type: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses `STORE_ORDER:<order>:<line>[:<component>]:<TYPE>[:<seq>]`; null for any other key. */
export function parseStoreOrderKey(
  key: string | null | undefined,
): ParsedLedgerKey | null {
  if (!key) return null;
  const parts = key.split(':');
  if (parts[0] !== STORE_ORDER_REFERENCE || parts.length < 4) return null;
  const lineKey = parts[2];
  const hasComponent = UUID.test(parts[3]);
  const type = hasComponent ? parts[4] : parts[3];
  if (!type) return null;
  return { lineKey, componentId: hasComponent ? parts[3] : null, type };
}

/** Parses `STORE_ORDER_TRANSIT:<shipmentLine>[:<component>]…`; null for any other key. */
export function parseTransitKey(key: string | null | undefined): {
  shipmentLineId: string;
  componentId: string | null;
  back: boolean;
} | null {
  if (!key) return null;
  const parts = key.split(':');
  if (parts[0] !== STORE_ORDER_TRANSIT_REFERENCE || parts.length < 3) {
    return null;
  }
  return {
    shipmentLineId: parts[1],
    componentId: UUID.test(parts[2]) ? parts[2] : null,
    back: parts.includes('BACK'),
  };
}
