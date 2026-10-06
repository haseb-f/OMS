import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaymentStatementLineKind,
  PaymentStatementLineStatus,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Column mapping + parsing options shared by file import, sheet connection and preview. */
export class StatementMappingDto {
  /** Field → source column header (see STATEMENT_FIELDS). */
  @IsObject()
  columns!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultCurrencyCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  phoneRegion?: string | null;

  @IsOptional()
  @IsIn(['DMY', 'MDY', 'YMD'])
  dateFormat?: 'DMY' | 'MDY' | 'YMD' | null;
}

export class ConnectSheetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  url!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StatementMappingDto)
  mapping?: StatementMappingDto;
}

export class ManualStatementLineDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerReference?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  customerPhone?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  orderReference?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsUUID()
  currencyId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'transactionDate must be YYYY-MM-DD.',
  })
  transactionDate!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  providerStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  phoneRegion?: string;
}

export class FindStatementLinesQueryDto {
  @IsOptional()
  @IsIn(Object.values(PaymentStatementLineStatus))
  status?: PaymentStatementLineStatus;

  /** PAYMENT, REFUND or CHARGEBACK (R13 D2). */
  @IsOptional()
  @IsIn(Object.values(PaymentStatementLineKind))
  kind?: PaymentStatementLineKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  importId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class FindClaimsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsUUID()
  currencyId?: string;
}

export class AllocationDto {
  @IsUUID()
  paymentId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}

export class ConfirmMatchDto {
  @IsUUID()
  statementLineId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations!: AllocationDto[];

  /** Client-generated per user action: a retry with the same key returns the same result. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A reason is required.' })
  @MaxLength(500)
  reason!: string;
}

export class DismissSuggestionDto {
  @IsUUID()
  paymentId!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
