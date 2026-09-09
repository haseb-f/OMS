import { IsNotEmpty, IsNumber, IsString, Matches, Min } from 'class-validator';

/** Part X — a POSTED payroll's commission is never rewritten; a reversal/refund instead creates an adjustment targeting a future payroll period. */
export class CreateFutureAdjustmentDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'targetPeriod must be YYYY-MM',
  })
  targetPeriod!: string;

  @IsNumber()
  @Min(0)
  newAmount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
