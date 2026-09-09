import { IsNumber, IsUUID, Min } from 'class-validator';

/** Part H one-off examples (خصم غياب / خصم جزاء / سداد سلفة / Bonus) — added directly on a DRAFT Payroll Line, separate from the employee's recurring Compensation lines. */
export class AddPayrollLineComponentDto {
  @IsUUID()
  payrollComponentId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}
