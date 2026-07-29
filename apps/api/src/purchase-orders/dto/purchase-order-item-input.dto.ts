import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/** No computed totals — subtotal is caller-supplied, matching OrderItem's raw-value convention. */
export class PurchaseOrderItemInputDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  quantity!: number;

  @IsUUID()
  @IsOptional()
  unitId?: string;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountPercent?: number;

  @IsNumber()
  @Min(0)
  subtotal!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
