import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class LeadConvertLineDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  /** Agreed selling amount for this line — independent of quantity. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agreedAmount!: number;
}

export class ConvertLeadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadConvertLineDto)
  items!: LeadConvertLineDto[];

  @IsString()
  paymentType!: 'PREPAID' | 'CASH_ON_DELIVERY';

  @IsOptionalUuid()
  paymentMethodId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  amountPaid?: number;

  @IsString()
  @IsOptional()
  paymentReference?: string;

  @IsString()
  @IsOptional()
  paymentProofUrl?: string;

  @IsOptionalUuid()
  countryId?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CloseLeadWithoutPurchaseDto {
  @IsUUID()
  noPurchaseReasonId!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
