import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  NotEquals,
} from 'class-validator';

/**
 * Signed delta — positive increases stock, negative decreases it. Zero is
 * meaningless and rejected. `reason` is required (TASK-029) — Notes stays a
 * free-form optional add-on, Reason is the structured "why" every
 * Adjustment must record.
 */
export class AdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @NotEquals(0)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
