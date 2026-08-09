import { IsOptional, IsUUID } from 'class-validator';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds an optional Country scope on top of the shared Search/pagination shape. */
export class FindCitiesQueryDto extends MasterDataQueryDto {
  @IsUUID()
  @IsOptional()
  countryId?: string;
}
