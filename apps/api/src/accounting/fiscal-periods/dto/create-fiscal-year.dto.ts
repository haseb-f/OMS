import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** Creates a Fiscal Year and auto-generates its 12 monthly Accounting Periods — never created one period at a time (UX Policy: no manual document/period numbering). */
export class CreateFiscalYearDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsUUID()
  @IsOptional()
  companyId?: string;
}
