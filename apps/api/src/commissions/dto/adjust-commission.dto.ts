import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

/** Part W — an adjustment to the SAME period's still-unposted calculation; requires a reason and is fully audited. */
export class AdjustCommissionDto {
  @IsNumber()
  @Min(0)
  newAmount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
