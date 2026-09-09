import { IsNumber, Min } from 'class-validator';

/** Only the amount is editable — period/scope/metric identify the row (changing them means creating a different target, not editing this one). */
export class UpdateSalesTargetDto {
  @IsNumber()
  @Min(0)
  targetAmount!: number;
}
