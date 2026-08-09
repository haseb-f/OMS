import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Partial-quantity aware: `quantity` may be less than the order line's
 * remaining (ordered minus already-delivered) quantity — this is what
 * drives the order into PARTIALLY_DELIVERED instead of DELIVERED. */
export class ConvertOrderToInvoiceLineDto {
  @IsUUID()
  salesOrderItemId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class ConvertOrderToInvoiceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConvertOrderToInvoiceLineDto)
  items!: ConvertOrderToInvoiceLineDto[];
}
