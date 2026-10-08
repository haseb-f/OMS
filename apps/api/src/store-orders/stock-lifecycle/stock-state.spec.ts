import { InventoryMovementType } from '@prisma/client';
import {
  carryableUnits,
  computeStockState,
  proratedLineAmount,
  unitsCovered,
  type StockStateInput,
  type StockStateShipment,
} from './stock-state';
import { allocateReserved, type LedgerMovement } from './stock-reservations';
import {
  parseStoreOrderKey,
  parseTransitKey,
  storeOrderMovementKey,
} from './stock-ledger';

/**
 * R15 W5a — the pure rules of the store-order stock lifecycle: per-line
 * state, order `stockStatus`, what a reship carries, prorated delivery
 * amounts, and the reading of the reserved ledger (keyed balances capped by
 * the real balance — R14 released without keys).
 */
const ITEM = '11111111-1111-1111-1111-111111111111';
const ITEM2 = '22222222-2222-2222-2222-222222222222';
const ORDER = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '44444444-4444-4444-4444-444444444444';
const WH = '55555555-5555-5555-5555-555555555555';

const input = (overrides: Partial<StockStateInput> = {}): StockStateInput => ({
  items: [{ id: ITEM, quantity: 3, stockLine: true }],
  shipments: [],
  reservedUnits: new Map(),
  issuedWhole: new Set(),
  active: true,
  ...overrides,
});

const attempt = (
  attemptNumber: number,
  status: string | null,
  lines: Array<[string, number, number?, number?]>,
  isReship = false,
): StockStateShipment => ({
  id: `s${attemptNumber}`,
  attemptNumber,
  isReship,
  status,
  lines: lines.map(([item, quantity, delivered = 0, returned = 0], index) => ({
    id: `l${attemptNumber}-${index}`,
    storeOrderItemId: item,
    quantity,
    deliveredQuantity: delivered,
    returnedQuantity: returned,
  })),
});

describe('computeStockState', () => {
  it('reserved at creation → RESERVED; nothing reserved → SHORT; services only → NOT_REQUIRED', () => {
    expect(
      computeStockState(input({ reservedUnits: new Map([[ITEM, 3]]) })).status,
    ).toBe('RESERVED');
    const short = computeStockState(input());
    expect(short.status).toBe('SHORT');
    expect(short.lines.get(ITEM)).toMatchObject({ open: 3, missing: 3 });
    expect(
      computeStockState(
        input({ items: [{ id: ITEM, quantity: 1, stockLine: false }] }),
      ).status,
    ).toBe('NOT_REQUIRED');
  });

  it('dispatch → IN_TRANSIT; a failed attempt → RETURNING; partial delivery → PARTIALLY_DELIVERED; all → DELIVERED', () => {
    expect(
      computeStockState(
        input({ shipments: [attempt(1, 'SHIPPED', [[ITEM, 3]])] }),
      ).status,
    ).toBe('IN_TRANSIT');
    const failed = computeStockState(
      input({ shipments: [attempt(1, 'DELIVERY_FAILED', [[ITEM, 3]])] }),
    );
    expect(failed.status).toBe('RETURNING');
    expect(failed.lines.get(ITEM)).toMatchObject({
      inTransit: 3,
      open: 0,
      missing: 0,
    });
    const partial = computeStockState(
      input({
        shipments: [attempt(1, 'DELIVERED', [[ITEM, 2, 1]])],
        reservedUnits: new Map([[ITEM, 1]]),
      }),
    );
    expect(partial.status).toBe('PARTIALLY_DELIVERED');
    expect(partial.lines.get(ITEM)).toMatchObject({
      delivered: 1,
      inTransit: 1,
      reserved: 1,
      open: 1,
      missing: 0,
    });
    expect(
      computeStockState(
        input({ shipments: [attempt(1, 'DELIVERED', [[ITEM, 3, 3]])] }),
      ).status,
    ).toBe('DELIVERED');
  });

  it('a reship carries the failed attempt’s units (no second dispatch); received-back units leave transit', () => {
    const shipments = [
      attempt(1, 'NEEDS_RESHIPMENT', [[ITEM, 3]]),
      attempt(2, 'SHIPPED', [[ITEM, 3]], true),
    ];
    const state = computeStockState(input({ shipments }));
    expect(state.carried.get('l2-0')).toBe(3);
    expect(state.loose.get('l1-0')).toBe(0);
    expect(state.loose.get('l2-0')).toBe(3);
    expect(state.lines.get(ITEM)).toMatchObject({
      dispatched: 3,
      inTransit: 3,
    });

    // Before the reship is dispatched it can carry the 3 loose units.
    const waiting = [
      attempt(1, 'NEEDS_RESHIPMENT', [[ITEM, 3]]),
      attempt(2, null, [], true),
    ];
    const pending = computeStockState(input({ shipments: waiting }));
    expect(carryableUnits(pending, waiting, waiting[1]).get(ITEM)).toBe(3);
    // A "next shipment" (not a reship) carries nothing.
    expect(
      carryableUnits(pending, waiting, { attemptNumber: 2, isReship: false })
        .size,
    ).toBe(0);

    const back = computeStockState(
      input({
        shipments: [attempt(1, 'DELIVERY_FAILED', [[ITEM, 3, 0, 2]])],
        reservedUnits: new Map([[ITEM, 2]]),
      }),
    );
    expect(back.lines.get(ITEM)).toMatchObject({
      inTransit: 1,
      returned: 2,
      reserved: 2,
      open: 2,
    });
  });

  it('a cancelled order: goods out → RETURNING, received back → RETURNED, never out → RELEASED; never short', () => {
    expect(
      computeStockState(
        input({
          active: false,
          shipments: [attempt(1, 'SHIPPED', [[ITEM, 3]])],
        }),
      ).status,
    ).toBe('RETURNING');
    const returned = computeStockState(
      input({
        active: false,
        shipments: [attempt(1, 'SHIPPED', [[ITEM, 3, 0, 3]])],
      }),
    );
    expect(returned.status).toBe('RETURNED');
    expect(returned.lines.get(ITEM)!.missing).toBe(0);
    expect(computeStockState(input({ active: false })).status).toBe('RELEASED');
  });

  it('lines issued whole (pickup, R14 invoice) are delivered; a pre-R15 agent dispatch still out is IN_TRANSIT', () => {
    const issuedWhole = new Set([ITEM]);
    expect(computeStockState(input({ issuedWhole })).status).toBe('DELIVERED');
    expect(
      computeStockState(
        input({ issuedWhole, shipments: [attempt(1, 'SHIPPED', [])] }),
      ).status,
    ).toBe('IN_TRANSIT');
  });

  it('a catalog "returning" status is not "with the carrier"', () => {
    expect(
      computeStockState(
        input({ shipments: [attempt(1, 'RETURNING', [[ITEM, 3]])] }),
      ).status,
    ).toBe('RETURNING');
  });
});

