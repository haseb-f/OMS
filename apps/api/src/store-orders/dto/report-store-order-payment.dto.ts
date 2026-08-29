import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Sales-agent payment report — creates a PENDING Payment and sets the Store
 * Order to PAYMENT_REVIEW. Never marks the order FULLY_PAID_RECONCILED.
 * `paymentSourceId` is the expected Payment Method / Source (HOW paid).
 */
export class ReportStoreOrderPaymentDto {
  @IsUUID()
  paymentSourceId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  reportedAmount!: number;

  @IsDateString()
  reportedDate!: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  senderName?: string;
}
