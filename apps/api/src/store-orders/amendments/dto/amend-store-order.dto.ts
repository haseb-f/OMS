import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/**
 * Customer change (spec-1-orders.md 1A). `partnerId` switches a company
 * order to another existing customer; `name` / `phone` / `email` correct the
 * linked customer (company orders: the customer master, needs
 * `partners.edit`; agent orders: the customer as typed on the order).
 */
export class AmendCustomerDto {
  @IsOptionalUuid()
  partnerId?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @Transform(emptyToUndefined)
  @IsEmail()
  @IsOptional()
  @MaxLength(200)
  email?: string;
}

/** One line of the amended order — the full line list replaces the current one. */
export class AmendLineDto {
  /** Existing line being kept / changed; absent = a new line. */
  @IsOptionalUuid()
  itemId?: string;

  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  /**
   * Agreed line amount. Required on company orders and agent SHIPPING_ADDED
   * orders; an optional allocation weight on agent SHIPPING_INCLUDED orders.
   */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  agreedAmount?: number;
}

/** Destination (country / city / address). Present = replaces all three. */
export class AmendDestinationDto {
  @IsOptionalUuid()
  countryId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;
}

/**
 * Only the sections present change; everything else stays as it is. Notes
 * and the order owner keep their existing dedicated operations.
 */
export class AmendChangesDto {
  @ValidateNested()
  @Type(() => AmendCustomerDto)
  @IsOptional()
  customer?: AmendCustomerDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AmendLineDto)
  @IsOptional()
  items?: AmendLineDto[];

  @IsOptionalUuid()
  currencyId?: string;

  @IsIn(['PREPAID', 'CASH_ON_DELIVERY'])
  @IsOptional()
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';

  @IsIn(['SHIPPING', 'PICKUP'])
  @IsOptional()
  fulfillmentMethod?: 'SHIPPING' | 'PICKUP';

  @ValidateNested()
  @Type(() => AmendDestinationDto)
  @IsOptional()
  destination?: AmendDestinationDto;

  /** Agent orders only. */
  @IsIn(['SHIPPING_ADDED', 'SHIPPING_INCLUDED'])
  @IsOptional()
  pricingMode?: 'SHIPPING_ADDED' | 'SHIPPING_INCLUDED';

  /** Agent SHIPPING_INCLUDED orders: the agreed all-inclusive total. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  agreedTotal?: number;
}

export class AmendmentPreviewDto {
  @ValidateNested()
  @Type(() => AmendChangesDto)
  changes!: AmendChangesDto;
}

export class AmendmentCommitDto extends AmendmentPreviewDto {
  /** `version` the preview was computed on — a stale one is a 409. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;

  /** `impactsFingerprint` of the preview the user confirmed — a different impact set is a 409. */
  @IsString()
  @IsOptional()
  @MaxLength(64)
  impactsFingerprint?: string;

  /** Codes of the non-blocking impacts the user acknowledged. */
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  acknowledgements?: string[];
}
