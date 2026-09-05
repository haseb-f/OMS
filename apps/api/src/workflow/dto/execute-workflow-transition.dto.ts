import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { LeadConvertLineDto } from '../../leads/dto/convert-lead.dto';

export class ExecuteWorkflowTransitionDto {
  @IsUUID()
  transitionId!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  /** LEAD_CONVERT payload — prefer POST /leads/:id/convert for the full form. */
  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @IsString()
  @IsOptional()
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadConvertLineDto)
  @IsOptional()
  items?: LeadConvertLineDto[];

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
}

export class RequestWorkflowApprovalDto {
  @IsUUID()
  transitionId!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
