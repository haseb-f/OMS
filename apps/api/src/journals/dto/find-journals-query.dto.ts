import { IsEnum, IsOptional } from 'class-validator';
import { JournalType } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/** Adds an optional Journal Type scope on top of the shared Search/pagination shape. */
export class FindJournalsQueryDto extends MasterDataQueryDto {
  @IsEnum(JournalType)
  @IsOptional()
  type?: JournalType;
}
