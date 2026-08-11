import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

/**
 * Bulk status transition applied atomically per row (partial success
 * allowed) — same validation as the single-item endpoint for that
 * transition (e.g. bulk "Mark Shipped" still requires each row's current
 * status to make that transition valid; a row that doesn't qualify fails
 * independently without blocking the rest).
 */
export class BulkUpdateShipmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  shipmentIds!: string[];

  @IsEnum(ShipmentStatus)
  targetStatus!: ShipmentStatus;
}
