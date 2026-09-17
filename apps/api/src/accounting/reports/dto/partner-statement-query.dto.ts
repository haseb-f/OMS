import { IsNotEmpty, IsUUID } from 'class-validator';
import { ReportQueryBaseDto } from './report-query-base.dto';

export class PartnerStatementQueryDto extends ReportQueryBaseDto {
  @IsUUID()
  @IsNotEmpty()
  partnerId!: string;
}
