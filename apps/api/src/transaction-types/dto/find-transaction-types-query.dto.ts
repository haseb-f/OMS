import { IsEnum, IsOptional } from 'class-validator';
import { TransactionDirection } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds the one Transaction-Types-specific filter (the الوارد/الصادر tab split) on top of the shared Master Data search/pagination/sort shape. */
export class FindTransactionTypesQueryDto extends MasterDataQueryDto {
  @IsEnum(TransactionDirection)
  @IsOptional()
  direction?: TransactionDirection;
}
