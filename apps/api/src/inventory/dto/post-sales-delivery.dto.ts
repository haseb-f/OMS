import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

/**
 * Sales Foundation (TASK-037) — posted when a Sales Invoice is confirmed.
 * Unlike Reserve/Release, the reference is required: a `SALES_DELIVERY`
 * movement should always be traceable back to the invoice that caused it.
 */
export class PostSalesDeliveryDto extends BaseQuantityMovementDto {
  @IsString()
  @IsNotEmpty()
  referenceType!: string;

  @IsUUID()
  referenceId!: string;
}
