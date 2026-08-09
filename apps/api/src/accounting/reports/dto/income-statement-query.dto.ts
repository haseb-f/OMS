import { ReportQueryBaseDto } from './report-query-base.dto';

/** Income Statement — no extra fields beyond the shared filter shape (dateFrom/dateTo define the period). */
export class IncomeStatementQueryDto extends ReportQueryBaseDto {}
