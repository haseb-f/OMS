import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** Agent lead (spec §6.1) — agent, owner and source are server-set. */
export class CreateAgentLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  customerName!: string;

  @IsString()
  @IsNotEmpty()
  mobileNumber!: string;

  @IsUUID()
  countryId!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  /** Must be a product owned by the caller's agent. */
  @IsOptionalUuid()
  productId?: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  quantity?: number;

  /** Preferred fulfillment (default for the conversion). */
  @IsIn(['SHIPPING', 'PICKUP'])
  @IsOptional()
  fulfillmentMethod?: 'SHIPPING' | 'PICKUP';
}

export class FindAgentLeadsQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  statusCode?: string;

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
}
