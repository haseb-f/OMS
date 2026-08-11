import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

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

  @IsOptionalUuid()
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

  @IsOptionalUuid()
  taxId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
