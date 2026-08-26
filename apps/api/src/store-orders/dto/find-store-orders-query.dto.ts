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
import { TransformEnumList } from '../../common/query/enum-list';

export class FindStoreOrdersQueryDto {
  @IsOptionalUuid()
  customerId?: string;

  /** Matches the Customer's phone OR mobile — never the Order's own key (rule: "Phone is the CUSTOMER matching key, never the Order key"). */
  @IsString()
  @IsOptional()
  phone?: string;

  @TransformEnumList()
  @IsEnum(StoreOrderPaymentStatus, { each: true })
  @IsOptional()
  paymentStatus?: StoreOrderPaymentStatus[];

  @TransformEnumList()
  @IsEnum(StoreOrderShippingStage, { each: true })
  @IsOptional()
  shippingStage?: StoreOrderShippingStage[];

  @TransformEnumList()
  @IsEnum(StoreOrderSource, { each: true })
  @IsOptional()
  source?: StoreOrderSource[];

  /**
   * Complete Store Orders Search — matches internalOrderId, externalOrderId,
   * or customer name (case-insensitive, partial), and the customer's
   * phone/mobile via digit-only candidates (local trunk zero, "00"/"+"
   * international prefix, with/without calling code — see
   * `PhoneNumberService.searchCandidates`), so "564345678", "0564345678",
   * "966564345678", and "+966564345678" all find the same customer.
   */
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

  /** `GET /store-orders/ids` only — caps "select all"/"select first N" to the first N matching rows by `sortBy`/`sortOrder`, instead of the full (up to 10,000) matching set. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  @IsOptional()
  limit?: number;
}
