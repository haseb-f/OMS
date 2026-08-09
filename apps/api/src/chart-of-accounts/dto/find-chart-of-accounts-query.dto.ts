import { IsEnum, IsOptional } from 'class-validator';
import { AccountType } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds an optional Account Type scope on top of the shared Search/pagination shape. */
export class FindChartOfAccountsQueryDto extends MasterDataQueryDto {
  @IsEnum(AccountType)
  @IsOptional()
  accountType?: AccountType;
}
