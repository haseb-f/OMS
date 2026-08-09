import { IsOptional, IsUUID } from 'class-validator';

export class CloseYearDto {
  @IsUUID()
  fiscalYearId!: string;

  /** Optional — when supplied, also generates that year's Opening Entry carrying forward this year's ending Balance Sheet. */
  @IsUUID()
  @IsOptional()
  nextFiscalYearId?: string;
}
