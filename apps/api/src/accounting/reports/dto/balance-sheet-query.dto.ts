import { ReportQueryBaseDto } from './report-query-base.dto';

/** Balance Sheet — a point-in-time report. `dateTo` is read as the "as of" date; `dateFrom` is ignored. */
export class BalanceSheetQueryDto extends ReportQueryBaseDto {}
