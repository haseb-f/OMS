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
import {
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
  StoreOrderSource,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class FindStoreOrdersQueryDto {
  @IsOptionalUuid()
  customerId?: string;

  /** Matches the Customer's phone OR mobile — never the Order's own key (rule: "Phone is the CUSTOMER matching key, never the Order key"). */
  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(StoreOrderPaymentStatus)
  @IsOptional()
  paymentStatus?: StoreOrderPaymentStatus;

  @IsEnum(StoreOrderShippingStage)
  @IsOptional()
  shippingStage?: StoreOrderShippingStage;

  @IsEnum(StoreOrderSource)
  @IsOptional()
  source?: StoreOrderSource;

  /** Matches internalOrderId, externalOrderId, or customer name (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;

  /** Filters by `orderDate`. */
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

  @IsString()
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
