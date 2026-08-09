import { ReportQueryBaseDto } from './report-query-base.dto';

/** Journal Report — no extra fields; `search` matches Entry Number, Description, Source Type, Reference Number. */
export class JournalReportQueryDto extends ReportQueryBaseDto {}
