import { ShipmentStatus } from '@prisma/client';
import { canTransitionShipmentStatus } from './store-order-shipment-transitions';

describe('store-order-shipment-transitions', () => {
  it('allows the operational happy path and rejects invalid jumps', () => {
    expect(canTransitionShipmentStatus(null, ShipmentStatus.SHIPPED)).toBe(
      true,
    );
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.LABEL_CREATED,
        ShipmentStatus.SHIPPED,
      ),
    ).toBe(true);
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.SHIPPED,
        ShipmentStatus.DELIVERED,
      ),
    ).toBe(true);
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.DELIVERY_FAILED,
        ShipmentStatus.NEEDS_RESHIPMENT,
      ),
    ).toBe(true);
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.DELIVERED,
        ShipmentStatus.SHIPPED,
      ),
    ).toBe(false);
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.LABEL_CREATED,
        ShipmentStatus.DELIVERED,
      ),
    ).toBe(false);
    expect(
      canTransitionShipmentStatus(
        ShipmentStatus.SHIPPED,
        ShipmentStatus.NEEDS_RESHIPMENT,
      ),
    ).toBe(false);
  });
});
