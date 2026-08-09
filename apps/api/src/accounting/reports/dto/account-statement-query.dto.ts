import { IsNotEmpty, IsUUID } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';

/** Account Statement — a single required account; `page`/`pageSize` are inherited but unused (movements are returned in full, bounded by the date range). */
export class AccountStatementQueryDto extends ReportQueryBaseDto {
  @IsUUID()
  @IsNotEmpty()
  accountId!: string;
}
