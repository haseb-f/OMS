import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AllocationInputDto } from '../../shared/allocation-input.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CreateSupplierPaymentDto {
  @IsUUID()
  partnerId!: string;

  @IsOptionalUuid()
  currencyId?: string;

  /** TASK-051 Document Context Enrichment — optional cost attribution, never required. */
  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  @IsOptionalUuid()
  paymentSourceId?: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Optional at Draft — a payment can be saved before any invoice is allocated against it. */
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  @IsOptional()
  allocations?: AllocationInputDto[];
}
