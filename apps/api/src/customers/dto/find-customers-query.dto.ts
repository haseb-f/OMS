import { IsEnum, IsOptional } from 'class-validator';
import { CustomerSource } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';
import { TransformEnumList } from '../../common/query/enum-list';

export class FindCustomersQueryDto extends MasterDataQueryDto {
  @TransformEnumList()
  @IsEnum(CustomerSource, { each: true })
  @IsOptional()
  source?: CustomerSource[];
}
