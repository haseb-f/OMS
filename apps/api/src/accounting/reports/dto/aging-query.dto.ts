import { ReportQueryBaseDto } from './report-query-base.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class AgingQueryDto extends ReportQueryBaseDto {
  @IsOptionalUuid()
  partnerId?: string;
}
