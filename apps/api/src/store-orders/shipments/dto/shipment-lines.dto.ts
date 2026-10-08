import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { StockLineQuantityDto } from '../../stock-lifecycle/dto/store-order-stock.dto';

/**
 * R15 (D15-5) — `POST …/shipments/ship`: the quantities this parcel carries
 * per order line. Omitted = every reserved quantity (plus what a reshipment
 * carries). Agent orders ship whole and take no lines.
 */
export class MarkShippedDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockLineQuantityDto)
  lines?: StockLineQuantityDto[];
}

/**
 * R15 (D15-5) — `POST …/shipments/deliver`: the quantities the customer
 * accepted per order line. Omitted = everything the parcel carried; the rest
 * stays in transit until received back.
 */
export class MarkDeliveredDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StockLineQuantityDto)
  deliveredLines?: StockLineQuantityDto[];
}
