import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Bulk "change to any status" from the Store Orders list — the exact same
 * per-order operation as `SetShippingStatusDto`
 * (`StoreOrderShipmentOperationsService.setShippingStatus`), applied
 * atomically per row with partial success allowed. Distinct from
 * `BulkUpdateShipmentsDto` (the flat Shipping list's bulk update, a fixed
 * set of named transitions over shipment ids) — this one accepts any active
 * catalog status over store order ids, matching the individual "direct
 * change to any status" capability exactly.
 */
export class BulkSetShippingStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  storeOrderIds!: string[];

  @IsString()
  @IsNotEmpty()
  shippingStatusId!: string;
}
