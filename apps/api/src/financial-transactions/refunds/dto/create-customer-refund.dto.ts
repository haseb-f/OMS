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

/**
 * Customer Refund — pays a customer back against the unrefunded credit of
 * posted Sales Return(s). Each allocation's `invoiceId` is the Sales Return
 * id; the allocations must add up to `amount` exactly (no unallocated
 * refund). `currencyId` defaults to the currency of the refunded return.
 */
export class CreateCustomerRefundDto {
  @IsUUID()
  partnerId!: string;

  @IsOptionalUuid()
  currencyId?: string;

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

  /** The Cash/Bank the money is paid out of — required to Confirm (posting credits it). */
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations!: AllocationInputDto[];
}
