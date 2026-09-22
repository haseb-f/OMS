import { IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';

/**
 * Partner (Customer / Supplier) Statement. `controlType` restricts the
 * statement to the partner's Receivable (customer) or Payable (supplier)
 * control-account lines — the same lines the AR/AP control accounts carry
 * in the General Ledger. Omitted keeps every partner-tagged line.
 *
 * The statement is always returned in full for the date range (like the
 * Account Statement) so the running and closing balances are never
 * truncated by a page; inherited `page`/`pageSize` are ignored.
 */
export class PartnerStatementQueryDto extends ReportQueryBaseDto {
  @IsUUID()
  @IsNotEmpty()
  partnerId!: string;

  @IsIn(['RECEIVABLE', 'PAYABLE'])
  @IsOptional()
  controlType?: 'RECEIVABLE' | 'PAYABLE';
}
