import { IsOptional, IsUUID } from 'class-validator';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds an optional Analytic Plan scope on top of the shared Search/pagination shape. */
export class FindAnalyticAccountsQueryDto extends MasterDataQueryDto {
  @IsUUID()
  @IsOptional()
  analyticPlanId?: string;
}
