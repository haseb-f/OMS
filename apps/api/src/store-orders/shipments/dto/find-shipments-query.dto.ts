import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ShipmentStatus, StoreOrderSource } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** Flat, cross-order shipment listing for the Shipping list page. */
export class FindShipmentsQueryDto {
  @IsEnum(ShipmentStatus)
  @IsOptional()
  status?: ShipmentStatus;

  @IsOptionalUuid()
  shippingCompanyId?: string;

  /** The order's Customer's Country (Part 2 of the four-gaps task) — there is no separate shipping-address concept in this pipeline yet. */
  @IsOptionalUuid()
  countryId?: string;

  /** The shipment's own Store Order's `source` (Manual vs Import) — same field the Store Orders list filters by. */
  @IsEnum(StoreOrderSource)
  @IsOptional()
  source?: StoreOrderSource;

  /** Matches the order's customer phone/mobile OR the order's externalOrderId. */
  @IsString()
  @IsOptional()
  search?: string;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 20;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
