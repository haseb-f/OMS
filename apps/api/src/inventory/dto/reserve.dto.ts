import { IsOptional, IsString, IsUUID } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

export class ReserveDto extends BaseQuantityMovementDto {
  /** Sales Foundation (TASK-037) — links this reservation back to its
   * source document (e.g. `referenceType: 'SALES_ORDER_DOC'`) so it can be
   * released precisely by that same reference on cancel. Optional and
   * backward-compatible: existing callers that omit these keep working
   * exactly as before. */
  @IsString()
  @IsOptional()
  referenceType?: string;

  @IsUUID()
  @IsOptional()
  referenceId?: string;
}
