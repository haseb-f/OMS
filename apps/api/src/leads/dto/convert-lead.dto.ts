import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
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

  /** Shipping vs Pickup — independent of payment. Defaults to SHIPPING. */
  @IsOptional()
  @IsString()
  fulfillmentMethod?: 'SHIPPING' | 'PICKUP';

  @IsOptionalUuid()
  paymentMethodId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  /**
   * Sales payment declaration at conversion (payment-declaration-reconciliation):
   * UNPAID, FULL (the validated order total — no amount re-entry) or PARTIAL
   * (`amountPaid`). Absent + `amountPaid > 0` is read as PARTIAL (legacy clients).
   */
  @IsIn(['UNPAID', 'FULL', 'PARTIAL'])
  @IsOptional()
  declarationKind?: 'UNPAID' | 'FULL' | 'PARTIAL';

  /** Amount for a PARTIAL declaration. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  amountPaid?: number;

  /** Actual payment date for a paid declaration (defaults to today; never in the future). */
  @IsDateString()
  @IsOptional()
  paymentDate?: string;

  @IsString()
  @IsOptional()
  paymentReference?: string;

  @IsString()
  @IsOptional()
  paymentProofUrl?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  stagingAttachmentIds?: string[];

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
