import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/** `subtotal` is caller-supplied, matching OrderItem's raw-value convention — but `taxId` is a real, optional lookup: the service resolves its rate and computes `taxAmount`/`lineTotal` server-side (0 tax when omitted). */
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

  @IsUUID()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
