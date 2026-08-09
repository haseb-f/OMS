import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

/**
 * Purchasing (TASK-048) — posted when a Purchase Return is confirmed.
 * Mirrors `PostSalesDeliveryDto` (both decrease on-hand stock); goods are
 * going back to the Supplier.
 */
export class PostPurchaseReturnDto extends BaseQuantityMovementDto {
  @IsString()
  @IsNotEmpty()
  referenceType!: string;

  @IsUUID()
  referenceId!: string;
}
