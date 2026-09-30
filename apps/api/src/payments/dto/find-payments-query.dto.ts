import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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
