import { IsNumber, IsUUID, Min } from 'class-validator';

/** One recurring Earning/Deduction line within a Compensation Revision (Part G). */
export class CompensationLineInputDto {
  @IsUUID()
  payrollComponentId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}
