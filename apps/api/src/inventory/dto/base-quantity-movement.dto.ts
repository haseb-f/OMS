import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * Shared shape for the single-warehouse, positive-quantity business
 * operations (Opening Balance, Damage, Expired, Reserve, Release) — each
 * carries no meaning beyond "how much, of what, where."
 */
export abstract class BaseQuantityMovementDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
