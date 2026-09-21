import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class StoreOrderLineAmountDto {
  @IsUUID()
  itemId!: string;

  /** The agreed selling amount for the whole line (independent of quantity). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  agreedAmount!: number;
}

/**
 * Pricing correction for a Store Order that was created without its agreed
 * amounts (e.g. a lead conversion saved with 0.00). Only the amounts change —
 * products and quantities stay as ordered.
 */
export class SetStoreOrderLineAmountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoreOrderLineAmountDto)
  items!: StoreOrderLineAmountDto[];
}
