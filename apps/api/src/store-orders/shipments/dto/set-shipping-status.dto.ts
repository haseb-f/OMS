import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Direct "change to any status" operation — Shipping Status Configuration +
 * Final-Shipment Sync Rules: no forced sequence, no rigid transition
 * matrix. Users with permission may move a shipment straight to any active
 * `ShippingStatus` row, including reopening a `FINAL` shipment back to
 * `UNDER_SYNC` (the frontend confirms that specific case before calling).
 */
export class SetShippingStatusDto {
  @IsString()
  @IsNotEmpty()
  shippingStatusId!: string;
}
