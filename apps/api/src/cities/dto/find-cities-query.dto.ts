import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Adds an optional Country scope on top of the shared Search/pagination shape. */
export class FindCitiesQueryDto extends MasterDataQueryDto {
  @IsOptionalUuid()
  countryId?: string;
}
