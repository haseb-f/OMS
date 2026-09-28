import { Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentLedgerEntryType, AgentLedgerPostingStatus } from '@prisma/client';

export class AgentPeriodQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  currencyId?: string;
}

export class AgentLedgerQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(Object.values(AgentLedgerEntryType))
  entryType?: AgentLedgerEntryType;

  @IsOptional()
  @IsIn(Object.values(AgentLedgerPostingStatus))
  postingStatus?: AgentLedgerPostingStatus;

  @IsOptional()
  @IsUUID()
  storeOrderId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class AgentCollectionsQueryDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsIn(['AWAITING', 'PENDING', 'MATCHED', 'VERIFIED', 'REJECTED', 'DISPUTED'])
  status?:
    'AWAITING' | 'PENDING' | 'MATCHED' | 'VERIFIED' | 'REJECTED' | 'DISPUTED';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class AgentPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class AgentPaymentStagesQueryDto {
  @IsOptional()
  @IsUUID()
  storeOrderId?: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class PostPendingDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class CreateAgentPayoutDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsUUID()
  payingAccountId!: string;

  @IsDateString()
  payoutDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  stagedAttachmentIds?: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;
}

export class AgentRefundDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsIn(['COMPANY', 'AGENT'])
  paidBy!: 'COMPANY' | 'AGENT';

  @IsOptional()
  @IsUUID()
  payingAccountId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  refundDate?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;
}

export class AgentAdjustmentDto {
  @IsIn(['DEBIT', 'CREDIT'])
  direction!: 'DEBIT' | 'CREDIT';

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsUUID()
  storeOrderId?: string;

  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;
}

export class AgentReturnLineDto {
  @IsUUID()
  storeOrderItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ReceiveAgentReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AgentReturnLineDto)
  lines!: AgentReturnLineDto[];

  @IsUUID()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey!: string;

  /**
   * The returned parcel (the order's shipment attempt it came back on).
   * When given, the return fee is charged once per shipment however many
   * partial receipts record it (F-L4).
   */
  @IsOptional()
  @IsUUID()
  shipmentId?: string;

  /**
   * Charge the agreement's return fee for this receipt. Default: true for a
   * shipment's first receipt (with `shipmentId`), or — without it — only for
   * the order's first return receipt.
   */
  @IsOptional()
  @IsBoolean()
  chargeReturnFee?: boolean;
}
