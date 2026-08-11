import { ReportQueryBaseDto } from './report-query-base.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** General Ledger — one optional accountId narrows to a single account; omitted returns every account. */
export class GeneralLedgerQueryDto extends ReportQueryBaseDto {
  @IsOptionalUuid()
  accountId?: string;
}
