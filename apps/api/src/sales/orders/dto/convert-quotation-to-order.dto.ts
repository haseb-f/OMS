import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A Quotation line never carries a Warehouse (it's optional there, §1 of
 * the plan — a quote commits nothing) but a Sales Order line requires one,
 * so conversion must collect it at this step. `quantity` is an optional
 * override — omit it to carry the quotation's own quantity through
 * unchanged ("customer can adjust quantities on the new Order before
 * confirming").
 */
export class ConvertQuotationToOrderLineDto {
  @IsUUID()
  quotationItemId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  quantity?: number;
}

export class ConvertQuotationToOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConvertQuotationToOrderLineDto)
  items!: ConvertQuotationToOrderLineDto[];
}
