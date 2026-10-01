import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentSettlementStatus, PaymentStatus } from '@prisma/client';

export class FindPaymentsQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /** Payments review "Awaiting settlement" stage. */
  @IsOptional()
  @IsEnum(PaymentSettlementStatus, { each: true })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  settlementStatus?: PaymentSettlementStatus[];

  /**
   * `false`: only payments Finance confirms from review (no method, or a
   * method without statement reconciliation); `true`: only reconciliation
   * methods. Omitted: both.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  reconciled?: 'true' | 'false';

  /** Payment number, order number, reference, sender or customer name (case-insensitive contains). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 50;
}
