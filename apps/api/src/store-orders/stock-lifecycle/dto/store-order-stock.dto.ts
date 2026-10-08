import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One order line and a quantity (dispatch selection / accepted at delivery). */
export class StockLineQuantityDto {
  @IsUUID()
  storeOrderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class ReceiveBackLineDto {
  @IsUUID()
  storeOrderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsIn(['SALEABLE', 'DAMAGED'])
  condition!: 'SALEABLE' | 'DAMAGED';

  /** Default: the line's warehouse (saleable) / the damaged-goods warehouse. */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

/** `POST /store-orders/:id/stock/receive-back` — physical receipt + inspection of goods that came back undelivered. */
export class ReceiveBackDto {
  /** One receipt = one key: a retry of the same receipt changes nothing. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveBackLineDto)
  lines!: ReceiveBackLineDto[];
}

/** `POST /store-orders/stock/reserve-short` — bounded batch, oldest first. */
export class ReserveShortDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AvailabilityLineDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

/** `POST /store-orders/stock/availability` — what each order-form line could reserve right now. */
export class StockAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityLineDto)
  lines!: AvailabilityLineDto[];
}

/** `POST /store-orders/stock-backfill` — dry run unless `dryRun: false` (super admin). */
export class StockBackfillDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  orderIds?: string[];
}
