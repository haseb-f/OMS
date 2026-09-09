import { IsUUID, Matches } from 'class-validator';

export class StartKpiEvaluationDto {
  @IsUUID()
  employeeProfileId!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period!: string;
}
