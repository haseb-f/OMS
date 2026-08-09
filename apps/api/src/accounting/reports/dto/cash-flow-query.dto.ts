import { ReportQueryBaseDto } from './report-query-base.dto';

/** Cash Flow Statement — no extra fields beyond the shared filter shape (dateFrom/dateTo define the period). */
export class CashFlowQueryDto extends ReportQueryBaseDto {}
