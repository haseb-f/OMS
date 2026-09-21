import { IsIn, IsOptional } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';
import type { CashFlowView } from '../financial-report-tree';

/**
 * Cash Flow Statement — dateFrom/dateTo define the period. `view` picks the
 * presentation: `activities` (default; operating/investing/financing) or
 * `movement` (cash-account movement detail: opening, inflows, outflows,
 * net change, closing per cash/bank account).
 */
export class CashFlowQueryDto extends ReportQueryBaseDto {
  @IsIn(['activities', 'movement'])
  @IsOptional()
  view?: CashFlowView = 'activities';
}
