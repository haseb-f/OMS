import { IsOptional, IsUUID } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';

/** General Ledger — one optional accountId narrows to a single account; omitted returns every account. */
export class GeneralLedgerQueryDto extends ReportQueryBaseDto {
  @IsUUID()
  @IsOptional()
  accountId?: string;
}