describe('proratedLineAmount / unitsCovered', () => {
  it('deliveries of a line add up to its agreed amount exactly (the last takes the remainder)', () => {
    const first = proratedLineAmount(100, 3, 0, 1);
    const second = proratedLineAmount(100, 3, 1, 1);
    const third = proratedLineAmount(100, 3, 2, 1);
    expect([first, second, third]).toEqual([33.33, 33.34, 33.33]);
    expect(Math.round((first + second + third) * 100) / 100).toBe(100);
    expect(proratedLineAmount(100, 3, 0, 3)).toBe(100);
    expect(proratedLineAmount(0, 2, 0, 1)).toBe(0);
  });

  it('a kit is covered in whole kits by its least-covered component', () => {
    const perKit = new Map([
      ['a', 2],
      ['b', 1],
    ]);
    expect(
      unitsCovered(
        perKit,
        new Map([
          ['a', 5],
          ['b', 4],
        ]),
      ),
    ).toBe(2);
    expect(unitsCovered(perKit, new Map([['a', 6]]))).toBe(0);
  });
});

describe('ledger keys and the reserved ledger', () => {
  it('parses the keys it writes (with or without a kit component)', () => {
    const plain = storeOrderMovementKey(
      ORDER,
      { lineKey: ITEM, productId: PRODUCT },
      'RESERVATION',
      4,
    );
    expect(plain).toBe(`STORE_ORDER:${ORDER}:${ITEM}:RESERVATION:4`);
    expect(parseStoreOrderKey(plain)).toEqual({
      lineKey: ITEM,
      componentId: null,
      type: 'RESERVATION',
    });
    const component = storeOrderMovementKey(
      ORDER,
      { lineKey: ITEM, productId: PRODUCT, parentProductId: ITEM2 },
      'RESERVATION_RELEASE',
      5,
    );
    expect(parseStoreOrderKey(component)).toEqual({
      lineKey: ITEM,
      componentId: PRODUCT,
      type: 'RESERVATION_RELEASE',
    });
    expect(parseStoreOrderKey('SALES_INVOICE:x:y:SALES_DELIVERY')).toBeNull();
    expect(
      parseTransitKey(`STORE_ORDER_TRANSIT:${ITEM}:${PRODUCT}:BACK:abc-1:IN`),
    ).toEqual({ shipmentLineId: ITEM, componentId: PRODUCT, back: true });
  });

  it('keyed balances are capped by the real balance (R14 released without a key)', () => {
    const movement = (
      type: InventoryMovementType,
      quantity: number,
      key: string | null,
    ): LedgerMovement => ({
      type,
      referenceType: 'STORE_ORDER',
      productId: PRODUCT,
      warehouseId: WH,
      quantity,
      idempotencyKey: key,
    });
    const r14 = [
      movement('RESERVATION', 2, `STORE_ORDER:${ORDER}:${ITEM}:RESERVATION`),
      movement('RESERVATION', 1, `STORE_ORDER:${ORDER}:${ITEM2}:RESERVATION`),
      movement('RESERVATION_RELEASE', -3, null),
    ];
    expect(allocateReserved(r14, [ITEM, ITEM2])).toEqual([]);

    const partlyReleased = [
      ...r14,
      movement('RESERVATION', 3, `STORE_ORDER:${ORDER}:${ITEM}:RESERVATION:3`),
      movement(
        'RESERVATION_RELEASE',
        -1,
        `STORE_ORDER:${ORDER}:${ITEM}:RESERVATION_RELEASE:4`,
      ),
    ];
    expect(allocateReserved(partlyReleased, [ITEM, ITEM2])).toEqual([
      { lineKey: ITEM, productId: PRODUCT, warehouseId: WH, quantity: 2 },
    ]);
    // A balance no key explains is still released (unattributed).
    expect(
      allocateReserved([movement('RESERVATION', 2, null)], [ITEM]),
    ).toEqual([
      { lineKey: 'ORDER', productId: PRODUCT, warehouseId: WH, quantity: 2 },
    ]);
  });
});
