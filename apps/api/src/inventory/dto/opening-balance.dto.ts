import { IsNumber, IsOptional, Min } from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

export class OpeningBalanceDto extends BaseQuantityMovementDto {
  /** TASK-028 Part 6 — optional average cost recorded alongside the opening quantity. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;
}
