import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Adds an optional Analytic Plan scope on top of the shared Search/pagination shape. */
export class FindAnalyticAccountsQueryDto extends MasterDataQueryDto {
  @IsOptionalUuid()
  analyticPlanId?: string;
}
