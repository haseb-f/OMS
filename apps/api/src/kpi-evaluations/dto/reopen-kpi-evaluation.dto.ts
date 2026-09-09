import { IsNotEmpty, IsString } from 'class-validator';

/** Part P "Locking" — reopening an HR_APPROVED evaluation always requires a reason, written to the audit trail. */
export class ReopenKpiEvaluationDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
