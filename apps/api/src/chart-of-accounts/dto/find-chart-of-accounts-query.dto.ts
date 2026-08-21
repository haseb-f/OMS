import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AccountType } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds Account Type and posting-leaf scopes on top of the shared Search/pagination shape. */
export class FindChartOfAccountsQueryDto extends MasterDataQueryDto {
  @IsEnum(AccountType)
  @IsOptional()
  accountType?: AccountType;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  postingOnly?: boolean;
}
