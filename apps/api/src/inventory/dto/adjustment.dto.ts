import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  NotEquals,
} from 'class-validator';

/** Signed delta — positive increases stock, negative decreases it. Zero is meaningless and rejected. */
export class AdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @NotEquals(0)
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
