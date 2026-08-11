import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** Creates a Fiscal Year and auto-generates its 12 monthly Accounting Periods — never created one period at a time (UX Policy: no manual document/period numbering). */
export class CreateFiscalYearDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptionalUuid()
  companyId?: string;
}
