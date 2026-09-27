import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentSettlementDocStatus } from '@prisma/client';

export class SettleClaimDto {
  @IsUUID()
  paymentId!: string;

  /** Explicit partial settlement (claim currency). Omitted = the whole unsettled remainder. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
}

/**
 * Inputs for both preview and confirm. The server recomputes everything from
 * these inputs — the client never sends fee, FX difference or JE amounts.
 */
export class SettlementInputDto {
  @IsUUID()
  paymentMethodId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SettleClaimDto)
  claims!: SettleClaimDto[];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  receivedAmount!: number;

  @IsUUID()
  receivedCurrencyId!: string;

  /** The bank/cash ReceivingAccount the payout landed in. */
  @IsUUID()
  receivingAccountId!: string;

  /** YYYY-MM-DD — FX date and journal entry date. */
  @IsDateString()
  settlementDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerReference?: string;

  /** Cross-currency only: commission in the claim currency (defaults to matched statement fees). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateSettlementDto extends SettlementInputDto {
  /** One key per settle dialog: a retried or double-submitted confirm returns the same settlement. */
  @IsString()
  @MaxLength(100)
  idempotencyKey!: string;
}

export class ReverseSettlementDto {
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class SettlementQueryDto {
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @IsOptional()
  @IsIn(Object.values(PaymentSettlementDocStatus))
  status?: PaymentSettlementDocStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number;
}
