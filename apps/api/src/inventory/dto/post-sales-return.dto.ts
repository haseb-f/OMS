import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

/** Sales Foundation (TASK-037) — posted when a Sales Return is confirmed. */
export class PostSalesReturnDto extends BaseQuantityMovementDto {
  @IsString()
  @IsNotEmpty()
  referenceType!: string;

  @IsUUID()
  referenceId!: string;
}
