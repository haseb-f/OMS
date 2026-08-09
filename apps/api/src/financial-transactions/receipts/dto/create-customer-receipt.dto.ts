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

export class CreateCustomerReceiptDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  /** TASK-051 Document Context Enrichment — optional cost attribution, never required. */
  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;

  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  @IsUUID()
  @IsOptional()
  paymentSourceId?: string;

  @IsUUID()
  @IsOptional()
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

  /** Optional at Draft — a receipt can be saved before any invoice is allocated against it. */
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  @IsOptional()
  allocations?: AllocationInputDto[];
}
