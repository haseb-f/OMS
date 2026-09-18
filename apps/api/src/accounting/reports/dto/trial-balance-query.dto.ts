import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';

/** Trial Balance — Opening / Debit / Credit / Closing over the COA tree. */
export class TrialBalanceQueryDto extends ReportQueryBaseDto {
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : value === true || value === 'true',
  )
  @IsBoolean()
  @IsOptional()
  includeOpeningBalance?: boolean = true;
}
